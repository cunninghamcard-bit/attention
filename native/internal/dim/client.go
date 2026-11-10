// Package dim is a client of dim's App Server (protocol 3): JSON-RPC over
// the daemon's Unix socket, one JSON object per line (issue #8).
package dim

import (
	"bufio"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
)

const (
	// ProtocolVersion is the App Server protocol this client speaks.
	ProtocolVersion = 3
	maxFrame        = 16 << 20
)

// ErrClosed is returned by calls on a connection that has ended.
var ErrClosed = errors.New("dim: connection closed")

// Notice is a server notification: a method and its raw params.
type Notice struct {
	Method string
	Params json.RawMessage
}

// NoticeFunc receives notifications on the client's reader goroutine.
type NoticeFunc func(Notice)

// RPCError is an error the server answered a call with.
type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Error reports the server's message and code.
func (e *RPCError) Error() string { return fmt.Sprintf("dim: %s (code %d)", e.Message, e.Code) }

type reply struct {
	result json.RawMessage
	err    error
}

// Client is one connection to the App Server.
type Client struct {
	// ServerVersion is the server's version from the hello reply.
	ServerVersion string

	conn     net.Conn
	notify   NoticeFunc
	features map[string]bool
	done     chan struct{}

	wmu sync.Mutex

	mu      sync.Mutex
	next    int64
	pending map[int64]chan reply
	err     error
}

// Dial connects to the socket at path, says hello as name and starts
// reading; notify gets every notification.
func Dial(ctx context.Context, path, name string, notify NoticeFunc) (*Client, error) {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "unix", path)
	if err != nil {
		return nil, fmt.Errorf("connect to dim: %w", err)
	}
	c := &Client{conn: conn, notify: notify, done: make(chan struct{}), pending: map[int64]chan reply{}}
	go c.read()
	var hello struct {
		ServerVersion   string   `json:"serverVersion"`
		ProtocolVersion int      `json:"protocolVersion"`
		Features        []string `json:"features"`
	}
	params := map[string]any{"protocolVersion": ProtocolVersion, "clientKind": "other", "clientName": name}
	if err := c.Call(ctx, "hello", params, &hello); err != nil {
		conn.Close()
		return nil, fmt.Errorf("dim hello: %w", err)
	}
	c.ServerVersion = hello.ServerVersion
	c.features = make(map[string]bool, len(hello.Features))
	for _, f := range hello.Features {
		c.features[f] = true
	}
	return c, nil
}

// Call sends method with params and decodes the result into result,
// which may be nil.
func (c *Client) Call(ctx context.Context, method string, params, result any) error {
	ch := make(chan reply, 1)
	c.mu.Lock()
	if c.err != nil {
		c.mu.Unlock()
		return c.err
	}
	c.next++
	id := c.next
	c.pending[id] = ch
	c.mu.Unlock()
	frame, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		c.forget(id)
		return fmt.Errorf("encode %s: %w", method, err)
	}
	c.wmu.Lock()
	_, err = c.conn.Write(append(frame, '\n'))
	c.wmu.Unlock()
	if err != nil {
		c.forget(id)
		return fmt.Errorf("send %s: %w", method, err)
	}
	select {
	case r := <-ch:
		if r.err != nil {
			return r.err
		}
		if result == nil || len(r.result) == 0 {
			return nil
		}
		if err := json.Unmarshal(r.result, result); err != nil {
			return fmt.Errorf("decode %s: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		c.forget(id)
		return ctx.Err()
	}
}

// Offers reports whether the server lists feature in its hello.
func (c *Client) Offers(feature string) bool { return c.features[feature] }

// Done is closed once the connection has ended; Err then says why.
func (c *Client) Done() <-chan struct{} { return c.done }

// Err is why the connection ended, nil while it is open.
func (c *Client) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
}

// Close ends the connection; sessions stay on the server, detached.
func (c *Client) Close() error {
	err := c.conn.Close()
	<-c.done
	return err
}

func (c *Client) read() {
	defer close(c.done)
	sc := bufio.NewScanner(c.conn)
	sc.Buffer(make([]byte, 64<<10), maxFrame)
	for sc.Scan() {
		var m struct {
			ID     *int64          `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *RPCError       `json:"error"`
		}
		if json.Unmarshal(sc.Bytes(), &m) != nil {
			continue
		}
		if m.ID == nil {
			if m.Method != "" && c.notify != nil {
				c.notify(Notice{Method: m.Method, Params: m.Params})
			}
			continue
		}
		c.mu.Lock()
		ch := c.pending[*m.ID]
		delete(c.pending, *m.ID)
		c.mu.Unlock()
		if ch == nil {
			continue
		}
		if m.Error != nil {
			ch <- reply{err: m.Error}
		} else {
			ch <- reply{result: m.Result}
		}
	}
	err := cmp.Or(sc.Err(), ErrClosed)
	c.mu.Lock()
	c.err = err
	for id, ch := range c.pending {
		ch <- reply{err: err}
		delete(c.pending, id)
	}
	c.mu.Unlock()
}

func (c *Client) forget(id int64) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

// SocketPath is the App Server's socket: under DIMCODE_HOME when set,
// else the first of ~/.dimcode-alpha and ~/.dimcode that has one.
func SocketPath() (string, error) {
	if h := os.Getenv("DIMCODE_HOME"); h != "" {
		return filepath.Join(h, "rust", "daemon.sock"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find dim home: %w", err)
	}
	for _, dir := range []string{".dimcode-alpha", ".dimcode"} {
		p := filepath.Join(home, dir, "rust", "daemon.sock")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", errors.New("dim is not running: no daemon socket under ~/.dimcode-alpha or ~/.dimcode (start dim once, or set DIMCODE_HOME)")
}
