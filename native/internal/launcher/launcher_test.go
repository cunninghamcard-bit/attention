package launcher

import (
	"strings"
	"syscall"
	"testing"
)

// Regression: `attention files | head` printed "Error: … broken pipe"
// once head had read its lines.
func TestAClosedReaderIsNoError(t *testing.T) {
	if err := copyOut(closedPipe{}, strings.NewReader("a\nb\n")); err != nil {
		t.Fatalf("copy to a closed pipe: %v", err)
	}
}

type closedPipe struct{}

func (closedPipe) Write([]byte) (int, error) { return 0, syscall.EPIPE }
