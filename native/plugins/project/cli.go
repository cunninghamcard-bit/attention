package project

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
)

var errWalkLimit = errors.New("walk limit")

// fileCommands are the TS CLI's vault/folder/file/read/write/random
// commands, registered here because project owns the mounts.
func (s *Service) fileCommands() []actions.Command {
	cmd := func(id string, run func(context.Context, actions.Args) (string, error)) actions.Command {
		return actions.Command{ID: id, CLI: true, Run: run}
	}
	return []actions.Command{
		cmd("vault", s.cliVault),
		cmd("folder", s.cliFolder),
		cmd("folders", s.cliFolders),
		cmd("file", s.cliFile),
		cmd("read", s.cliRead),
		cmd("create", s.cliCreate),
		cmd("append", s.cliAppend),
		cmd("prepend", s.cliPrepend),
		cmd("move", s.cliMove),
		cmd("rename", s.cliRename),
		cmd("delete", s.cliDelete),
		cmd("random", s.cliRandom),
		cmd("random:read", s.cliRandomRead),
	}
}

// cliVault is `vault [info=name|path|files|folders|size]`, from
// apps/web/app/cli/registerCliCommands.ts. There is no vault: name is the
// mounts' names joined with ", ", and path lists every mount's absolute
// path (one line, or one `path` row each in the full report).
func (s *Service) cliVault(ctx context.Context, a actions.Args) (string, error) {
	mounts, err := s.Mounts(ctx)
	if err != nil {
		return "", err
	}
	names := make([]string, len(mounts))
	for i, m := range mounts {
		names[i] = m.Name
	}
	name := strings.Join(names, ", ")
	info := a.Params["info"]
	if info == "name" {
		return name, nil
	}
	if info == "path" {
		if len(mounts) == 0 {
			return "(not available)", nil
		}
		lines := make([]string, len(mounts))
		for i, m := range mounts {
			lines[i] = m.Path
		}
		return strings.Join(lines, "\n"), nil
	}
	st, err := s.stats(ctx, mountPaths(mounts))
	if err != nil {
		return "", err
	}
	switch info {
	case "files":
		return strconv.Itoa(st.files), nil
	case "folders":
		return strconv.Itoa(st.folders), nil
	case "size":
		return strconv.FormatInt(st.size, 10), nil
	}
	lines := []string{"name\t" + name}
	for _, m := range mounts {
		lines = append(lines, "path\t"+m.Path)
	}
	lines = append(lines,
		"files\t"+strconv.Itoa(st.files),
		"folders\t"+strconv.Itoa(st.folders),
		"size\t"+strconv.FormatInt(st.size, 10),
	)
	return strings.Join(lines, "\n"), nil
}

// cliFolder is `folder path=<path> [info=files|folders|size]`, from
// apps/web/app/cli/commands/coreMisc.ts.
func (s *Service) cliFolder(ctx context.Context, a actions.Args) (string, error) {
	p := a.Params["path"]
	if p == "" {
		return "", fmt.Errorf("Missing required parameter: path\nUsage: folder path=<folder-path> [info=files|folders|size]")
	}
	abs, err := s.resolveFolder(ctx, p, a.Cwd, true)
	if err != nil {
		return "", err
	}
	st, err := s.stats(ctx, []string{abs})
	if err != nil {
		return "", err
	}
	switch a.Params["info"] {
	case "files":
		return strconv.Itoa(st.files), nil
	case "folders":
		return strconv.Itoa(st.folders), nil
	case "size":
		return strconv.FormatInt(st.size, 10), nil
	}
	return tabbed([][2]string{
		{"path", s.display(ctx, abs)},
		{"files", strconv.Itoa(st.files)},
		{"folders", strconv.Itoa(st.folders)},
		{"size", strconv.FormatInt(st.size, 10)},
	}), nil
}

// cliFolders is `folders [folder=<path>] [total]`, from
// apps/web/app/cli/registerCliCommands.ts. The start folder is included, as
// recurseChildren visits it.
func (s *Service) cliFolders(ctx context.Context, a actions.Args) (string, error) {
	mounts, err := s.Mounts(ctx)
	if err != nil {
		return "", err
	}
	var starts []string
	if folder := a.Params["folder"]; folder != "" {
		abs, err := s.resolveFolder(ctx, folder, a.Cwd, false)
		if err != nil {
			return "", err
		}
		starts = []string{abs}
	} else {
		starts = mountPaths(mounts)
	}
	out, err := s.listFolders(ctx, mounts, starts)
	if err != nil {
		return "", err
	}
	if a.Has("total") {
		return strconv.Itoa(len(out)), nil
	}
	sort.SliceStable(out, func(i, j int) bool { return natural.Less(out[i], out[j]) })
	return strings.Join(out, "\n"), nil
}

