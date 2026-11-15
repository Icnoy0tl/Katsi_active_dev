package knn

// Port of tests_pesos.py, adapted to F2′, plus numerical parity with the Python code.

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"testing"
)

// ---------------------------------------------------------------- helpers

// gamma(α, 1) via Marsaglia–Tsang (with the α < 1 trick).
func gammaVar(r *rand.Rand, a float64) float64 {
	if a < 1 {
		return gammaVar(r, a+1) * math.Pow(r.Float64(), 1/a)
	}
	d := a - 1.0/3
	c := 1 / math.Sqrt(9*d)
	for {
		x := r.NormFloat64()
		v := 1 + c*x
		if v <= 0 {
			continue
		}
		v = v * v * v
		u := r.Float64()
		if math.Log(u) < 0.5*x*x+d-d*v+d*math.Log(v) {
			return d * v
		}
	}
}

func dirichlet(r *rand.Rand, k int, a float64) []float64 {
	g := make([]float64, k)
	s := 0.0
	for i := range g {
		g[i] = gammaVar(r, a)
		s += g[i]
	}
	if s == 0 { // a very small α can underflow to all zeros
		g[r.IntN(k)] = 1
		return g
	}
	for i := range g {
		g[i] /= s
	}
	return g
}

// random case, identical in spirit to caso_aleatorio() in tests_pesos.py
func randomCase(r *rand.Rand) (map[string]map[string]float64, map[string]float64, []string) {
	C := 1 + r.IntN(12)
	n := 1 + r.IntN(60)
	cats := make([]string, C)
	for i := range cats {
		cats[i] = fmt.Sprintf("c%d", i)
	}
	mu := map[string]map[string]float64{}
	for j := 0; j < n; j++ {
		row := map[string]float64{}
		switch r.IntN(3) {
		case 0: // pure
			row[cats[r.IntN(C)]] = 1
		case 1: // two categories
			a, b := cats[r.IntN(C)], cats[r.IntN(C)]
			t := r.Float64()
			row[a] += t
			row[b] += 1 - t
		default: // mixture
			p := dirichlet(r, C, []float64{0.2, 1, 5}[r.IntN(3)])
			for i, c := range cats {
				if p[i] > 0 {
					row[c] = p[i]
				}
			}
			s := 0.0
			for _, x := range row {
				s += x
			}
			for c := range row {
				row[c] /= s
			}
		}
		mu[fmt.Sprintf("v%d", j)] = row
	}
	k := 1 + r.IntN(C)
	perm := r.Perm(C)[:k]
	p := dirichlet(r, k, []float64{0.1, 1, 10}[r.IntN(3)])
	profile := map[string]float64{}
	for i, idx := range perm {
		profile[cats[idx]] = p[i]
	}
	if s := sumMap(profile); !(s > 0) {
		profile[cats[perm[0]]] = 1
	}
	return mu, profile, cats
}

func sumMap(m map[string]float64) float64 {
	s := 0.0
	for _, x := range m {
		s += x
	}
	return s
}

func copyMu(mu map[string]map[string]float64) map[string]map[string]float64 {
	out := map[string]map[string]float64{}
	for v, row := range mu {
		out[v] = map[string]float64{}
		for c, x := range row {
			out[v][c] = x
		}
	}
	return out
}

// pieces returns q_jc = μ_jc d̃_c / n_c (the portions from the derivation).
func pieces(rep WeightReport, mu map[string]map[string]float64) map[string]map[string]float64 {
	nc := map[string]float64{}
	for _, row := range mu {
		for c, x := range row {
			nc[c] += x
		}
	}
	q := map[string]map[string]float64{}
	for v, row := range mu {
		q[v] = map[string]float64{}
		for c, x := range row {
			if nc[c] > 0 {
				q[v][c] = x * rep.Profile[c] / nc[c]
			}
		}
	}
	return q
}

