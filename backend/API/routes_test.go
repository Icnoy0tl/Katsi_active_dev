package API

// Contract tests for the routes moved from package main into package API
// (status, filters, missions, ranked regions, custom analog) and for the
// JSON 404/405 replies.

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

func TestStatusPageAndImage(t *testing.T) {
	h := newServer(t, false)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/status", nil))
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("status: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	page := rec.Body.String()
	if !strings.Contains(page, "Status: 200 ok") || !strings.Contains(page, `src="/api/status/image"`) {
		t.Fatalf("status page missing message or image:\n%s", page)
	}

	// knn/testdata has no status.png: a missing image is a JSON 404, not a crash.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/status/image", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing image: %d", rec.Code)
	}

	// With the real data directory the PNG is served.
	p, err := jsonParser.New("../data")
	if err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	(&Server{Parser: p}).Routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/status/image", nil))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" || rec.Body.Len() == 0 {
		t.Fatalf("image: %d %q %d bytes", rec.Code, rec.Header().Get("Content-Type"), rec.Body.Len())
	}
}

func TestRouterErrorsAreJSON(t *testing.T) {
	h := newServer(t, false)
	rec, body := do(t, h, "GET", "/api/nope", nil)
	if rec.Code != http.StatusNotFound || body["error"] == nil {
		t.Fatalf("unknown route: %d %v", rec.Code, body)
	}
	rec, body = do(t, h, "DELETE", "/api/analog", nil)
	if rec.Code != http.StatusMethodNotAllowed || !strings.Contains(body["error"].(string), "GET") {
		t.Fatalf("wrong method: %d %v", rec.Code, body)
	}
}

func TestFiltersAndMissions(t *testing.T) {
	h := newServer(t, false)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/filters", nil))
	var reps []knn.WeightReport
	if err := json.Unmarshal(rec.Body.Bytes(), &reps); err != nil || rec.Code != 200 {
		t.Fatalf("/api/filters: %d %v", rec.Code, err)
	}
	if len(reps) != len(knn.MissionNames()) {
		t.Fatalf("/api/filters: %d missions, want %d", len(reps), len(knn.MissionNames()))
	}

	rec, m := do(t, h, "GET", "/api/missions", nil)
	if rec.Code != 200 {
		t.Fatalf("/api/missions: %d", rec.Code)
	}
	if len(m["missions"].([]any)) != len(knn.MissionNames()) ||
		len(m["variables"].([]any)) != len(knn.FeatureNames()) ||
		len(m["categories"].([]any)) != len(knn.Categories) {
		t.Fatalf("/api/missions: %v", m)
	}
}

func TestRankedRegions(t *testing.T) {
	h := newServer(t, false)
	for _, planet := range []string{"moon", "mars"} {
		for _, f := range append([]string{""}, knn.MissionNames()...) {
			url := "/api/regions?planet=" + planet + "&filter=" + f
			rec, body := do(t, h, "GET", url, nil)
			if rec.Code != 200 {
				t.Fatalf("%s: %d %v", url, rec.Code, body)
			}
			regs := body["regions"].([]any)
			excluded := body["excluded"].([]any)
			if total := int(body["total"].(float64)); len(regs)+len(excluded) != total || total == 0 {
				t.Fatalf("%s: %d ranked + %d excluded != total %d", url, len(regs), len(excluded), total)
			}
			prev := math.Inf(1)
			for _, r := range regs {
				rm := r.(map[string]any)
				score := rm["score"].(float64)
				cov := rm["dataCoverage"].(float64)
				if score > prev || score < 0 || score > 1 {
					t.Fatalf("%s: scores not sorted descending in [0,1]: %v after %v", url, score, prev)
				}
				if cov < knn.MinCoverage || cov > 1 {
					t.Fatalf("%s: dataCoverage %v outside [MinCoverage, 1]", url, cov)
				}
				best := rm["bestAnalog"].(map[string]any)
				if best["similarity"].(float64) != score || !strings.HasPrefix(best["regionId"].(string), "EARTH-") {
					t.Fatalf("%s: bestAnalog %v vs score %v", url, best, score)
				}
				prev = score
			}
		}
	}
	for _, url := range []string{"/api/regions?planet=venus", "/api/regions?planet=earth", "/api/regions?planet=mars&filter=nope"} {
		if rec, _ := do(t, h, "GET", url, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", url, rec.Code)
		}
	}
}

