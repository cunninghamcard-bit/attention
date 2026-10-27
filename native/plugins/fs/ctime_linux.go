package fs

import "syscall"

func ctime(s *syscall.Stat_t) int64 { return s.Ctim.Nano() }
