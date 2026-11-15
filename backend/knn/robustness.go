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

// weightSampler returns a func that generates perturbed weights for the filter
func weightSampler(filter string, eps float64) (string, func(*rand.Rand) (Vector, error), error) {
	names := FeatureNames()
	if filter == "" {
		return "uniform_weights", func(r *rand.Rand) (Vector, error) {
			p := perturbMap(Default.uniformPerVar(), eps, r)
			s := 0.0
			for _, x := range p {
				s += x
			}
			for k := range p {
				p[k] /= s
			}
			return Default.expand(p, names)
		}, nil
	}
	profile, ok := Missions[filter]
	if !ok {
		return "", nil, ErrUnknownFilter
	}
	return "mission_profile", func(r *rand.Rand) (Vector, error) {
		rep, err := ComputeWeights(perturbMap(profile, eps, r), Mu, Categories)
		if err != nil {
			return nil, err
		}
		return Default.expand(reportPerVar(rep), names)
	}, nil
}

// AnalyzeRobustness deterministic given a seed (Results can be reproduced)
func AnalyzeRobustness(target Candidate, pool []Candidate, filter string, k int, eps float64, trials int, seed uint64) (Robustness, error) {
	if eps < 0 || eps >= 1 {
		return Robustness{}, errors.New("epsilon must be in [0, 1)")
	}
	if trials <= 0 {
		return Robustness{}, errors.New("Trials must be > 0")
	}
	w, err := WeightsFor(filter, FeatureNames())
	if err != nil {
		return Robustness{}, err
	}
	what, sample, err := weightSampler(filter, eps)
	if err != nil {
		return Robustness{}, err
	}
	base, err := FindMostSimilar(target, pool, w, k)
	if err != nil {
		return Robustness{}, err
	}
	res := Robustness{Perturbs: what, Epsilon: eps, Trials: trials, InclusionRate: map[string]float64{}}
	if len(base) == 0 {
		return res, nil
	}
	baseSet := map[string]bool{}
	for _, m := range base {
		baseSet[m.RegionID] = true
		res.InclusionRate[m.RegionID] = 0
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
		if got[0].RegionID == base[0].RegionID {
			top1++
		}
		inter := 0
		for _, m := range got {
			if baseSet[m.RegionID] {
				inter++
				res.InclusionRate[m.RegionID]++
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
