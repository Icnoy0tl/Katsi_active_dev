package knn

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"spaceapps/jsonParser"
)

// The breakdown tests only need a target and a catalog with real data; they use
// testdata/moon.json for both (one site as the target and the rest as the
// catalog). The breakdown does not depend on which planet each side is.
func loadBreakdownData(t *testing.T) (jsonParser.Region, []jsonParser.Region) {
	t.Helper()
	raw, err := os.ReadFile("testdata/moon.json")
	if err != nil {
		t.Fatal(err)
	}
	var info jsonParser.PlanetInformation
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatal(err)
	}
	return info.Regions[1], append(append([]jsonParser.Region{}, info.Regions[:1]...), info.Regions[2:]...)
}

func byID(rs []jsonParser.Region) map[string]jsonParser.Region {
	m := map[string]jsonParser.Region{}
	for _, r := range rs {
		m[r.RegionId] = r
	}
	return m
}

// The index rebuilt from the breakdown is EXACTLY the KNN Similarity, and the
// coverage matches, for every filter and every candidate.
func TestBreakdownReconstructsKNNIndex(t *testing.T) {
	sel, earth := loadBreakdownData(t)
	target, pool, stats, err := PrepareWithStats(sel, earth)
	if err != nil {
		t.Fatal(err)
	}
	regions := byID(earth)
	poolByID := map[string]Candidate{}
	for _, c := range pool {
		poolByID[c.ID] = c
	}
	for f, w := range allWeights(t) {
		ms, err := FindMostSimilar(target, pool, w, len(pool))
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range ms {
			fs, err := CompareFeatures(sel, regions[m.RegionID], target, poolByID[m.RegionID], stats, w)
			if err != nil {
				t.Fatal(err)
			}
			if len(fs) != len(features) {
				t.Fatalf("expected %d dimensions, got %d", len(features), len(fs))
			}
			wTot, wObs, q, shares := 0.0, 0.0, 0.0, 0.0
			for _, x := range fs {
				wTot += x.Weight
				if !x.Observed {
					continue
				}
				wObs += x.Weight
				d := 1 - *x.Compatibility
				q += x.Weight * d * d
				shares += *x.LossShare
			}
			if math.Abs(wTot-1) > tol {
				t.Fatalf("%q/%s: Σ weights = %v", f, m.RegionID, wTot)
			}
			if wObs > 0 {
				if sim := 1 - math.Sqrt(q/wObs); math.Abs(sim-m.Similarity) > 1e-9 {
					t.Errorf("%q/%s: rebuilt index %v ≠ similarity %v", f, m.RegionID, sim, m.Similarity)
				}
			}
			if math.Abs(wObs-m.Coverage) > 1e-9 {
				t.Errorf("%q/%s: coverage %v ≠ %v", f, m.RegionID, wObs, m.Coverage)
			}
			if q > 0 && math.Abs(shares-1) > 1e-9 {
				t.Errorf("%q/%s: Σ lossShare = %v, expected 1", f, m.RegionID, shares)
			}
		}
	}
}

