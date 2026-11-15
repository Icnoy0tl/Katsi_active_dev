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
	mux.HandleFunc("GET /api/health", healthHandler)
	srv := httptest.NewServer(cors(parseOrigins(defaultAllowedOrigins), mux))
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

func TestCORS(t *testing.T) {
	srv := newTestServer(t)
	do := func(method, origin string) *http.Response {
		req, _ := http.NewRequest(method, srv.URL+"/api/filters", nil)
		req.Header.Set("Origin", origin)
		if method == http.MethodOptions {
			req.Header.Set("Access-Control-Request-Method", "POST")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	cases := []struct {
		origin string
		ok     bool
	}{
		{"https://katsi.onrender.com", true},
		{"http://localhost:5173", true},
		{"http://127.0.0.1:8000", true},
		{"https://katsi-api.onrender.com", false},
		{"https://katsi.onrender.com.evil.example", false},
		{"http://katsi.onrender.com", false}, // solo https
		{"https://evil.example", false},
	}
	for _, c := range cases {
		for _, method := range []string{http.MethodGet, http.MethodOptions} {
			resp := do(method, c.origin)
			got := resp.Header.Get("Access-Control-Allow-Origin")
			if (got == c.origin) != c.ok || (!c.ok && got != "") {
				t.Errorf("%s %s: Allow-Origin %q, allowed=%v", method, c.origin, got, c.ok)
			}
			if resp.Header.Get("Vary") != "Origin" {
				t.Errorf("%s %s: missing Vary: Origin", method, c.origin)
			}
			if method == http.MethodOptions && resp.StatusCode != http.StatusNoContent {
				t.Errorf("preflight %s: status %d", c.origin, resp.StatusCode)
			}
		}
	}
}

func TestParseOrigins(t *testing.T) {
	got := parseOrigins(" https://a.example/ ,, https://b.example ")
	if len(got) != 2 || got[0] != "https://a.example" || got[1] != "https://b.example" {
		t.Errorf("parseOrigins: %q", got)
	}
}

func TestHealth(t *testing.T) {
	srv := newTestServer(t)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/health", nil)
	req.Header.Set("Origin", "https://katsi.onrender.com")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("health: status %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://katsi.onrender.com" {
		t.Errorf("health CORS: %q", got)
	}
}
