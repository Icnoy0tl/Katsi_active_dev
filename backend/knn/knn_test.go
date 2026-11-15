package knn

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand/v2"
	"os"
	"testing"

	"spaceapps/jsonParser"
)

const tol = 1e-9

func randVec(r *rand.Rand, n int, missing float64) Vector {
	v := make(Vector, n)
	for i := range v {
		if r.Float64() < missing {
			v[i] = math.NaN()
		} else {
			v[i] = r.Float64()
		}
	}
	return v
}

func allWeights(t *testing.T) map[string]Vector {
	t.Helper()
	out := map[string]Vector{}
	for _, f := range append([]string{""}, MissionNames()...) {
		w, err := WeightsFor(f, FeatureNames())
		if err != nil {
			t.Fatal(err)
		}
		out[f] = w
	}
	return out
}

func TestWeightsForErrors(t *testing.T) {
	if _, err := WeightsFor("nope", FeatureNames()); !errors.Is(err, ErrUnknownFilter) {
		t.Errorf("unknown filter: %v", err)
	}
	if _, err := WeightsFor("rover", append(FeatureNames(), "new_variable")); err == nil {
		t.Error("a dimension without a model must be an error, not a silent weight of 0")
	}
}

// No missing values: a metric (empty filter, every w > 0) or a pseudometric
// (missions with w = 0 on variables they do not request). Both satisfy the
// triangle inequality.
func TestDistanceAxiomsCompleteData(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	n := len(features)
	for f, w := range allWeights(t) {
		for trial := 0; trial < 2000; trial++ {
			a, b, c := randVec(r, n, 0), randVec(r, n, 0), randVec(r, n, 0)
			dab, cov, _ := WeightedDistance(a, b, w)
			dba, _, _ := WeightedDistance(b, a, w)
			dac, _, _ := WeightedDistance(a, c, w)
			dbc, _, _ := WeightedDistance(b, c, w)
			daa, _, _ := WeightedDistance(a, a, w)
			if dab < 0 || daa != 0 || math.Abs(dab-dba) > tol || dac > dab+dbc+tol || cov != 1 {
				t.Fatalf("filter %q violates the axioms", f)
			}
			// Without missing values it matches the classic formula sqrt(Σ wΔ²).
			s := 0.0
			for i := range a {
				s += w[i] * (a[i] - b[i]) * (a[i] - b[i])
			}
			if math.Abs(dab-math.Sqrt(s)) > tol {
				t.Fatalf("filter %q: does not reduce to the weighted Euclidean distance", f)
			}
		}
	}
	// Empty filter: every weight > 0 → strict metric.
	for _, x := range allWeights(t)[""] {
		if !(x > 0) {
			t.Fatal("without a filter every weight must be > 0")
		}
	}
}

func TestScaleInvarianceWithMissing(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 4))
	n := len(features)
	pool := make([]Candidate, 60)
	for i := range pool {
		pool[i] = Candidate{ID: string(rune('A'+i%26)) + string(rune('a'+i/26)), Vector: randVec(r, n, 0.2)}
	}
	target := Candidate{Vector: randVec(r, n, 0.2)}
	for f, w := range allWeights(t) {
		scaled := make(Vector, n)
		for i := range w {
			scaled[i] = 37.5 * w[i]
		}
		m1, _ := FindMostSimilar(target, pool, w, 10)
		m2, _ := FindMostSimilar(target, pool, scaled, 10)
		for i := range m1 {
			if m1[i].RegionID != m2[i].RegionID || math.Abs(m1[i].Similarity-m2[i].Similarity) > tol ||
				math.Abs(m1[i].Coverage-m2[i].Coverage) > tol {
				t.Fatalf("filter %q: scaling the weights changed the result at position %d", f, i)
			}
		}
	}
}