// Same region, same candidate, different filter: the compatibility of each
// dimension is the same (it comes from the data) but the weight, the attributed
// loss and the overall index change.
func TestBreakdownChangesWithFilter(t *testing.T) {
	sel, earth := loadBreakdownData(t)
	target, pool, stats, err := PrepareWithStats(sel, earth)
	if err != nil {
		t.Fatal(err)
	}
	cand := pool[0]
	reg := byID(earth)[cand.ID]
	ws := allWeights(t)
	rover, err := CompareFeatures(sel, reg, target, cand, stats, ws["mobility"])
	if err != nil {
		t.Fatal(err)
	}
	edl, err := CompareFeatures(sel, reg, target, cand, stats, ws["perception"])
	if err != nil {
		t.Fatal(err)
	}
	wDiff, lDiff := false, false
	for i := range rover {
		if rover[i].Observed != edl[i].Observed {
			t.Fatal("observability must not depend on the filter")
		}
		if rover[i].Observed && math.Abs(*rover[i].Compatibility-*edl[i].Compatibility) > tol {
			t.Errorf("%s: per-dimension compatibility must not depend on the filter", rover[i].Name)
		}
		if math.Abs(rover[i].Weight-edl[i].Weight) > 1e-6 {
			wDiff = true
		}
		if rover[i].Observed && math.Abs(*rover[i].LossShare-*edl[i].LossShare) > 1e-6 {
			lDiff = true
		}
	}
	if !wDiff || !lDiff {
		t.Errorf("mobility and perception must give different weights (%v) and loss shares (%v)", wDiff, lDiff)
	}
	mr, _ := FindMostSimilar(target, []Candidate{cand}, ws["mobility"], 1)
	me, _ := FindMostSimilar(target, []Candidate{cand}, ws["perception"], 1)
	if math.Abs(mr[0].Similarity-me[0].Similarity) < 1e-9 {
		t.Error("the overall index of this pair should differ between mobility and perception")
	}
}

// Missing data: observed=false, null values, no NaN in the JSON.
func TestBreakdownMissingIsNullInJSON(t *testing.T) {
	sel, earth := loadBreakdownData(t)
	// Make ground_ice_index missing on both sides so the test does not depend
	// on what testdata/moon.json happens to contain.
	sel.AuditVariables.GroundIceIndex = nil
	for i := range earth {
		earth[i].AuditVariables.GroundIceIndex = nil
	}
	target, pool, stats, err := PrepareWithStats(sel, earth)
	if err != nil {
		t.Fatal(err)
	}
	w, _ := WeightsFor("mobility", FeatureNames())
	fs, err := CompareFeatures(sel, byID(earth)[pool[0].ID], target, pool[0], stats, w)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(fs) // would fail if any value were NaN/Inf
	if err != nil {
		t.Fatalf("not serializable: %v", err)
	}
	var back []map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	core, audit := 0, 0
	for _, x := range fs {
		switch x.Group {
		case "core":
			core++
		case "audit":
			audit++
		}
		if x.Name == "ground_ice_index" {
			if x.Observed || x.Compatibility != nil || x.LossShare != nil || x.TargetValue != nil || x.EarthValue != nil {
				t.Errorf("null ground_ice_index must be reported as not observed: %+v", x)
			}
		}
	}
	if core != 10 || audit != 16 {
		t.Errorf("expected 10 core + 16 audit, got %d + %d", core, audit)
	}
}

// A target outside the terrestrial range is flagged and keeps its raw value.
func TestBreakdownFlagsClamped(t *testing.T) {
	sel, earth := loadBreakdownData(t)
	far := sel
	ins := 5 * *sel.CoreVariables.Insolation
	far.CoreVariables.Insolation = &ins
	target, pool, stats, _ := PrepareWithStats(far, earth)
	w, _ := WeightsFor("", FeatureNames())
	fs, err := CompareFeatures(far, byID(earth)[pool[0].ID], target, pool[0], stats, w)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range fs {
		if x.Name != "insolation" {
			continue
		}
		if !x.TargetClamped || *x.TargetValue != ins || *x.TargetNorm != 1 {
			t.Errorf("insolation out of range: %+v", x)
		}
	}
}

func TestBreakdownRejectsBadInput(t *testing.T) {
	sel, earth := loadBreakdownData(t)
	target, pool, stats, _ := PrepareWithStats(sel, earth)
	reg := byID(earth)[pool[0].ID]
	if _, err := CompareFeatures(sel, reg, target, pool[0], stats, Vector{1}); err == nil {
		t.Error("weights of the wrong length must be an error")
	}
	if _, err := CompareFeatures(sel, reg, target, pool[0], stats, make(Vector, len(features))); err == nil {
		t.Error("weights summing to 0 must be an error")
	}
}
