package workspace

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

func goldenPNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 4), uint8(y * 5), 128, 255})
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

// save writes the frame to $GOLDEN_DIR/<name>.png, or, when the file is
// already there, fails unless the frame is the same bytes: run once on one
// commit and again on another to compare them.
func save(t *testing.T, tt *ui.Tester, name string) {
	t.Helper()
	tt.Frame()
	var b bytes.Buffer
	if err := png.Encode(&b, tt.Image()); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(os.Getenv("GOLDEN_DIR"), name+".png")
	if old, err := os.ReadFile(file); err == nil {
		if !bytes.Equal(old, b.Bytes()) {
			t.Errorf("frame %s differs from %s", name, file)
		}
		return
	}
	if err := os.WriteFile(file, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

const goText = "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hello\")\n}\n"
const mdText = "# Title\n\nSome *body* text with a [link](other.md).\n\n- one\n- two\n\n```go\nx := 1\n```\n"

// TestFramesPerTabKind draws every tab kind's states (slice 4's acceptance
// check: the viewers' move out of the workspace kept them byte-identical).
// It runs only with GOLDEN_DIR set; no frames are kept in the repo.
func TestFramesPerTabKind(t *testing.T) {
	if os.Getenv("GOLDEN_DIR") == "" {
		t.Skip()
	}
	ws, tt := testWorkspace(t)
	testFiles = map[string]fscontract.File{
		"/m/main.go":  {Text: goText},
		"/m/alpha.md": {Text: mdText},
		"/m/blob.bin": {Binary: true},
		"/m/big.txt":  {TooLarge: true, Size: 9 << 20},
		"/m/gone.txt": {Text: "old"},
	}
	pic := goldenPNG()
	testBytes = pic
	open := func(path string, nav *workspaceapi.Nav) *tab {
		tb := ws.openIn(path, nav, true)
		tt.Frame()
		testPosts.next(t)
		return tb
	}
	open("/m/main.go", &workspaceapi.Nav{Line: 5, To: 6})
	save(t, tt, "1-text-nav")
	open("/m/alpha.md", nil)
	save(t, tt, "2-markdown")
	press(tt, ui.Cmd, ui.KeyE)
	save(t, tt, "3-markdown-source")
	open("/m/pic.png", nil)
	save(t, tt, "4-image")
	open("/m/blob.bin", nil)
	save(t, tt, "5-binary")
	open("/m/big.txt", nil)
	save(t, tt, "6-toolarge")
	open("/m/gone.txt", nil)
	// The file provider comes and finds gone.txt deleted: a frame for each
	// of the six tabs.
	testMissing = map[string]bool{"/m/gone.txt": true}
	files := fileProvider(t)
	for range 6 {
		files.frames.next(t)
	}
	save(t, tt, "7-missing")
	ws.open("/m/loading.txt", nil)
	save(t, tt, "8-loading")
	ws.newTab()
	save(t, tt, "9-newtab")
}
