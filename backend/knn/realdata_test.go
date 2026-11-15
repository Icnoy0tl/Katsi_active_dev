package knn

// Tests using real data (testdata/earth|mars|moon.json).
//
// TestRealDataSnapshot saves the top-3 of the 6 test regions × 5 filters in
// testdata/snapshot_real.json. If a change in the data, Mu, profiles or code
// changes a result, the test fails and shows what is different. If the change
// is intentional, regenerate the snapshot with:
//
//	go test ./knn -run RealDataSnapshot -update

import (
	"encoding/json"
	"flag"
	"math"
	"os"
	"sort"
	"testing"

	"spaceapps/jsonParser"
)

var update = flag.Bool("update", false, "regenerate testdata/snapshot_real.json")

type realCase struct {
	planet string
	region jsonParser.Region
}

func loadReal(t *testing.T) ([]realCase, []jsonParser.Region) {
	t.Helper()
	p, err := jsonParser.New("testdata")
	if err != nil {
		t.Fatal(err)
	}
	earth, err := p.GetEarthRegions()
	if err != nil {
		t.Fatal(err)
	}
	var cases []realCase
	for _, planet := range []string{"mars", "moon"} {
		raw, err := os.ReadFile("testdata/" + planet + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var info jsonParser.PlanetInformation
		if err := json.Unmarshal(raw, &info); err != nil {
			t.Fatal(err)
		}
		for _, r := range info.Regions {
			// Follows the same process as the API
			got, err := p.GetRegion(planet, r.RegionId)
			if err != nil {
				t.Fatalf("%s/%s: %v", planet, r.RegionId, err)
			}
			cases = append(cases, realCase{planet, got.Regions[0]})
		}
	}
	return cases, earth
}

func TestRealDataSnapshot(t *testing.T) {
	cases, earth := loadReal(t)
	filters := append([]string{""}, MissionNames()...)
	snap := map[string][]string{}
	for _, c := range cases {
		target, pool, err := Prepare(c.region, earth)
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range filters {
			w, _ := WeightsFor(f, FeatureNames())
			ms, err := FindMostSimilar(target, pool, w, 3)
			if err != nil {
				t.Fatal(err)
			}
			key := c.region.RegionId + "/" + f
			if f == "" {
				key += "(uniform)"
			}
			for _, m := range ms {
				if m.Similarity < 0 || m.Similarity > 1 || m.Coverage <= 0 || m.Coverage > 1 {
					t.Errorf("%s: %s sim=%v cov=%v out of range", key, m.RegionID, m.Similarity, m.Coverage)
				}
				snap[key] = append(snap[key], m.RegionID)
			}
		}
	}

	const path = "testdata/snapshot_real.json"
	if *update {
		raw, _ := json.MarshalIndent(snap, "", " ")
		if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("Snapshot regenerated: %d combinations", len(snap))
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no snapshot on disk; generate one with -update: %v", err) // a snapshot must always exist
	}
	var want map[string][]string
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	keys := sortedKeys(want)
	if len(keys) != len(snap) {
		t.Errorf("snapshot has %d combinations, now there are %d", len(keys), len(snap))
	}
	for _, k := range keys {
		g, w := snap[k], want[k]
		if len(g) != len(w) {
			t.Errorf("%s: before %v, now %v", k, w, g)
			continue
		}
		for i := range g {
			if g[i] != w[i] {
				t.Errorf("%s: before %v, now %v", k, w, g)
				break
			}
		}
	}
}

func TestRealDataExtrapolation(t *testing.T) {
	cases, earth := loadReal(t)
	for _, c := range cases {
		for _, f := range MissionNames() {
			w, _ := WeightsFor(f, FeatureNames())
			ex, err := CheckExtrapolation(c.region, earth, w)
			if err != nil {
				t.Fatal(err)
			}
			if ex.Weight < 0 || ex.Weight > 1+tol {
				t.Fatalf("%s/%s: extrapolated weight %v outside [0,1]", c.region.RegionId, f, ex.Weight)
			}
			names := []string{}
			for _, v := range ex.Variables {
				names = append(names, v.Name)
			}
			sort.Strings(names)
			t.Logf("%-8s %-9s %3.0f%% without analog: %v", c.region.RegionId, f, 100*ex.Weight, names)
			switch {
			case c.region.RegionId == "MARS-001" && f == "mobility" && ex.Weight > 0.05:
				t.Errorf("Jezero/mobility: expected almost no weight out of range, got %.0f%%", 100*ex.Weight)
			case c.planet == "moon" && f == "environmental_survival" && ex.Weight < 0.45:
				t.Errorf("%s/%s: expected > 45%% out of range, got %.0f%%", c.region.RegionId, f, 100*ex.Weight)
			}
		}
	}
}

func TestCheckExtrapolationSynthetic(t *testing.T) {
	f := func(x float64) *float64 { return &x }
	mk := func(slope, press float64) jsonParser.Region {
		return jsonParser.Region{CoreVariables: jsonParser.CoreVariables{Slope: f(slope)},
			AuditVariables: jsonParser.AuditVariables{SurfacePressureKpa: f(press)}}
	}
	earth := []jsonParser.Region{mk(0, 70), mk(10, 100)}
	w, _ := WeightsFor("", FeatureNames())
	// slope 10.5 is within tolerance (10 % of 10 = 1); pressure 0.6 is not
	ex, err := CheckExtrapolation(mk(10.5, 0.6), earth, w)
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.Variables) != 1 || ex.Variables[0].Name != "surface_pressure_kpa" || math.Abs(ex.Weight-1.0/25) > tol {
		t.Fatalf("expected surface_pressure_kpa with weight 1/25, got %+v", ex)
	}
}

// Projection to the terrestrial range: moving the target even further away in a variable
// that is already outside Earth's range should not change either the order or the
// similarity (no analog can reproduce that difference).
func TestGapInvarianceOutOfRange(t *testing.T) {
	cases, earth := loadReal(t)
	var tranq jsonParser.Region
	for _, c := range cases {
		if c.region.RegionId == "MOON-002" {
			tranq = c.region
		}
	}
	run := func(r jsonParser.Region, f string) []Match {
		target, pool, err := Prepare(r, earth)
		if err != nil {
			t.Fatal(err)
		}
		w, _ := WeightsFor(f, FeatureNames())
		ms, _ := FindMostSimilar(target, pool, w, len(pool))
		return ms
	}
	far := tranq
	core := far.CoreVariables
	ins := 5 * *tranq.CoreVariables.Insolation // 425 → 2125 (Earth max. 270)
	core.Insolation = &ins
	far.CoreVariables = core
	for _, f := range append([]string{""}, MissionNames()...) {
		a, b := run(tranq, f), run(far, f)
		for i := range a {
			if a[i].RegionID != b[i].RegionID || math.Abs(a[i].Similarity-b[i].Similarity) > tol {
				t.Fatalf("%q: pushing insolation further out of range changed the result", f)
			}
		}
	}
	w, _ := WeightsFor("environmental_survival", FeatureNames())
	ex, _ := CheckExtrapolation(far, earth, w)
	if !ex.Dominant {
		t.Error("Mare Tranquillitatis/environmental_survival must flag dominant extrapolation")
	}
}
