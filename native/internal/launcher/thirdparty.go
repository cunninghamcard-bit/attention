package launcher

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

// Third-party service plugins (RFC 0001 §5.11): installing one is adding
// its row to plugins.json in the configuration folder, in rutis.json's own
// terms — the runtimes it needs and its rows — which every run's rutis.json
// takes in. No rebuild: rutis-host runs it, in any of its languages.
//
//	{
//	  "runtimes": { "py": { "project": "/path/to/plugins", "python": "/path/to/.venv/bin/python" } },
//	  "rows": [ { "id": "hello", "name": "py:hello" } ]
//	}

// ThirdPartyPath is plugins.json's path.
func ThirdPartyPath() string { return filepath.Join(paths.ConfigDir(), "plugins.json") }

// thirdParty is plugins.json.
type thirdParty struct {
	Runtimes map[string]json.RawMessage `json:"runtimes"`
	Rows     []map[string]any           `json:"rows"`
}

// withThirdParty adds plugins.json's runtimes and rows to cfg: a runtime
// cfg has already (go) takes its binaries, a row whose id cfg has is
// refused. A missing file adds nothing.
func withThirdParty(cfg map[string]any, path string) error {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var tp thirdParty
	if err := json.Unmarshal(data, &tp); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	runtimes := cfg["runtimes"].(map[string]any)
	for name, raw := range tp.Runtimes {
		var rt map[string]any
		if err := json.Unmarshal(raw, &rt); err != nil {
			return fmt.Errorf("%s: runtime %s: %w", path, name, err)
		}
		if name == "go" {
			// The third party's Go binaries join attention's; the rest of
			// runtimes.go is attention's (rutis has one for every binary).
			goRT := runtimes["go"].(map[string]any)
			bins, _ := rt["binaries"].([]any)
			for _, b := range bins {
				if s, ok := b.(string); ok {
					goRT["binaries"] = append(goRT["binaries"].([]string), s)
				}
			}
			continue
		}
		runtimes[name] = rt
	}
	rows := cfg["rows"].([]map[string]any)
	ids := map[string]bool{}
	for _, r := range rows {
		if id, ok := r["id"].(string); ok {
			ids[id] = true
		}
	}
	for _, r := range tp.Rows {
		id, _ := r["id"].(string)
		if id == "" || ids[id] {
			return fmt.Errorf("%s: a row needs an id of its own (%q)", path, id)
		}
		ids[id] = true
		rows = append(rows, r)
	}
	cfg["rows"] = rows
	return nil
}
