package knn

// Sensitivity analysis
//
// The model's subjective assumptions are the demand profiles d of each
// mission ("the rover requests 35% of MEC"). The honest question is whether
// the result would change with a slightly different profile. To answer this:
//
//  d'_c = d_c · (1 + ε·u_c),  u_c ~ U(−1, 1)
//
// The weights are recalculated using F2′ and the KNN is repeated. Without a
// filter, the uniform weights are perturbed directly. If the top-k barely
// changes, the recommendation does not depend on the fine details of the profile.

import (
	"errors"
	"math/rand/v2"
)

type Robustness struct {
	Perturbs        string             `json:"perturbs"`
	Epsilon         float64            `json:"epsilon"`
	Trials          int                `json:"trials"`
	Top1Stability   float64            `json:"top1Stability"`
	MeanTopKJaccard float64            `json:"meanTopKJaccard"`
	InclusionRate   map[string]float64 `json:"inclusionRate"`
}

func perturbMap(m map[string]float64, eps float64, r *rand.Rand) map[string]float64 {
	out := make(map[string]float64, len(m))
	for _, k := range sortedKeys(m) { // fixed order so results are reproducible with a seed
		out[k] = m[k] * (1 + eps*(2*r.Float64()-1))
	}
	return out
}

// weightSampler returns a func that generates perturbed weights for a demand
// profile (nil = no mission: the uniform per-variable weights are perturbed).
func (m *Model) weightSampler(profile map[string]float64, eps float64) (string, func(*rand.Rand) (Vector, error)) {
	names := m.FeatureNames()
	if profile == nil {
		return "uniform_weights", func(r *rand.Rand) (Vector, error) {
			p := perturbMap(m.uniformPerVar(), eps, r)
			s := 0.0
			for _, x := range p {
				s += x
			}
			for k := range p {
				p[k] /= s
			}
			return m.expand(p, names)
		}
	}
	return "mission_profile", func(r *rand.Rand) (Vector, error) {
		rep, err := ComputeWeights(perturbMap(profile, eps, r), m.mu, m.categories)
		if err != nil {
			return nil, err
		}
		return m.expand(reportPerVar(rep), names)
	}
}

// AnalyzeRobustness on the built-in model with a built-in filter ("" = no
// mission). Deterministic given a seed (results can be reproduced).
func AnalyzeRobustness(target Candidate, pool []Candidate, filter string, k int, eps float64, trials int, seed uint64) (Robustness, error) {
	var profile map[string]float64
	if filter != "" {
		p, ok := Missions[filter]
		if !ok {
			return Robustness{}, ErrUnknownFilter
		}
		profile = p
	}
	return Default.AnalyzeRobustness(target, pool, profile, k, eps, trials, seed)
}

// AnalyzeRobustness for any demand profile of this model (nil = no mission),
// so custom variables and missions get the same sensitivity analysis.
func (m *Model) AnalyzeRobustness(target Candidate, pool []Candidate, profile map[string]float64, k int, eps float64, trials int, seed uint64) (Robustness, error) {
	if eps < 0 || eps >= 1 {
		return Robustness{}, errors.New("epsilon must be in [0, 1)")
	}
	if trials <= 0 {
		return Robustness{}, errors.New("trials must be > 0")
	}
	w, err := m.Weights(profile)
	if err != nil {
		return Robustness{}, err
	}
	what, sample := m.weightSampler(profile, eps)
	base, err := FindMostSimilar(target, pool, w, k)
	if err != nil {
		return Robustness{}, err
	}
	res := Robustness{Perturbs: what, Epsilon: eps, Trials: trials, InclusionRate: map[string]float64{}}
	if len(base) == 0 {
		return res, nil
	}
	baseSet := map[string]bool{}
	for _, b := range base {
		baseSet[b.RegionID] = true
		res.InclusionRate[b.RegionID] = 0
	}

	r := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	top1, jaccard := 0, 0.0
	for t := 0; t < trials; t++ {
		wp, err := sample(r)
		if err != nil {
			return Robustness{}, err
		}
		got, err := FindMostSimilar(target, pool, wp, k)
		if err != nil {
			return Robustness{}, err
		}
		if len(got) > 0 && got[0].RegionID == base[0].RegionID {
			top1++
		}
		inter := 0
		for _, g := range got {
			if baseSet[g.RegionID] {
				inter++
				res.InclusionRate[g.RegionID]++
			}
		}
		jaccard += float64(inter) / float64(len(base)+len(got)-inter)
	}
	res.Top1Stability = float64(top1) / float64(trials)
	res.MeanTopKJaccard = jaccard / float64(trials)
	for id := range res.InclusionRate {
		res.InclusionRate[id] /= float64(trials)
	}
	return res, nil
}