func properties(t *testing.T, label string, mu map[string]map[string]float64, profile map[string]float64, cats []string) WeightReport {
	t.Helper()
	rep, err := ComputeWeights(profile, mu, cats)
	if err != nil {
		t.Fatalf("%s: %v", label, err)
	}
	n := float64(len(mu))
	sw, sf := 0.0, 0.0
	for v, x := range rep.Variables {
		// P1 valid weights and factor with mean 1
		if math.IsNaN(x.Weight) || math.IsInf(x.Weight, 0) || x.Weight < 0 {
			t.Fatalf("%s: invalid weight for %s: %v", label, v, x.Weight)
		}
		// P3 affinity in [0, 1]
		if x.Affinity < -1e-12 || x.Affinity > 1+1e-12 {
			t.Fatalf("%s: affinity outside [0,1]", label)
		}
		sw += x.Weight
		sf += x.Factor
	}
	if math.Abs(sw-1) > 1e-12 || math.Abs(sf/n-1) > 1e-12 {
		t.Fatalf("%s: Σw = %v, mean factor = %v", label, sw, sf/n)
	}
	// P6 Hellinger angle in [0, acos(1/√n)]
	if rep.AngleDeg < -1e-9 || rep.AngleDeg > math.Acos(1/math.Sqrt(n))*180/math.Pi+1e-6 {
		t.Fatalf("%s: angle out of range: %v", label, rep.AngleDeg)
	}
	if rep.NoAffinity {
		return rep
	}
	// P-cat (the decision): each category receives exactly its demand.
	q := pieces(rep, mu)
	got := map[string]float64{}
	for _, row := range q {
		for c, x := range row {
			got[c] += x
		}
	}
	for c, dc := range rep.Profile {
		if math.Abs(got[c]-dc) > 1e-12 {
			t.Fatalf("%s: category %s receives %v, demand %v", label, c, got[c], dc)
		}
	}
	// and w_j = Σ_c q_jc
	for v, row := range q {
		if math.Abs(sumMap(row)-rep.Variables[v].Weight) > 1e-12 {
			t.Fatalf("%s: w_%s != Σ_c q", label, v)
		}
	}
	return rep
}

// ---------------------------------------------------------------- fuzz (4000)

func TestFuzzProperties(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 7))
	for i := 0; i < 4000; i++ {
		mu, profile, cats := randomCase(r)
		label := fmt.Sprintf("fuzz#%d", i)
		rep := properties(t, label, mu, profile, cats)

		// P8 invariance to profile scaling
		c := []float64{0.01, 3, 1000}[r.IntN(3)]
		scaled := map[string]float64{}
		for k, x := range profile {
			scaled[k] = c * x
		}
		rep2, _ := ComputeWeights(scaled, mu, cats)
		// P9 invariance to adding an empty category
		rep3, _ := ComputeWeights(profile, mu, append(append([]string{}, cats...), "EMPTY"))
		for v := range mu {
			if math.Abs(rep.Variables[v].Weight-rep2.Variables[v].Weight) > 1e-12 {
				t.Fatalf("%s: not invariant to scaling d", label)
			}
			if math.Abs(rep.Variables[v].Weight-rep3.Variables[v].Weight) > 1e-12 {
				t.Fatalf("%s: changes when adding an empty category", label)
			}
		}
		if rep.NoAffinity {
			continue
		}

		// Optimality (KL derivation): moving mass between two portions of the
		// SAME category keeps the constraints and must worsen the KL.
		q := pieces(rep, mu)
		kl := func(q map[string]map[string]float64) float64 {
			s := 0.0
			for v, row := range q {
				for c, x := range row {
					if x > 0 {
						s += x * math.Log(x/mu[v][c])
					}
				}
			}
			return s
		}
		base := kl(q)
		for c := range rep.Profile {
			var holders []string
			for _, v := range sortedKeys(q) {
				if q[v][c] > 1e-6 {
					holders = append(holders, v)
				}
			}
			if len(holders) < 2 {
				continue
			}
			a, b := holders[0], holders[1]
			eps := 1e-3 * math.Min(q[a][c], q[b][c])
			q[a][c] += eps
			q[b][c] -= eps
			if kl(q) <= base {
				t.Fatalf("%s: the solution does not minimize the KL (category %s)", label, c)
			}
			q[a][c] -= eps
			q[b][c] += eps
			break
		}

		// Replication invariance: duplicating any variable (pure or mixed)
		// keeps the mass of EACH category at its demand (properties checks it
		// on mu2) and does not change the weight of the variables that share no
		// category with the duplicated one.
		v := sortedKeys(mu)[r.IntN(len(mu))]
		mu2 := copyMu(mu)
		mu2[v+"_copy"] = mu[v]
		repD := properties(t, label+" duplicated", mu2, profile, cats)
		for u, row := range mu {
			shares := false
			for c := range row {
				if mu[v][c] > 0 {
					shares = true
				}
			}
			if !shares && math.Abs(rep.Variables[u].Weight-repD.Variables[u].Weight) > 1e-12 {
				t.Fatalf("%s: duplicating %s changed %s, which shares no category", label, v, u)
			}
		}
	}
}

