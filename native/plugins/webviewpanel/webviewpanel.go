// Package webviewpanel is webview-panel-ui (RFC 0001 §5.11, §6): the
// fallback for a third party's UI, in any language and with no rebuild.
// Its "webview-panels" service takes a panel of a URL or of HTML, which it
// shows in a dock with a web view: a window set into the window, not
// native UI.
package webviewpanel

import (
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// ID is the plugin's name.
const ID = "webview-panel-ui"

// Plugin provides "webview-panels" while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		s := &Service{panels: map[string]*panel{}}
		rctx.Provide("webview-panels", s)
		rctx.Effect(func(context.Context) error {
			s.mu.Lock()
			panels := s.panels
			s.panels = map[string]*panel{}
			s.mu.Unlock()
			for _, pn := range panels {
				pn.close()
			}
			return nil
		})
		return nil
	},
})

// Panel is a panel another process asks for.
type Panel struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Dock  string `json:"dock"` // "left" or "right" (the default)
	Order int    `json:"order"`
	URL   string `json:"url"`  // the page; or
	HTML  string `json:"html"` // the page's HTML, when no URL
	Icon  string `json:"icon"` // optional SVG markup
}

// panel is a registered panel and its web view, made when first drawn.
type panel struct {
	spec Panel
	off  func()
	view *mygo.WebView
	err  string
}

func (pn *panel) close() {
	pn.off()
	shellapi.Update(func() {
		if pn.view != nil {
			pn.view.Destroy()
			pn.view = nil
		}
	})
}

// draw shows the panel's web view, making it the first time. Main thread.
func (pn *panel) draw(c *ui.Context) {
	if pn.view == nil && pn.err == "" {
		w := shellapi.Window()
		if w == nil {
			pn.err = "No window to show the panel in."
		} else if v, err := w.NewWebView(mygo.WebViewOptions{URL: pn.spec.URL}); err != nil {
			pn.err = err.Error()
		} else {
			pn.view = v
			if pn.spec.URL == "" {
				v.Page().LoadHTML(pn.spec.HTML, "")
			}
			id := pn.spec.ID
			v.Page().OnDidFinishLoad(func() { debugf("webview-panel: %s loaded", id) })
		}
	}
	if pn.err != "" {
		textdoc.Centered(c, pn.err)
		return
	}
	ui.WebView(c, pn.view).Fill()
}

// Service is the "webview-panels" service.
type Service struct {
	mu     sync.Mutex
	panels map[string]*panel
}

// Register adds p until Unregister or this plugin unloads; a second panel
// with its ID replaces it.
func (s *Service) Register(_ context.Context, p Panel) error {
	if p.ID == "" || p.URL == "" && p.HTML == "" {
		return fmt.Errorf("a web view panel needs an id, and a url or html")
	}
	if p.Title == "" {
		p.Title = p.ID
	}
	icon := lucide.AppWindow()
	if p.Icon != "" {
		if svg, err := ui.ParseSVG([]byte(p.Icon)); err == nil {
			icon = svg
		}
	}
	dock := slotsapi.Right
	if p.Dock == "left" {
		dock = slotsapi.Left
	}
	pn := &panel{spec: p}
	_ = s.Unregister(context.Background(), p.ID)
	pn.off = slotsapi.RegisterPanel(slotsapi.Panel{ID: "webview:" + p.ID, Title: p.Title, Icon: icon, Dock: dock, Order: 100 + p.Order,
		View: func(c *ui.Context, _ slotsapi.PanelProps) { pn.draw(c) }})
	s.mu.Lock()
	s.panels[p.ID] = pn
	s.mu.Unlock()
	return nil
}

// Unregister removes a panel Register added.
func (s *Service) Unregister(_ context.Context, id string) error {
	s.mu.Lock()
	pn := s.panels[id]
	delete(s.panels, id)
	s.mu.Unlock()
	if pn != nil {
		pn.close()
	}
	return nil
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
