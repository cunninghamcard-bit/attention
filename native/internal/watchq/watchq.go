// Package watchq keeps one owner's watches on the fs service: counted per
// directory on the main thread, and sent to fs one at a time, in order, so
// an Unwatch never overtakes the Watch it undoes (grok review 1, item 2).
package watchq

import (
	"context"
	"time"

	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
)

type op struct {
	dir  string
	add  bool
	gen  int
	stop bool // the last op: run returns after it
}

// Queue is one owner's watches. Watch and Unwatch are called on the main
// thread only.
type Queue struct {
	ctx    context.Context
	fs     fsplugin.FS
	counts map[string]int
	// gens is the generation of each directory's last add sent; failed
	// holds the directories whose last add fs refused: they are counted
	// but not watched, so the next Watch sends the add again and the last
	// Unwatch sends nothing.
	gens   map[string]int
	failed map[string]bool
	gen    int
	closed bool
	ops    chan op
	done   chan struct{}
	// onFail is called on the main thread when fs refuses a watch.
	onFail func(dir, msg string)
	post   func(func())
}

// New starts the queue's sender; it stops with ctx or Close. post runs a
// function on the main thread (sh.Update).
func New(ctx context.Context, fs fsplugin.FS, post func(func()), onFail func(dir, msg string)) *Queue {
	q := &Queue{ctx: ctx, fs: fs, counts: map[string]int{}, gens: map[string]int{}, failed: map[string]bool{},
		ops: make(chan op, 4096), done: make(chan struct{}), onFail: onFail, post: post}
	go q.run()
	return q
}

// Watch takes one watch on dir.
func (q *Queue) Watch(dir string) {
	if q.closed {
		return
	}
	q.counts[dir]++
	if q.counts[dir] == 1 || q.failed[dir] {
		delete(q.failed, dir)
		q.gen++
		q.gens[dir] = q.gen
		q.send(op{dir: dir, add: true, gen: q.gen})
	}
}

// Unwatch gives back one watch on dir.
func (q *Queue) Unwatch(dir string) {
	switch q.counts[dir] {
	case 0:
	case 1:
		delete(q.counts, dir)
		delete(q.gens, dir)
		if q.failed[dir] {
			delete(q.failed, dir) // fs holds nothing to give back
			return
		}
		q.send(op{dir: dir})
	default:
		q.counts[dir]--
	}
}

// Watching reports whether dir has a watch.
func (q *Queue) Watching(dir string) bool { return q.counts[dir] > 0 && !q.failed[dir] }

// Close gives back every watch and waits, up to two seconds, for fs to
// have them; it is called off the main thread, before ctx is cancelled.
// Watch does nothing after it.
func (q *Queue) Close() {
	queued := make(chan struct{})
	q.post(func() {
		if !q.closed {
			q.closed = true
			for dir := range q.counts {
				if !q.failed[dir] {
					q.send(op{dir: dir})
				}
			}
			q.counts, q.gens, q.failed = map[string]int{}, map[string]int{}, map[string]bool{}
			q.send(op{stop: true})
		}
		close(queued)
	})
	timeout := time.After(2 * time.Second)
	select {
	case <-queued:
	case <-timeout:
		return
	}
	select {
	case <-q.done:
	case <-timeout:
	}
}

// send drops the operation after unload rather than block the main thread
// on a queue nobody reads.
func (q *Queue) send(o op) {
	select {
	case q.ops <- o:
	case <-q.ctx.Done():
	}
}

func (q *Queue) run() {
	defer close(q.done)
	for {
		select {
		case <-q.ctx.Done():
			return
		case o := <-q.ops:
			switch {
			case o.stop:
				return
			case !o.add:
				_ = q.fs.Unwatch(q.ctx, o.dir)
			default:
				if err := q.fs.Watch(q.ctx, o.dir); err != nil && q.ctx.Err() == nil {
					dir, gen, msg := o.dir, o.gen, err.Error()
					q.post(func() {
						// A later add (after an Unwatch to zero and a Watch) is
						// its own; only the last add's failure counts.
						if q.gens[dir] == gen && q.counts[dir] > 0 {
							q.failed[dir] = true
						}
						if q.onFail != nil {
							q.onFail(dir, msg)
						}
					})
				}
			}
		}
	}
}