// With balanced categories and pure types, N_ef(F2′) = N* from the README.
func TestBalancedCategoriesReachReadmeNStar(t *testing.T) {
	r := rand.New(rand.NewPCG(11, 11))
	for trial := 0; trial < 500; trial++ {
		C := 1 + r.IntN(8)
		per := 1 + r.IntN(6)
		cats := make([]string, C)
		mu := map[string]map[string]float64{}
		for i := range cats {
			cats[i] = fmt.Sprintf("c%d", i)
			for j := 0; j < per; j++ {
				mu[fmt.Sprintf("v%d_%d", i, j)] = map[string]float64{cats[i]: 1}
			}
		}
		p := dirichlet(r, C, 1)
		profile := map[string]float64{}
		for i, c := range cats {
			profile[c] = p[i] + 1e-3 // > 0 for all
		}
		rep, err := ComputeWeights(profile, mu, cats)
		if err != nil {
			t.Fatal(err)
		}
		if math.Abs(rep.NEf-rep.NStar) > 1e-9*rep.NStar {
			t.Fatalf("N_ef=%v, N*=%v", rep.NEf, rep.NStar)
		}
	}
}

// ---------------------------------------------------------------- degenerate cases

func TestDegenerateCases(t *testing.T) {
	properties(t, "n=1", map[string]map[string]float64{"a": {"X": 1}}, map[string]float64{"X": 1}, []string{"X"})
	properties(t, "C=1", map[string]map[string]float64{"a": {"X": 1}, "b": {"X": 1}}, map[string]float64{"X": 5}, []string{"X"})

	same := map[string]map[string]float64{}
	for i := 0; i < 10; i++ {
		same[fmt.Sprintf("v%d", i)] = map[string]float64{"A": .5, "B": .5}
	}
	rep := properties(t, "equal mu", same, map[string]float64{"A": 1}, []string{"A", "B"})
	for _, x := range rep.Variables {
		if math.Abs(x.Weight-.1) > 1e-12 {
			t.Fatal("equal mu: not uniform")
		}
	}

	// Mission that only requests a category WITHOUT variables → uniform + flag.
	rep, err := ComputeWeights(map[string]float64{"Z": 1},
		map[string]map[string]float64{"a": {"A": 1}, "b": {"A": 1}}, []string{"A", "Z"})
	if err != nil || !rep.NoAffinity || math.Abs(rep.Variables["a"].Weight-.5) > 1e-12 {
		t.Fatalf("no affinity: must give uniform weights with the flag set, %+v %v", rep, err)
	}

	properties(t, "max tie", map[string]map[string]float64{"a": {"A": 1}, "b": {"A": 1}, "c": {"A": 1}, "d": {"B": 1}},
		map[string]float64{"A": .9, "B": .1}, []string{"A", "B"})
	properties(t, "minimum weight", Mu, map[string]float64{"GEO": 1, "MEC": 1e-300}, Categories)
	properties(t, "uniform profile", Mu, map[string]float64{"GEO": 1, "MEC": 1, "VOL": 1, "TER": 1, "ENE": 1, "ATM": 1, "NAV": 1}, Categories)
	for _, c := range Categories {
		properties(t, "one-hot "+c, Mu, map[string]float64{c: 1}, Categories)
	}
	for _, k := range MissionNames() {
		properties(t, "mission "+k, Mu, Missions[k], Categories)
	}
}

