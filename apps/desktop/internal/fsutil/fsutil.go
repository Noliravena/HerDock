package fsutil

import (
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Node struct {
	Name      string  `json:"name"`
	Path      string  `json:"path"`
	Kind      string  `json:"kind"` // file | dir
	GitStatus *string `json:"gitStatus,omitempty"`
	Children  []Node  `json:"children,omitempty"`
}

func EnsureInside(root, rel string) (abs string, cleanRel string, err error) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", "", err
	}
	cleanRel = filepath.Clean(rel)
	if cleanRel == "." {
		return rootAbs, "", nil
	}
	if strings.HasPrefix(cleanRel, "..") || filepath.IsAbs(cleanRel) {
		return "", "", errors.New("path escapes workspace")
	}
	abs = filepath.Join(rootAbs, cleanRel)
	abs, err = filepath.Abs(abs)
	if err != nil {
		return "", "", err
	}
	relCheck, err := filepath.Rel(rootAbs, abs)
	if err != nil || strings.HasPrefix(relCheck, "..") {
		return "", "", errors.New("path escapes workspace")
	}
	return abs, filepath.ToSlash(relCheck), nil
}

func ReadFile(root, rel string) (string, error) {
	abs, _, err := EnsureInside(root, rel)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func WriteFile(root, rel, content string) error {
	abs, _, err := EnsureInside(root, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0o644)
}

func Tree(root string, maxDepth int) ([]Node, error) {
	if maxDepth <= 0 {
		maxDepth = 4
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	gitMap := gitStatusMap(rootAbs)
	var walk func(dir, rel string, depth int) ([]Node, error)
	walk = func(dir, rel string, depth int) ([]Node, error) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		var nodes []Node
		for _, e := range entries {
			name := e.Name()
			if name == ".git" || name == "node_modules" || name == ".turbo" || name == "dist" {
				continue
			}
			childRel := name
			if rel != "" {
				childRel = rel + "/" + name
			}
			n := Node{Name: name, Path: childRel}
			if st, ok := gitMap[childRel]; ok {
				s := st
				n.GitStatus = &s
			}
			if e.IsDir() {
				n.Kind = "dir"
				if depth < maxDepth {
					kids, err := walk(filepath.Join(dir, name), childRel, depth+1)
					if err != nil {
						return nil, err
					}
					n.Children = kids
				}
			} else {
				n.Kind = "file"
			}
			nodes = append(nodes, n)
		}
		return nodes, nil
	}
	return walk(rootAbs, "", 1)
}

func gitStatusMap(root string) map[string]string {
	out := map[string]string{}
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = root
	b, err := cmd.Output()
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		if len(line) < 4 {
			continue
		}
		code := strings.TrimSpace(line[:2])
		path := strings.TrimSpace(line[3:])
		if i := strings.Index(path, " -> "); i >= 0 {
			path = path[i+4:]
		}
		path = filepath.ToSlash(path)
		switch {
		case strings.Contains(code, "A") || code == "??":
			out[path] = "A"
		case strings.Contains(code, "D"):
			out[path] = "D"
		case strings.Contains(code, "M") || strings.Contains(code, "R"):
			out[path] = "M"
		default:
			out[path] = "U"
		}
	}
	return out
}

func GitBranch(root string) string {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = root
	b, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func GitDirtySummary(root string) string {
	cmd := exec.Command("git", "diff", "--numstat")
	cmd.Dir = root
	b, err := cmd.Output()
	if err != nil {
		return ""
	}
	add, del := 0, 0
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		var a, d int
		_, _ = fmtSscanf(fields[0], &a)
		_, _ = fmtSscanf(fields[1], &d)
		add += a
		del += d
	}
	if add == 0 && del == 0 {
		// untracked rough count
		st := gitStatusMap(root)
		if len(st) == 0 {
			return ""
		}
		return "+?"
	}
	if del == 0 {
		return "+" + itoa(add)
	}
	return "+" + itoa(add) + " −" + itoa(del)
}

func fmtSscanf(s string, n *int) (int, error) {
	if s == "-" {
		*n = 0
		return 1, nil
	}
	v := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			*n = 0
			return 0, errors.New("nan")
		}
		v = v*10 + int(c-'0')
	}
	*n = v
	return 1, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil || !errors.Is(err, fs.ErrNotExist) && err == nil
}

func SnapshotFile(root, rel, destDir string) (string, error) {
	abs, clean, err := EnsureInside(root, rel)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	dest := filepath.Join(destDir, filepath.FromSlash(clean))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(dest, b, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}