func TestBoundsWithMissing(t *testing.T) {
	r := rand.New(rand.NewPCG(5, 6))
	n := len(features)
	pool := make([]Candidate, 300)
	for i := range pool {
		pool[i] = Candidate{ID: "x", Vector: randVec(r, n, r.Float64())}
	}
	corner, opposite, empty := make(Vector, n), make(Vector, n), make(Vector, n)
	for i := range opposite {
		opposite[i], empty[i] = 1, math.NaN()
	}
	pool = append(pool, Candidate{ID: "opposite", Vector: opposite}, Candidate{ID: "empty", Vector: empty})
	for f, w := range allWeights(t) {
		ms, _ := FindMostSimilar(Candidate{Vector: corner}, pool, w, len(pool))
		for _, m := range ms {
			if m.Similarity < -tol || m.Similarity > 1+tol || m.Distance > 1+tol || m.Coverage < 0 || m.Coverage > 1+tol {
				t.Fatalf("filter %q: sim=%v d=%v cov=%v out of range", f, m.Similarity, m.Distance, m.Coverage)
			}
		}
		for _, m := range ms {
			if m.RegionID == "opposite" && math.Abs(m.Similarity) > tol {
				t.Errorf("filter %q: the opposite corner must have sim = 0", f)
			}
			if m.RegionID == "empty" && (m.Coverage != 0 || m.Similarity != 0) {
				t.Errorf("filter %q: no shared data must give coverage 0 and sim 0", f)
			}
		}
		if ms[len(ms)-1].Coverage >= MinCoverage {
			continue
		}
		// No candidate with coverage < MinCoverage is ranked before one that meets it.
		seenLow := false
		for _, m := range ms {
			if m.Coverage < MinCoverage {
				seenLow = true
			} else if seenLow {
				t.Fatalf("filter %q: low coverage ranked before a sufficient one", f)
			}
		}
	}
}

// ---------------------------------------------------------------- real data

func loadMars(t *testing.T) []jsonParser.Region {
	t.Helper()
	raw, err := os.ReadFile("testdata/mars.json")
	if err != nil {
		t.Fatal(err)
	}
	var data jsonParser.PlanetInformation
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	return data.Regions
}

// null in the JSON → missing value (NaN), NOT 0.
func TestNullIsMissingNotZero(t *testing.T) {
	mars := loadMars(t)
	idx := map[string]int{}
	for i, n := range FeatureNames() {
		idx[n] = i
	}
	for _, r := range mars {
		v, err := ToVector(r)
		if err != nil {
			t.Fatal(err)
		}
		if len(v) != 26 {
			t.Fatalf("vector with %d dimensions, expected 26", len(v))
		}
		if !math.IsNaN(v[idx["salinity_wt_pct"]]) {
			t.Errorf("%s: null salinity should be missing", r.RegionId)
		}
		if v[idx["vegetation_ndvi"]] != 0 {
			t.Errorf("%s: ndvi 0.0 is a real value, not missing", r.RegionId)
		}
	}
	arcadia, _ := ToVector(mars[2])
	if !math.IsNaN(arcadia[idx["depth_to_bedrock_min_m"]]) || !math.IsNaN(arcadia[idx["depth_to_bedrock_max_m"]]) {
		t.Error("Arcadia: null depth_to_bedrock should be missing")
	}
}

func TestPrepareNormalizesWithMissing(t *testing.T) {
	mars := loadMars(t)
	target, pool, err := Prepare(mars[0], mars[1:])
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range append(pool, target) {
		for i, x := range c.Vector {
			if !math.IsNaN(x) && (x < 0 || x > 1) {
				t.Fatalf("%s[%s] = %v outside [0,1]", c.ID, features[i].Name, x)
			}
		}
	}
	w, _ := WeightsFor("rover", FeatureNames())
	ms, err := FindMostSimilar(target, pool, w, 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range ms {
		if !(m.Coverage > 0 && m.Coverage < 1) {
			t.Errorf("%s: with salinity missing the coverage must be in (0,1), got %v", m.RegionID, m.Coverage)
		}
	}
}

// ---------------------------------------------------------------- robustness

func TestRobustness(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 8))
	n := len(features)
	pool := make([]Candidate, 30)
	for i := range pool {
		pool[i] = Candidate{ID: string(rune('a' + i)), Vector: randVec(r, n, 0.1)}
	}
	tgt := Candidate{Vector: randVec(r, n, 0.1)}
	for _, f := range append([]string{""}, MissionNames()...) {
		rob, err := AnalyzeRobustness(tgt, pool, f, 3, 0, 50, 42)
		if err != nil {
			t.Fatal(err)
		}
		if rob.Top1Stability != 1 || math.Abs(rob.MeanTopKJaccard-1) > tol {
			t.Errorf("%q: with ε=0 everything must be stable: %+v", f, rob)
		}
		a, _ := AnalyzeRobustness(tgt, pool, f, 3, 0.2, 100, 42)
		b, _ := AnalyzeRobustness(tgt, pool, f, 3, 0.2, 100, 42)
		if a.Top1Stability != b.Top1Stability || a.MeanTopKJaccard != b.MeanTopKJaccard {
			t.Errorf("%q: not deterministic with a fixed seed", f)
		}
	}
}