func TestInvalidInputs(t *testing.T) {
	nan, inf := math.NaN(), math.Inf(1)
	cases := []struct {
		name    string
		profile map[string]float64
		mu      map[string]map[string]float64
	}{
		{"misspelled key", map[string]float64{"GEOO": 1}, Mu},
		{"negative", map[string]float64{"GEO": -1, "MEC": 2}, Mu},
		{"NaN", map[string]float64{"GEO": nan}, Mu},
		{"inf", map[string]float64{"GEO": inf}, Mu},
		{"zero sum", map[string]float64{"GEO": 0}, Mu},
		{"empty profile", map[string]float64{}, Mu},
		{"mu row does not sum to 1", map[string]float64{"GEO": 1}, map[string]map[string]float64{"a": {"GEO": .5}}},
		{"mu without variables", map[string]float64{"GEO": 1}, map[string]map[string]float64{}},
		{"mu with unknown category", map[string]float64{"GEO": 1}, map[string]map[string]float64{"a": {"QQ": 1}}},
	}
	for _, c := range cases {
		if _, err := ComputeWeights(c.profile, c.mu, Categories); err == nil {
			t.Errorf("%s: should have failed", c.name)
		}
	}
}

// ---------------------------------------------------------------- real model

// The KNN vector (26 dimensions) and Mu (25 variables) describe the same thing.
func TestFeatureMappingCoversMu(t *testing.T) {
	if err := Default.validateFeatureMapping(); err != nil {
		t.Fatal(err)
	}
	if len(Mu) != 25 || len(features) != 26 {
		t.Fatalf("expected 25 variables / 26 dimensions, got %d / %d", len(Mu), len(features))
	}
	for _, f := range MissionNames() {
		w, err := WeightsFor(f, FeatureNames())
		if err != nil {
			t.Fatal(err)
		}
		s := 0.0
		for _, x := range w {
			s += x
		}
		if math.Abs(s-1) > 1e-12 {
			t.Errorf("%s: Σw over dimensions = %v", f, s)
		}
	}
}

// Parity with pesos_mision.py: the F1 affinity and N* must match what the
// Python code computes, and F2′ must match its formula evaluated in Python. If
// someone changes Mu or Missions on one side and not the other, this test fails.
func TestParityWithPython(t *testing.T) {
	raw, err := os.ReadFile("testdata/golden_python.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden map[string]struct {
		NStar         float64            `json:"nStar"`
		Affinity      map[string]float64 `json:"affinity"`
		WeightF2Prime map[string]float64 `json:"weightF2prime"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden) != len(Missions) {
		t.Fatalf("Python has %d missions and Go has %d", len(golden), len(Missions))
	}
	for m, g := range golden {
		rep, ok := missionReports[m]
		if !ok {
			t.Fatalf("mission %s does not exist in Go", m)
		}
		if math.Abs(rep.NStar-g.NStar) > 1e-9 {
			t.Errorf("%s: N* Go=%v Python=%v", m, rep.NStar, g.NStar)
		}
		for v, a := range g.Affinity {
			if math.Abs(rep.Variables[v].Affinity-a) > 1e-12 {
				t.Errorf("%s/%s: affinity Go=%v Python=%v", m, v, rep.Variables[v].Affinity, a)
			}
			if math.Abs(rep.Variables[v].Weight-g.WeightF2Prime[v]) > 1e-12 {
				t.Errorf("%s/%s: weight Go=%v Python=%v", m, v, rep.Variables[v].Weight, g.WeightF2Prime[v])
			}
		}
	}
}

// (Δmin² + Δmax²)/2 = Δcenter² + Δhalfwidth²: justifies Share = 0.5 for depth_to_bedrock.
func TestIntervalSplitIdentity(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 3))
	for i := 0; i < 1000; i++ {
		a1, a2, b1, b2 := r.Float64(), r.Float64(), r.Float64(), r.Float64()
		lhs := ((a1-b1)*(a1-b1) + (a2-b2)*(a2-b2)) / 2
		dm := (a1+a2)/2 - (b1+b2)/2
		dh := (a2-a1)/2 - (b2-b1)/2
		if math.Abs(lhs-(dm*dm+dh*dh)) > 1e-12 {
			t.Fatal("interval identity fails")
		}
	}
}

func TestPrintMissionWeights(t *testing.T) {
	for _, rep := range MissionReports() {
		t.Logf("%-9s N_ef=%.2f  N*=%.2f  angle=%.1f°", rep.Mission, rep.NEf, rep.NStar, rep.AngleDeg)
	}
}
