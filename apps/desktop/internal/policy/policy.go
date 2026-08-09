package policy

import (
	"path/filepath"
	"regexp"
	"strings"
)

type PathRule struct {
	Pattern  string `json:"pattern"`
	Absolute bool   `json:"absolute,omitempty"`
}

type NetworkRule struct {
	HostPattern string `json:"hostPattern"`
}

type Bundle struct {
	Version              string        `json:"version"`
	OrgID                string        `json:"orgId"`
	MaxAutoExecute       string        `json:"maxAutoExecute"`
	ForceApprovalClasses []string      `json:"forceApprovalClasses"`
	ReadAllow            []PathRule    `json:"readAllow"`
	WriteAllow           []PathRule    `json:"writeAllow"`
	WriteDeny            []PathRule    `json:"writeDeny"`
	NetworkAllow         []NetworkRule `json:"networkAllow"`
	NetworkDefaultDeny   bool          `json:"networkDefaultDeny"`
	EnabledConnectors    []string      `json:"enabledConnectors"`
	Label                string        `json:"label,omitempty"`
}

func OfflineDefault(orgID string) Bundle {
	if orgID == "" {
		orgID = "local"
	}
	return Bundle{
		Version:              "offline-1",
		OrgID:                orgID,
		MaxAutoExecute:       "ask_risky",
		ForceApprovalClasses: []string{"package_install", "network", "destructive", "unknown"},
		ReadAllow:            []PathRule{{Pattern: "**/*"}},
		WriteAllow:           []PathRule{{Pattern: "**/*"}, {Pattern: "out/**"}},
		WriteDeny:            nil,
		NetworkAllow:         nil,
		NetworkDefaultDeny:   true,
		EnabledConnectors:    nil,
		Label:                "Offline strict default",
	}
}

func DemoOrg() Bundle {
	b := OfflineDefault("org_demo")
	b.Version = "demo-1"
	b.MaxAutoExecute = "auto_workspace"
	b.WriteAllow = []PathRule{
		{Pattern: "**/*"},
	}
	b.WriteDeny = []PathRule{
		{Pattern: ".env"},
		{Pattern: "**/.env*"},
		{Pattern: "**/secrets/**"},
	}
	b.NetworkAllow = []NetworkRule{
		{HostPattern: "api.github.com"},
		{HostPattern: "registry.npmjs.org"},
	}
	b.EnabledConnectors = []string{"github", "feishu"}
	b.Label = "Demo org policy"
	return b
}

var autoRank = map[string]int{
	"ask_always":     0,
	"ask_risky":      1,
	"auto_workspace": 2,
	"auto_all":       3,
}

func ClampAuto(requested, max string) string {
	if autoRank[requested] <= autoRank[max] {
		return requested
	}
	return max
}

func NormalizeRel(p string) string {
	p = filepath.ToSlash(p)
	p = strings.TrimPrefix(p, "./")
	return p
}

func matchGlob(pattern, path string) bool {
	pat := NormalizeRel(pattern)
	target := NormalizeRel(path)
	if pat == "**/*" || pat == "**" {
		return true
	}
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(pat); {
		if i+1 < len(pat) && pat[i] == '*' && pat[i+1] == '*' {
			b.WriteString(".*")
			i += 2
			if i < len(pat) && pat[i] == '/' {
				i++
			}
			continue
		}
		if pat[i] == '*' {
			b.WriteString("[^/]*")
			i++
			continue
		}
		b.WriteString(regexp.QuoteMeta(string(pat[i])))
		i++
	}
	b.WriteString("$")
	re, err := regexp.Compile(b.String())
	if err != nil {
		return false
	}
	return re.MatchString(target)
}

func matchesAny(path string, rules []PathRule) bool {
	for _, r := range rules {
		if matchGlob(r.Pattern, path) {
			return true
		}
	}
	return false
}

func EvaluateWrite(b Bundle, rel string) bool {
	path := NormalizeRel(rel)
	if matchesAny(path, b.WriteDeny) {
		return false
	}
	return matchesAny(path, b.WriteAllow)
}

func EvaluateRead(b Bundle, rel string) bool {
	return matchesAny(NormalizeRel(rel), b.ReadAllow)
}

func ClassifyShell(cmd string) string {
	c := strings.ToLower(strings.TrimSpace(cmd))
	if c == "" {
		return "unknown"
	}
	destructive := regexp.MustCompile(`\b(rm\s+-rf|del\s+/s|format\s+|mkfs)\b`)
	network := regexp.MustCompile(`\b(curl|wget|invoke-webrequest|npm\s+publish)\b`)
	pkg := regexp.MustCompile(`\b(npm\s+i|npm\s+install|pnpm\s+add|pip\s+install|brew\s+install)\b`)
	readOnly := regexp.MustCompile(`\b(cat|type|ls|dir|echo|write-output|git\s+status|git\s+diff|rg|find|pwd|whoami)\b`)
	writeish := regexp.MustCompile(`\b(python|node|pnpm|npm\s+test|go\s+test|git\s+commit|git\s+push)\b`)
	switch {
	case destructive.MatchString(c):
		return "destructive"
	case network.MatchString(c):
		return "network"
	case pkg.MatchString(c):
		return "package_install"
	case readOnly.MatchString(c):
		return "read_only"
	case writeish.MatchString(c):
		return "workspace_write"
	default:
		return "unknown"
	}
}

func contains(ss []string, x string) bool {
	for _, s := range ss {
		if s == x {
			return true
		}
	}
	return false
}

func RequiresApproval(b Bundle, cmd, autoExecute string) (class string, require bool) {
	class = ClassifyShell(cmd)
	if autoExecute == "ask_always" {
		return class, true
	}
	if contains(b.ForceApprovalClasses, class) {
		return class, true
	}
	switch autoExecute {
	case "ask_risky":
		return class, class == "package_install" || class == "network" || class == "destructive" || class == "unknown"
	case "auto_workspace":
		return class, class == "network" || class == "destructive"
	default:
		return class, false
	}
}