// cliFile is `file [file=<name>] [path=<path>]`, from
// apps/web/app/cli/commands/coreMisc.ts. created/modified are epoch-ms.
func (s *Service) cliFile(ctx context.Context, a actions.Args) (string, error) {
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	e, err := s.fs.Stat(ctx, abs)
	if err != nil {
		return "", err
	}
	base, ext := fileBaseExt(e.Name)
	return tabbed([][2]string{
		{"path", s.display(ctx, abs)},
		{"name", base},
		{"extension", ext},
		{"size", strconv.FormatInt(e.Size, 10)},
		{"created", milli(e.CTime)},
		{"modified", milli(e.ModTime)},
	}), nil
}

// cliRead is `read [file=<name>] [path=<path>]`, from
// apps/web/app/cli/registerCliCommands.ts.
func (s *Service) cliRead(ctx context.Context, a actions.Args) (string, error) {
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	data, err := s.fs.ReadBytes(ctx, abs, 0)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// cliCreate is `create [name=] [path=] [content=] [template=] [overwrite] [open] [newtab]`,
// from apps/web/app/cli/commands/fileWrites.ts.
func (s *Service) cliCreate(ctx context.Context, a actions.Args) (string, error) {
	if strings.Contains(a.Params["name"], "/") {
		return "", fmt.Errorf("name cannot contain \"/\". Use path for a full file path.")
	}
	if a.Params["template"] != "" {
		return "", fmt.Errorf("Templates plugin is not enabled.")
	}
	pathP, nameP := a.Params["path"], a.Params["name"]
	var basePath string
	switch {
	case pathP != "" && nameP != "":
		basePath = strings.TrimRight(pathP, "/") + "/" + nameP
	case pathP != "":
		basePath = pathP
	case nameP != "":
		basePath = nameP
	default:
		basePath = "Untitled"
	}
	ext := "md"
	if dot := strings.LastIndex(basePath, "."); dot > 0 {
		ext = basePath[dot+1:]
		basePath = basePath[:dot]
	}
	content := ""
	if a.Params["content"] != "" {
		content = unescapeContent(a.Params["content"])
	}
	absBase, err := s.writeTarget(ctx, basePath)
	if err != nil {
		return "", err
	}
	target := absBase
	if ext != "" {
		target = absBase + "." + ext
	}
	existing, statErr := s.fs.Stat(ctx, target)
	exists := statErr == nil
	out := target
	if a.Has("overwrite") && exists && !existing.Dir {
		if err := s.requireInside(ctx, out); err != nil {
			return "", err
		}
		if err := s.fs.Write(ctx, out, []byte(content)); err != nil {
			return "", err
		}
	} else {
		out = s.availablePath(ctx, absBase, ext)
		if err := s.requireInside(ctx, out); err != nil {
			return "", err
		}
		if err := s.fs.Write(ctx, out, []byte(content)); err != nil {
			return "", err
		}
	}
	if a.Has("open") {
		if err := s.openPath(ctx, out, a.Has("newtab")); err != nil {
			return "", err
		}
	}
	verb := "Created"
	if a.Has("overwrite") && exists {
		verb = "Overwrote"
	}
	return verb + ": " + s.display(ctx, out), nil
}

// cliAppend is `append [file=] [path=] content= [inline]`, from
// apps/web/app/cli/commands/fileWrites.ts.
func (s *Service) cliAppend(ctx context.Context, a actions.Args) (string, error) {
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	if a.Params["content"] == "" {
		return "", fmt.Errorf("Missing required parameter: content\nUsage: append [file=<name>] [path=<path>] content=<text> [inline]")
	}
	if err := s.requireInside(ctx, abs); err != nil {
		return "", err
	}
	content := unescapeContent(a.Params["content"])
	if !a.Has("inline") {
		content = "\n" + content
	}
	if err := s.fs.Append(ctx, abs, []byte(content)); err != nil {
		return "", err
	}
	return "Appended to: " + s.display(ctx, abs), nil
}

// cliPrepend is `prepend [file=] [path=] content= [inline]`, from
// apps/web/app/cli/commands/fileWrites.ts. Insertion is after a terminated
// YAML frontmatter block (Xx() in the TS source).
func (s *Service) cliPrepend(ctx context.Context, a actions.Args) (string, error) {
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	if a.Params["content"] == "" {
		return "", fmt.Errorf("Missing required parameter: content\nUsage: prepend [file=<name>] [path=<path>] content=<text> [inline]")
	}
	if err := s.requireInside(ctx, abs); err != nil {
		return "", err
	}
	data, err := s.fs.ReadBytes(ctx, abs, 0)
	if err != nil {
		return "", err
	}
	content := unescapeContent(a.Params["content"])
	nl := "\n"
	if a.Has("inline") {
		nl = ""
	}
	at := frontmatterContentStart(string(data))
	out := string(data[:at]) + content + nl + string(data[at:])
	if err := s.fs.Write(ctx, abs, []byte(out)); err != nil {
		return "", err
	}
	return "Prepended to: " + s.display(ctx, abs), nil
}

// cliMove is `move [file=] [path=] to=`, from
// apps/web/app/cli/commands/fileWrites.ts. A to= with a dot anywhere is a
// full file path; otherwise it is a folder, keeping the filename.
func (s *Service) cliMove(ctx context.Context, a actions.Args) (string, error) {
	if a.Params["to"] == "" {
		return "", fmt.Errorf("Missing required parameter: to\nUsage: move to=<folder> or to=<path>")
	}
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	target := strings.Trim(a.Params["to"], "/")
	var dest string
	switch {
	case strings.Contains(target, "."):
		dest = target
	case target != "":
		dest = target + "/" + filepath.Base(abs)
	default:
		dest = filepath.Base(abs)
	}
	destAbs, err := s.writeTarget(ctx, dest)
	if err != nil {
		return "", err
	}
	if err := s.fs.Rename(ctx, abs, destAbs); err != nil {
		return "", err
	}
	return "Moved: " + s.display(ctx, abs) + " -> " + s.display(ctx, destAbs), nil
}

// cliRename is `rename [file=] [path=] name=`, from
// apps/web/app/cli/commands/fileWrites.ts.
func (s *Service) cliRename(ctx context.Context, a actions.Args) (string, error) {
	if a.Params["name"] == "" {
		return "", fmt.Errorf("Missing required parameter: name\nUsage: rename name=<new name>")
	}
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	newName := a.Params["name"]
	if !strings.Contains(newName, ".") {
		if _, ext := fileBaseExt(filepath.Base(abs)); ext != "" {
			newName += "." + ext
		}
	}
	destAbs := filepath.Clean(filepath.Join(filepath.Dir(abs), newName))
	if err := s.requireInside(ctx, destAbs); err != nil {
		return "", err
	}
	if err := s.fs.Rename(ctx, abs, destAbs); err != nil {
		return "", err
	}
	return "Renamed: " + s.display(ctx, abs) + " -> " + s.display(ctx, destAbs), nil
}

// cliDelete is `delete [file=] [path=] [permanent]`, from
// apps/web/app/cli/commands/fileWrites.ts. Without permanent it uses the
// system trash (fs.Trash), not a configured trash preference.
func (s *Service) cliDelete(ctx context.Context, a actions.Args) (string, error) {
	abs, err := s.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	if err := s.requireInside(ctx, abs); err != nil {
		return "", err
	}
	disp := s.display(ctx, abs)
	if a.Has("permanent") {
		if err := s.fs.Remove(ctx, abs); err != nil {
			return "", err
		}
		return "Deleted permanently: " + disp, nil
	}
	if err := s.fs.Trash(ctx, abs); err != nil {
		return "", err
	}
	return "Moved to trash: " + disp, nil
}

// cliRandom is `random [folder=] [newtab]`, from
// apps/web/app/cli/commands/navigation.ts.
func (s *Service) cliRandom(ctx context.Context, a actions.Args) (string, error) {
	f, disp, err := s.randomMarkdown(ctx, a.Params["folder"])
	if err != nil {
		return "", err
	}
	if disp == "" {
		return "No markdown files found.", nil
	}
	if err := s.openPath(ctx, f.Path, a.Has("newtab")); err != nil {
		return "", err
	}
	return "Opened: " + disp, nil
}

// cliRandomRead is `random:read [folder=]`, from
// apps/web/app/cli/commands/navigation.ts.
func (s *Service) cliRandomRead(ctx context.Context, a actions.Args) (string, error) {
	f, disp, err := s.randomMarkdown(ctx, a.Params["folder"])
	if err != nil {
		return "", err
	}
	if disp == "" {
		return "No markdown files found.", nil
	}
	data, err := s.fs.ReadBytes(ctx, f.Path, 0)
	if err != nil {
		return "", err
	}
	return disp + "\n\n" + string(data), nil
}

func (s *Service) randomMarkdown(ctx context.Context, folder string) (FileRef, string, error) {
	listing, err := s.Files(ctx)
	if err != nil {
		return FileRef{}, "", err
	}
	if folder != "" && !strings.HasSuffix(folder, "/") {
		folder += "/"
	}
	var picks []FileRef
	var displays []string
	for _, f := range listing.Files {
		if !strings.EqualFold(filepath.Ext(f.Rel), ".md") {
			continue
		}
		m, ok := s.mountByID(f.Mount)
		if !ok {
			continue
		}
		p := Display(m, f.Rel)
		if folder != "" && !strings.HasPrefix(p, folder) {
			continue
		}
		picks = append(picks, f)
		displays = append(displays, p)
	}
	if len(picks) == 0 {
		return FileRef{}, "", nil
	}
	i := rand.IntN(len(picks))
	return picks[i], displays[i], nil
}

func (s *Service) resolveFile(ctx context.Context, a actions.Args, allowActive bool) (string, error) {
	mounts, err := s.Mounts(ctx)
	if err != nil {
		return "", err
	}
	if p := a.Params["path"]; p != "" {
		return ResolvePath(mounts, p, a.Cwd)
	}
	if f := a.Params["file"]; f != "" {
		return ResolveLink(ctx, s.Files, mounts, f, a.Cwd)
	}
	if allowActive {
		if abs := s.activePath(ctx); abs != "" {
			return abs, nil
		}
		return "", fmt.Errorf("No active file. Use file=<name> or path=<path> to specify a file.")
	}
	return "", fmt.Errorf("Missing required parameter: file or path")
}

func (s *Service) resolveFolder(ctx context.Context, target, cwd string, fileIsError bool) (string, error) {
	mounts, err := s.Mounts(ctx)
	if err != nil {
		return "", err
	}
	target = strings.TrimSuffix(target, "/")
	for _, m := range mounts {
		if m.Name == target {
			return m.Path, nil
		}
	}
	for _, p := range Candidates(mounts, target, cwd) {
		e, err := s.fs.Stat(ctx, p)
		if err != nil {
			continue
		}
		if !e.Dir {
			if fileIsError {
				return "", fmt.Errorf("%q is a file, not a folder.", target)
			}
			return "", fmt.Errorf("Folder %q not found.", target)
		}
		return e.Path, nil
	}
	return "", fmt.Errorf("Folder %q not found.", target)
}

func (s *Service) activePath(ctx context.Context) string {
	if s.act == nil {
		return ""
	}
	p, err := s.act.ActiveFile(ctx)
	if err != nil {
		return ""
	}
	return p
}

func (s *Service) openPath(ctx context.Context, abs string, newTab bool) error {
	if s.act == nil {
		return fmt.Errorf("the window is closed")
	}
	return s.act.OpenPath(ctx, abs, newTab)
}

func (s *Service) writeTarget(ctx context.Context, target string) (string, error) {
	mounts, err := s.Mounts(ctx)
	if err != nil {
		return "", err
	}
	if len(mounts) == 0 {
		return "", fmt.Errorf("Path %q is outside the mounts.", target)
	}
	var abs string
	switch {
	case target == "":
		abs = mounts[0].Path
	case filepath.IsAbs(target):
		abs = filepath.Clean(target)
	default:
		name, rel, ok := strings.Cut(target, "/")
		if ok {
			found := false
			for _, m := range mounts {
				if m.Name == name {
					abs = filepath.Join(m.Path, filepath.FromSlash(rel))
					found = true
					break
				}
			}
			if !found {
				abs = filepath.Join(mounts[0].Path, filepath.FromSlash(target))
			}
		} else {
			abs = filepath.Join(mounts[0].Path, filepath.FromSlash(target))
		}
	}
	abs = filepath.Clean(abs)
	if _, _, ok := MountOf(mounts, abs); !ok {
		return "", fmt.Errorf("Path %q is outside the mounts.", target)
	}
	return abs, nil
}

func (s *Service) requireInside(ctx context.Context, abs string) error {
	mounts, err := s.Mounts(ctx)
	if err != nil {
		return err
	}
	if _, _, ok := MountOf(mounts, abs); !ok {
		return fmt.Errorf("Path %q is outside the mounts.", abs)
	}
	return nil
}

func (s *Service) availablePath(ctx context.Context, base, ext string) string {
	candidate := base
	if ext != "" {
		candidate = base + "." + ext
	}
	for n := 1; n < 10_000; n++ {
		if _, err := s.fs.Stat(ctx, candidate); err != nil {
			return candidate
		}
		if ext != "" {
			candidate = fmt.Sprintf("%s %d.%s", base, n, ext)
		} else {
			candidate = fmt.Sprintf("%s %d", base, n)
		}
	}
	return candidate
}

func (s *Service) display(ctx context.Context, abs string) string {
	mounts, _ := s.Mounts(ctx)
	return displayPath(mounts, abs)
}

func (s *Service) newWalker(ctx context.Context) *walker {
	return &walker{s: s, ctx: ctx, deadline: time.Now().Add(walkBudget)}
}

func (s *Service) stats(ctx context.Context, roots []string) (treeStats, error) {
	w := s.newWalker(ctx)
	var st treeStats
	for _, root := range roots {
		err := w.dir(root, func(e fsplugin.Entry) error {
			if e.Dir {
				st.folders++
			} else {
				st.files++
				st.size += e.Size
			}
			return nil
		})
		if errors.Is(err, errWalkLimit) {
			return st, walkLimitErr()
		}
		if err != nil {
			return st, err
		}
	}
	return st, nil
}

func (s *Service) listFolders(ctx context.Context, mounts []Mount, starts []string) ([]string, error) {
	w := s.newWalker(ctx)
	var out []string
	for _, start := range starts {
		out = append(out, displayPath(mounts, start))
		err := w.dir(start, func(e fsplugin.Entry) error {
			if e.Dir {
				out = append(out, displayPath(mounts, e.Path))
			}
			return nil
		})
		if errors.Is(err, errWalkLimit) {
			return nil, walkLimitErr()
		}
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

type treeStats struct {
	files, folders int
	size           int64
}

type walker struct {
	s        *Service
	ctx      context.Context
	deadline time.Time
	nfiles   int
}

func (w *walker) dir(path string, fn func(fsplugin.Entry) error) error {
	if err := w.ctx.Err(); err != nil {
		return err
	}
	if w.nfiles >= maxFiles || time.Now().After(w.deadline) {
		return errWalkLimit
	}
	entries, err := w.s.fs.List(w.ctx, path)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.Dir && skipDirs[e.Name] {
			continue
		}
		if !e.Dir {
			if w.nfiles >= maxFiles || time.Now().After(w.deadline) {
				return errWalkLimit
			}
			w.nfiles++
		}
		if err := fn(e); err != nil {
			return err
		}
		if e.Dir {
			if err := w.dir(e.Path, fn); err != nil {
				if errors.Is(err, errWalkLimit) || errors.Is(err, context.Canceled) {
					return err
				}
			}
		}
	}
	return nil
}

func walkLimitErr() error {
	return fmt.Errorf("The file listing stopped at its limit (%d files or %s); mount a narrower folder.", maxFiles, walkBudget)
}

func displayPath(mounts []Mount, abs string) string {
	if m, rel, ok := MountOf(mounts, abs); ok {
		if rel == "." {
			return m.Name
		}
		return Display(m, rel)
	}
	return abs
}

func mountPaths(mounts []Mount) []string {
	out := make([]string, len(mounts))
	for i, m := range mounts {
		out[i] = m.Path
	}
	return out
}

func tabbed(rows [][2]string) string {
	lines := make([]string, len(rows))
	for i, kv := range rows {
		lines[i] = kv[0] + "\t" + kv[1]
	}
	return strings.Join(lines, "\n")
}

func milli(ns int64) string {
	return strconv.FormatInt(ns/int64(time.Millisecond), 10)
}

func fileBaseExt(name string) (base, ext string) {
	i := strings.LastIndex(name, ".")
	if i <= 0 || i == len(name)-1 {
		return name, ""
	}
	return name[:i], strings.ToLower(name[i+1:])
}

func unescapeContent(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, `\n`, "\n"), `\t`, "\t")
}

// frontmatterContentStart is Xx() from apps/web/app/cli/commands/fileWrites.ts:
// after a terminated YAML block, else 0.
func frontmatterContentStart(text string) int {
	var openerLen int
	switch {
	case strings.HasPrefix(text, "---\r\n"):
		openerLen = 5
	case strings.HasPrefix(text, "---\n"):
		openerLen = 4
	default:
		return 0
	}
	from := openerLen
	for {
		i := strings.Index(text[from:], "---")
		if i < 0 {
			return 0
		}
		i += from
		if i > 0 && text[i-1] == '\n' {
			rest := text[i+3:]
			switch {
			case rest == "":
				return i + 3
			case strings.HasPrefix(rest, "\r\n"):
				return i + 5
			case strings.HasPrefix(rest, "\n"):
				return i + 4
			}
		}
		from = i + 1
	}
}
