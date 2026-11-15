package main

// HTTP contract tests using the real data (knn/testdata).

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	p, err := jsonParser.New("knn/testdata")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/analog", analogHandler(p))
	mux.HandleFunc("GET /api/filters", filtersHandler)
	srv := httptest.NewServer(cors("http://localhost:5173", mux))
	t.Cleanup(srv.Close)
	return srv
}

func TestAnalogStatusCodes(t *testing.T) {
	srv := newTestServer(t)
	cases := []struct {
		query string
		want  int
	}{
		{"planet=mars&regionId=MARS-001&filter=mobility", http.StatusOK},
		{"planet=MOON&regionId=MOON-003&filter=", http.StatusOK}, // planet is normalized to lowercase
		{"planet=mars&regionId=MARS-001", http.StatusOK},         // no filter
		{"planet=venus&regionId=MARS-001", http.StatusBadRequest},
		{"planet=../etc&regionId=MARS-001", http.StatusBadRequest},
		{"planet=mars&regionId=../../earth", http.StatusBadRequest},
		{"planet=mars&regionId=", http.StatusBadRequest},
		{"planet=mars&regionId=MARS-999", http.StatusNotFound},
		{"planet=mars&regionId=MOON-001", http.StatusNotFound}, // region from another planet
		{"planet=mars&regionId=MARS-001&filter=thermal_cycles", http.StatusBadRequest},
	}
	for _, c := range cases {
		resp, err := http.Get(srv.URL + "/api/analog?" + c.query)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != c.want {
			t.Errorf("%s: status %d, want %d", c.query, resp.StatusCode, c.want)
		}
	}
}

func TestAnalogResponseShape(t *testing.T) {
	srv := newTestServer(t)
	get := func(origin string) *http.Response {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/analog?planet=mars&regionId=MARS-001&filter=mobility", nil)
		req.Header.Set("Origin", origin)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	// CORS: the allowed origin is echoed back; any other origin gets no header
	foreign := get("https://evil.example")
	foreign.Body.Close()
	if got := foreign.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("CORS for a foreign origin: %q, want none", got)
	}
	resp := get("http://localhost:5173")
	defer resp.Body.Close()
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("CORS: %q", got)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	matches, _ := body["matches"].([]any)
	if len(matches) != topK {
		t.Fatalf("expected %d matches, got %d", topK, len(matches))
	}
	for _, m := range matches {
		mm := m.(map[string]any)
		for _, k := range []string{"regionId", "similarity", "coverage", "region"} {
			if _, ok := mm[k]; !ok {
				t.Errorf("match missing %q", k)
			}
		}
	}
	for _, k := range []string{"robustness", "extrapolation", "selectedRegion"} {
		if _, ok := body[k]; !ok {
			t.Errorf("response missing %q", k)
		}
	}
	// null stays null (not 0) in the selected region
	audit := body["selectedRegion"].(map[string]any)["auditVariables"].(map[string]any)
	if v, ok := audit["salinity_wt_pct"]; !ok || v != nil {
		t.Errorf("salinity_wt_pct must be null, got %v", v)
	}
}

func TestPreflightAndFilters(t *testing.T) {
	srv := newTestServer(t)
	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/api/analog", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("OPTIONS: status %d", resp.StatusCode)
	}
	resp, err = http.Get(srv.URL + "/api/filters")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var reps []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&reps); err != nil || len(reps) != len(knn.MissionNames()) {
		t.Fatalf("/api/filters: %v, %d missions", err, len(reps))
	}
}
