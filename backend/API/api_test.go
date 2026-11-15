package API

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"spaceapps/custom"
	"spaceapps/jsonParser"
	"spaceapps/knn"
)

func newServer(t *testing.T, own bool) http.Handler {
	t.Helper()
	p, err := jsonParser.New("../knn/testdata")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Parser: p}
	if own {
		s.Custom = custom.NewStore()
	}
	return s.Routes()
}

func do(t *testing.T, h http.Handler, method, url string, body []byte) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, url, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("%s %s: invalid JSON response: %v\n%s", method, url, err, rec.Body.String())
		}
	}
	return rec, out
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func matchIDs(resp map[string]any) []string {
	var ids []string
	for _, m := range resp["matches"].([]any) {
		ids = append(ids, m.(map[string]any)["regionId"].(string))
	}
	return ids
}

// GET /api/analog gives exactly what the knn package computes directly (the pipeline
// main.go used before the API integration), for every region and every filter.
func TestBuiltinAnalogMatchesKNN(t *testing.T) {
	h := newServer(t, false)
	p, err := jsonParser.New("../knn/testdata")
	if err != nil {
		t.Fatal(err)
	}
	earth, err := p.GetEarthRegions()
	if err != nil {
		t.Fatal(err)
	}
	for _, planet := range []string{"moon", "mars"} {
		regs, err := p.GetRegions(planet)
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range append([]string{""}, knn.MissionNames()...) {
			w, err := knn.WeightsFor(f, knn.FeatureNames())
			if err != nil {
				t.Fatal(err)
			}
			for _, reg := range regs {
				target, pool, err := knn.Prepare(reg, earth)
				if err != nil {
					t.Fatal(err)
				}
				want, err := knn.FindMostSimilar(target, pool, w, TopK)
				if err != nil {
					t.Fatal(err)
				}
				wantRob, err := knn.AnalyzeRobustness(target, pool, f, TopK, RobustEps, RobustTrials, RobustSeed)
				if err != nil {
					t.Fatal(err)
				}
				url := "/api/analog?planet=" + planet + "&regionId=" + reg.RegionId + "&filter=" + f
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
				if rec.Code != 200 {
					t.Fatalf("%s: %d %s", url, rec.Code, rec.Body)
				}
				var got AnalogResponse
				if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if len(got.Matches) != len(want) {
					t.Fatalf("%s: %d matches, want %d", url, len(got.Matches), len(want))
				}
				for k := range want {
					g := got.Matches[k]
					if g.RegionID != want[k].RegionID || math.Abs(g.Similarity-want[k].Similarity) > 1e-12 {
						t.Fatalf("%s match %d: %s %.15f, want %s %.15f", url, k, g.RegionID, g.Similarity, want[k].RegionID, want[k].Similarity)
					}
				}
				if mustJSON(got.Robustness) != mustJSON(wantRob) {
					t.Fatalf("%s: robustness differs\n got %s\nwant %s", url, mustJSON(got.Robustness), mustJSON(wantRob))
				}
			}
		}
	}
	// POST /api/calculate with a JSON body gives the same result as GET.
	_, viaGet := do(t, h, "GET", "/api/analog?planet=mars&regionId=MARS-001&filter=mobility", nil)
	body := []byte(`{"misiones":{"filter":"mobility"},"caracteristicas":{"planet":"mars","regionId":"MARS-001"}}`)
	rec, viaPost := do(t, h, "POST", "/api/calculate", body)
	if rec.Code != 200 || strings.Join(matchIDs(viaPost), ",") != strings.Join(matchIDs(viaGet), ",") {
		t.Fatalf("POST calculate: %d %v vs %v", rec.Code, matchIDs(viaPost), matchIDs(viaGet))
	}
}

func TestUploadsDisabledWithoutFlag(t *testing.T) {
	h := newServer(t, false)
	for _, r := range []struct{ m, u string }{
		{"POST", "/api/custom/regions"}, {"POST", "/api/custom/missions"}, {"GET", "/api/custom"}, {"DELETE", "/api/custom"},
	} {
		rec, _ := do(t, h, r.m, r.u, []byte(`{}`))
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: status %d, want 403", r.m, r.u, rec.Code)
		}
	}
	_, cat := do(t, h, "GET", "/api/catalog", nil)
	if cat["capabilities"].(map[string]any)["ownRegions"] != false {
		t.Fatal("catalog should report ownRegions=false")
	}
}

