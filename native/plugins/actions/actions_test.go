package actions

import (
	"context"
	"testing"

	"github.com/arcships/rutis/go/rutis/rutistest"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
)

func TestRunRegisteredCommandAndList(t *testing.T) {
	off := actionsapi.Register(actionsapi.Command{
		ID:    "test-echo",
		Title: "Echo a message",
		CLI:   true,
		Run: func(_ context.Context, a actionsapi.Args) (string, error) {
			return a.Params["msg"], nil
		},
	})
	t.Cleanup(off)

	loaded := rutistest.Load(t, Plugin, nil, nil)
	svc := loaded.Service("actions")

	var out string
	if err := svc.Call(t.Context(), "run", &out, []string{"test-echo", "msg=hi"}, t.TempDir()); err != nil {
		t.Fatalf("run: %v", err)
	}
	if out != "hi" {
		t.Fatalf("run = %q, want hi", out)
	}

	var list []Info
	if err := svc.Call(t.Context(), "list", &list); err != nil {
		t.Fatalf("list: %v", err)
	}
	found := false
	for _, c := range list {
		if c.ID == "test-echo" && c.Title == "Echo a message" && c.CLI {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("list = %+v, want test-echo", list)
	}
}
