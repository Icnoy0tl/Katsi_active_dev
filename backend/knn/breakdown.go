package knn

// Compatibility breakdown by feature.
//
// The overall index that ranks KNN is sim = 1 − d/d_max. With W_O being the weight of
// the dimensions observed in both regions and Δ_i the normalized difference:
//
//  d/d_max = sqrt( Σ_{i∈O} w_i Δ_i² / W_O )          sim = 1 − d/d_max
//
// This file DOES NOT recalculate anything with another formula: it starts from the same normalized vectors
// (target already projected to the terrestrial range) and the same weights
// that FindMostSimilar used, and distributes that same quantity among the dimensions.
//
// For each dimension i:
//
//  Compatibility = 1 − |Δ_i|             how similar the values are (0–1).
//                                        DOES NOT depend on the filter: Δ_i comes solely from the data.
//  Weight        = w_i / Σw              how much that dimension weighs in the filter.
//  LossShare     = w_i Δ_i² / Σ_O w Δ²   what fraction of the loss (1 − sim)
//                                        is due to this dimension; Σ = 1.
//
// Weight and LossShare do change with the filter: they explain why the
// same region yields a different overall index under another mission.

import (
	"errors"
	"fmt"
	"math"

	"spaceapps/jsonParser"
)

// FeatureCompat describes a dimension (JSON variable) in the comparison
// between the target (Moon/Mars) and a terrestrial candidate. Missing values
// come out as null in JSON (never NaN, which would break encoding/json).
type FeatureCompat struct {
	Name  string `json:"name"`
	Group string `json:"group"`

	TargetValue *float64 `json:"targetValue"`
	EarthValue  *float64 `json:"earthValue"`
	TargetNorm  *float64 `json:"targetNorm"`
	EarthNorm   *float64 `json:"earthNorm"`

	TargetClamped bool `json:"targetClamped"`

	Observed bool `json:"observed"`

	Compatibility *float64 `json:"compatibility"`
	Weight        float64  `json:"weight"`
	LossShare     *float64 `json:"lossShare"`
}

func finitePtr(x float64) *float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return nil
	}
	return &x
}

// CompareFeatures breaks down the target-candidate comparison by dimension.
// target and cand are the normalized Candidates returned by Prepare (the same
// pair that FindMostSimilar received); stats, those from PrepareWithStats; w, the
// weights of the filter. It returns one entry per dimension, in the order of FeatureNames().

func CompareFeatures(targetRegion, candRegion jsonParser.Region, target, cand Candidate, stats Stats, w Vector) ([]FeatureCompat, error) {
	return Default.CompareFeatures(targetRegion, candRegion, target, cand, stats, w)
}

func (m *Model) CompareFeatures(targetRegion, candRegion jsonParser.Region, target, cand Candidate, stats Stats, w Vector) ([]FeatureCompat, error) {
	n := len(m.features)
	if len(target.Vector) != n || len(cand.Vector) != n || len(w) != n || len(stats.Min) != n || len(stats.Max) != n {
		return nil, errors.New("Vectors, weights or statistics of different length to the number of dimenstions")
	}
	tRaw, err := m.ToVector(targetRegion)
	if err != nil {
		return nil, fmt.Errorf("region %s: %w", targetRegion.RegionId, err)
	}
	cRaw, err := m.ToVector(candRegion)
	if err != nil {
		return nil, fmt.Errorf("region %s: %w", candRegion.RegionId, err)
	}

	total := 0.0
	for _, wi := range w {
		if wi < 0 || math.IsNaN(wi) {
			return nil, errors.New("Negative weights NaN")
		}
		total += wi
	}
	if !(total > 0) {
		return nil, errors.New("Sum weights must be > 0")
	}

	q := make([]float64, n)
	observed := make([]bool, n)
	sumQ := 0.0
	for i := 0; i < n; i++ {
		a, b := target.Vector[i], cand.Vector[i]
		if math.IsNaN(a) || math.IsNaN(b) {
			continue
		}
		observed[i] = true
		d := a - b
		q[i] = w[i] * d * d
		sumQ += q[i]
	}

	out := make([]FeatureCompat, n)
	for i, f := range m.features {
		fc := FeatureCompat{
			Name:        f.Name,
			Group:       f.Group,
			TargetValue: finitePtr(tRaw[i]),
			EarthValue:  finitePtr(cRaw[i]),
			TargetNorm:  finitePtr(target.Vector[i]),
			EarthNorm:   finitePtr(cand.Vector[i]),
			Observed:    observed[i],
			Weight:      w[i] / total,
		}
		lo, hi := stats.Min[i], stats.Max[i]
		if x := tRaw[i]; !math.IsNaN(x) && !math.IsInf(lo, 0) && !math.IsInf(hi, 0) {
			fc.TargetClamped = x < lo || x > hi
		}
		if observed[i] {
			delta := math.Abs(target.Vector[i] - cand.Vector[i])
			c := math.Min(1, math.Max(0, 1-delta))
			fc.Compatibility = &c
			share := 0.0
			if sumQ > 0 {
				share = q[i] / sumQ
			}
			fc.LossShare = &share
		}
		out[i] = fc
	}
	return out, nil
}
