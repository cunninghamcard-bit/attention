// Input: os/exec
// Output: None
// Pos: Application code
//
// 🔄 Self-reference: When this file changes, update this header

//go:build !unix

package local

import "os/exec"

func configureProcessTreeCancel(*exec.Cmd) {}
