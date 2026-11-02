package actions

import (
	"context"
	"testing"

	"github.com/arcships/rutis/go/rutis/rutistest"
)

func TestRunRegisteredCommandAndList(t *testing.T) {
	loaded := rutistest.Load(t, Plugin, nil, nil)
	svc := loaded.Service("actions")

	var actions *Service
	if err := svc.Bind(&actions); err != nil {
		t.Fatalf("bind: %v", err)
	}
	off := actions.Add(Command{
		ID:    "test-echo",
		Title: "Echo a message",
		CLI:   true,
		Run: func(_ context.Context, a Args) (string, error) {
			return a.Params["msg"], nil
		},
	})
	t.Cleanup(off)

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
