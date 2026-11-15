package knn

import (
	"errors"
	"math"
	"sort"
)


type Vector []float64

type Candidate struct {
	ID     string
	Name   string
	Vector Vector
}

type Match struct {
	RegionID   string  `json:"regionId"`
	Name       string  `json:"name"`
	Distance   float64 `json:"distance"`
	Similarity float64 `json:"similarity"`
	Coverage   float64 `json:"coverage"` // fracción del peso total con datos en ambas regiones
}


const MinCoverage = 0.5
// WeightedDistance: weighted Euclidean distance with missing data.
//
// Let O be the set of dimensions observed in both regions, W = Σ_i w_i, and
// W_O = Σ_{i∈O} w_i. Then:
//
//  d = sqrt( W · Σ_{i∈O} w_i (a_i − b_i)² / W_O )      coverage = W_O / W
//
// Missing dimensions are omitted and the weight is renormalized over the
// present ones; this is the same treatment as Gower's distance (1971).
// Properties (tests in knn_test.go):
//   - Without missing values, it is exactly sqrt(Σ w_i Δ_i²).
//   - It is a metric if w_i > 0; with any w_i = 0 (a variable that the mission does
//     not request) it is a pseudometric. With missing values, the triangle inequality may
//     fail; which is why coverage is reported.
//   - Scale invariance: w → c·w ⇒ d → √c·d; order and similarity do not change.
//   - After min-max, |Δ_i| ≤ 1 ⇒ d ≤ sqrt(W) = d_max ⇒ sim = 1 − d/d_max ∈ [0, 1].
//   - Without any common dimension (W_O = 0): d = d_max, sim = 0, coverage = 0.
func WeightedDistance(a, b, w Vector) (dist, coverage float64, err error) {
	if len(a) != len(b) || len(a) != len(w) {
		return 0, 0, errors.New("Vectors with different len")
	}
	total, obs, sum := 0.0, 0.0, 0.0
	for i := range a {
		if w[i] < 0 || math.IsNaN(w[i]) {
			return 0, 0, errors.New("negative weights o NaN")
		}
		total += w[i]
		if math.IsNaN(a[i]) || math.IsNaN(b[i]) {
			continue
		}
		d := a[i] - b[i]
		obs += w[i]
		sum += w[i] * d * d
	}
	if !(total > 0) {
		return 0, 0, errors.New("Sum must be > 0")
	}
	if obs == 0 {
		return math.Sqrt(total), 0, nil
	}
	return math.Sqrt(total * sum / obs), obs / total, nil
}


func FindMostSimilar(target Candidate, pool []Candidate, w Vector, k int) ([]Match, error) {
	if k <= 0 {
		return nil, errors.New("k must be > 0")
	}
	total := 0.0
	for _, wi := range w {
		total += wi
	}
	maxDist := math.Sqrt(total)

	matches := make([]Match, 0, len(pool))
	for _, c := range pool {
		d, cov, err := WeightedDistance(target.Vector, c.Vector, w)
		if err != nil {
			return nil, err
		}
		sim := 0.0
		if maxDist > 0 {
			sim = 1 - d/maxDist
		}
		matches = append(matches, Match{RegionID: c.ID, Name: c.Name, Distance: d, Similarity: sim, Coverage: cov})
	}

	sort.SliceStable(matches, func(i, j int) bool {
		oi, oj := matches[i].Coverage >= MinCoverage, matches[j].Coverage >= MinCoverage
		if oi != oj {
			return oi
		}
		if matches[i].Distance != matches[j].Distance {
			return matches[i].Distance < matches[j].Distance
		}
		return matches[i].Coverage > matches[j].Coverage
	})

	if len(matches) > k {
		matches = matches[:k]
	}
	return matches, nil
}
