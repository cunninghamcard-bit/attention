// Package watchq keeps one owner's watches on the fs service: counted per
// directory on the main thread, and sent to fs one at a time, in order, so
// an Unwatch never overtakes the Watch it undoes (grok review 1, item 2).
package watchq

import (
	"context"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
)

type op struct {
	dir string
	add bool
}

// Queue is one owner's watches. Watch and Unwatch are called on the main
// thread only.
type Queue struct {
	ctx    context.Context
	fs     fscontract.FS
	counts map[string]int
	ops    chan op
	// failed is called on a goroutine when fs refuses a watch; the count is
	// already given back by then (through post), so a later Watch retries.
	failed func(dir, msg string)
	post   func(func())
}

// New starts the queue's sender; it stops with ctx. post runs a function on
// the main thread (shellapi.Update).
func New(ctx context.Context, fs fscontract.FS, post func(func()), failed func(dir, msg string)) *Queue {
	q := &Queue{ctx: ctx, fs: fs, counts: map[string]int{}, ops: make(chan op, 4096), failed: failed, post: post}
	go q.run()
	return q
}

// Watch takes one watch on dir.
func (q *Queue) Watch(dir string) {
	q.counts[dir]++
	if q.counts[dir] == 1 {
		q.send(op{dir: dir, add: true})
	}
}

// Unwatch gives back one watch on dir.
func (q *Queue) Unwatch(dir string) {
	switch q.counts[dir] {
	case 0:
	case 1:
		delete(q.counts, dir)
		q.send(op{dir: dir})
	default:
		q.counts[dir]--
	}
}

// Watching reports whether dir has a watch.
func (q *Queue) Watching(dir string) bool { return q.counts[dir] > 0 }

// send drops the operation after unload rather than block the main thread
// on a queue nobody reads.
func (q *Queue) send(o op) {
	select {
	case q.ops <- o:
	case <-q.ctx.Done():
	}
}

func (q *Queue) run() {
	for {
		select {
		case <-q.ctx.Done():
			return
		case o := <-q.ops:
			if !o.add {
				_ = q.fs.Unwatch(q.ctx, o.dir)
				continue
			}
			if err := q.fs.Watch(q.ctx, o.dir); err != nil && q.ctx.Err() == nil {
				dir, msg := o.dir, err.Error()
				q.post(func() { delete(q.counts, dir) })
				if q.failed != nil {
					q.failed(dir, msg)
				}
			}
		}
	}
}