func postCustom(t *testing.T, h http.Handler, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	return do(t, h, "POST", "/api/analog/custom", []byte(body))
}

// A user region identical to an Earth site must find that site first, with similarity 1.
func TestCustomAnalogIdenticalRegion(t *testing.T) {
	h := newServer(t, false)
	p, _ := jsonParser.New("../knn/testdata")
	earth, err := p.GetEarthRegions()
	if err != nil {
		t.Fatal(err)
	}
	site := earth[0]
	site.RegionId, site.Name = "MY-SITE", "copy of "+site.Name
	region, _ := json.Marshal(site)

	for _, mission := range []string{`"mobility"`, `{"mission":"perception"}`, `{"name":"mine","profile":{"GEO":0.5,"MEC":0.5}}`} {
		rec, body := postCustom(t, h, `{"characteristics":`+string(region)+`,"mission":`+mission+`}`)
		if rec.Code != 200 {
			t.Fatalf("mission %s: %d %v", mission, rec.Code, body)
		}
		results := body["results"].([]any)
		if len(results) != 1 {
			t.Fatalf("mission %s: %d results", mission, len(results))
		}
		res := results[0].(map[string]any)
		top := res["matches"].([]any)[0].(map[string]any)
		if top["regionId"] != earth[0].RegionId || math.Abs(top["similarity"].(float64)-1) > 1e-12 {
			t.Fatalf("mission %s: top %v sim %v, want %s sim 1", mission, top["regionId"], top["similarity"], earth[0].RegionId)
		}
		if top["region"].(map[string]any)["source"] != "builtin" || len(top["features"].([]any)) == 0 {
			t.Fatalf("mission %s: match region/features: %v", mission, top)
		}
		if res["dataCoverage"].(float64) <= 0 {
			t.Fatalf("mission %s: dataCoverage %v", mission, res["dataCoverage"])
		}
	}
	// The mission name of a custom profile is echoed back.
	_, body := postCustom(t, h, `{"characteristics":`+string(region)+`,"mission":{"name":"mine","profile":{"GEO":1}}}`)
	if body["mission"].(map[string]any)["mission"] != "mine" {
		t.Fatalf("custom mission name: %v", body["mission"])
	}
}

func TestCustomAnalogErrors(t *testing.T) {
	h := newServer(t, false)
	region := `{"regionId":"R1","name":"r","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}}`
	cases := []struct {
		name, body string
		want       int
	}{
		{"not JSON", `xx`, 400},
		{"unknown top-level field", `{"characteristics":` + region + `,"mission":"mobility","extra":1}`, 400},
		{"missing characteristics", `{"mission":"mobility"}`, 400},
		{"missing mission", `{"characteristics":` + region + `}`, 400},
		{"unknown mission", `{"characteristics":` + region + `,"mission":"nope"}`, 400},
		{"mission and profile", `{"characteristics":` + region + `,"mission":{"mission":"mobility","profile":{"GEO":1}}}`, 400},
		{"bad profile category", `{"characteristics":` + region + `,"mission":{"profile":{"XYZ":1}}}`, 400},
		{"typo in a variable", `{"characteristics":{"regionId":"R1","name":"r","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slopee":3}},"mission":"mobility"}`, 400},
		{"no variables", `{"characteristics":{"regionId":"R1","name":"r","coordinates":{"latitude":1,"longitude":2}},"mission":"mobility"}`, 400},
		{"bad coordinates", `{"characteristics":{"regionId":"R1","name":"r","coordinates":{"latitude":91,"longitude":2},"coreVariables":{"slope":3}},"mission":"mobility"}`, 400},
		{"bad regionId", `{"characteristics":{"regionId":"../x","name":"r","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}},"mission":"mobility"}`, 400},
		{"duplicated regionId", `{"characteristics":{"regions":[` + region + `,` + region + `]},"mission":"mobility"}`, 400},
		{"no weighted variable", `{"characteristics":` + region + `,"mission":{"profile":{"ATM":1}}}`, 422},
	}
	for _, c := range cases {
		rec, body := postCustom(t, h, c.body)
		if rec.Code != c.want || body["error"] == nil {
			t.Errorf("%s: %d %v, want %d with an error message", c.name, rec.Code, body, c.want)
		}
	}
	big := bytes.Repeat([]byte(" "), 1<<20+1)
	if rec, _ := do(t, h, "POST", "/api/analog/custom", big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("body over 1 MB: %d, want 413", rec.Code)
	}
}