func TestOwnRegionsFlow(t *testing.T) {
	h := newServer(t, true)

	rec, _ := do(t, h, "POST", "/api/custom/regions", readFile(t, "../examples/custom_regions.example.json"))
	if rec.Code != 200 {
		t.Fatalf("upload regions: %d %s", rec.Code, rec.Body)
	}
	rec, _ = do(t, h, "POST", "/api/custom/missions", readFile(t, "../examples/custom_missions.example.json"))
	if rec.Code != 200 {
		t.Fatalf("upload missions: %d %s", rec.Code, rec.Body)
	}

	// The planet now lists built-in + custom regions, marked by source.
	_, regs := do(t, h, "GET", "/api/regions/all?planet=mars", nil)
	var custom []string
	for _, r := range regs["regions"].([]any) {
		rm := r.(map[string]any)
		if rm["source"] == "custom" {
			custom = append(custom, rm["regionId"].(string))
		}
	}
	if len(custom) != 1 || custom[0] != "UNI-MARS-01" {
		t.Fatalf("custom mars regions: %v", custom)
	}

	// Custom target + custom mission.
	rec, resp := do(t, h, "GET", "/api/analog?planet=mars&regionId=UNI-MARS-01&filter=sonda_penetradora", nil)
	if rec.Code != 200 {
		t.Fatalf("analog: %d %s", rec.Code, rec.Body)
	}
	if resp["mission"].(map[string]any)["source"] != "custom" || resp["selectedRegion"].(map[string]any)["source"] != "custom" {
		t.Fatalf("sources: %v / %v", resp["mission"], resp["selectedRegion"])
	}
	// The custom variable is compared and weighed.
	found := false
	for _, m := range resp["matches"].([]any) {
		for _, f := range m.(map[string]any)["features"].([]any) {
			fm := f.(map[string]any)
			if fm["name"] == "magnetic_susceptibility" {
				found = true
				if fm["group"] != "custom" || !(fm["weight"].(float64) > 0) {
					t.Fatalf("custom feature: %v", fm)
				}
			}
		}
	}
	if !found {
		t.Fatal("custom variable missing from breakdown")
	}
	// The sensitivity analysis also runs on the custom model and mission.
	rob := resp["robustness"].(map[string]any)
	if rob["perturbs"] != "mission_profile" || rob["trials"].(float64) != RobustTrials {
		t.Fatalf("custom robustness: %v", rob)
	}
	if s := rob["top1Stability"].(float64); s < 0 || s > 1 {
		t.Fatalf("custom top1Stability %v outside [0,1]", s)
	}

	// A built-in target can also use a custom mission, and the custom Earth analog is a candidate.
	rec, _ = do(t, h, "GET", "/api/analog?planet=mars&regionId=MARS-001&filter=estacion_satelite", nil)
	if rec.Code != 200 {
		t.Fatalf("builtin target + custom mission: %d %s", rec.Code, rec.Body)
	}

	// Catalog exposes the custom variable and missions.
	_, cat := do(t, h, "GET", "/api/catalog", nil)
	if !strings.Contains(mustJSON(cat["features"]), "magnetic_susceptibility") || !strings.Contains(mustJSON(cat["missions"]), "sonda_penetradora") {
		t.Fatal("catalog missing custom items")
	}

	// Unknown filter lists custom missions too.
	rec, e := do(t, h, "GET", "/api/analog?planet=mars&regionId=MARS-001&filter=nope", nil)
	if rec.Code != 400 || !strings.Contains(e["error"].(string), "sonda_penetradora") {
		t.Fatalf("unknown filter: %d %v", rec.Code, e)
	}

	// Clear: custom region disappears.
	rec, _ = do(t, h, "DELETE", "/api/custom", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	rec, _ = do(t, h, "GET", "/api/analog?planet=mars&regionId=UNI-MARS-01", nil)
	if rec.Code != 404 {
		t.Fatalf("after clear: %d", rec.Code)
	}
}

// An Earth analog with exactly the target's values must be top-1 with similarity 1.
func TestIdenticalCustomAnalogIsTop1(t *testing.T) {
	h := newServer(t, true)
	region := `"name":"x","coordinates":{"latitude":1,"longitude":2},
		"coreVariables":{"slope":3,"radar_roughness":0.4,"insolation":150,"dust_aerosols":0.3},
		"auditVariables":{"grain_size_um":120,"surface_pressure_kpa":60},
		"customVariables":{"foo":7}`
	body := `{"variables":[{"name":"foo","memberships":{"MEC":1}}],"regions":[
		{"planet":"mars","regionId":"T1",` + region + `},
		{"planet":"earth","regionId":"E1",` + region + `}]}`
	rec, _ := do(t, h, "POST", "/api/custom/regions", []byte(body))
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	for _, f := range append([]string{""}, knn.MissionNames()...) {
		_, resp := do(t, h, "GET", "/api/analog?planet=mars&regionId=T1&filter="+f, nil)
		top := resp["matches"].([]any)[0].(map[string]any)
		if top["regionId"] != "E1" || math.Abs(top["similarity"].(float64)-1) > 1e-12 {
			t.Fatalf("filter %q: top %v sim %v", f, top["regionId"], top["similarity"])
		}
	}
}

func TestInvalidUploadReturnsPaths(t *testing.T) {
	h := newServer(t, true)
	rec, resp := do(t, h, "POST", "/api/custom/regions", []byte(`{"planet":"mars","regions":[{"regionId":"MARS-001","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":1}}]}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	paths := mustJSON(resp["errors"])
	if !strings.Contains(paths, "regions[0].regionId") || !strings.Contains(paths, "regions[0].name") {
		t.Fatalf("errors: %s", paths)
	}
	// A failed upload does not replace what was loaded before.
	_, state := do(t, h, "GET", "/api/custom", nil)
	if len(state["regions"].(map[string]any)["mars"].([]any)) != 0 {
		t.Fatal("failed upload changed the store")
	}
}

func TestUploadTooLarge(t *testing.T) {
	h := newServer(t, true)
	big := append([]byte(`{"planet":"mars","regions":[],"x":"`), bytes.Repeat([]byte("a"), MaxUploadBytes)...)
	rec, _ := do(t, h, "POST", "/api/custom/regions", append(big, '"', '}'))
	if rec.Code != http.StatusRequestEntityTooLarge && rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
}

// Uploads and queries at the same time (run with -race).
func TestConcurrentUploadsAndQueries(t *testing.T) {
	h := newServer(t, true)
	regions := readFile(t, "../examples/custom_regions.example.json")
	missions := readFile(t, "../examples/custom_missions.example.json")
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); do(t, h, "POST", "/api/custom/regions", regions) }()
		go func() { defer wg.Done(); do(t, h, "POST", "/api/custom/missions", missions) }()
		go func() {
			defer wg.Done()
			rec, _ := do(t, h, "GET", "/api/analog?planet=mars&regionId=MARS-001&filter=mobility", nil)
			if rec.Code != 200 {
				t.Errorf("analog during upload: %d", rec.Code)
			}
		}()
	}
	wg.Wait()
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
