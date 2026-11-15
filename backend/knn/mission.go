package knn

// WEIGHT MODEL BY VARIABLE TYPE AND MISSION TYPE
// (port of pesos_mision.py, with the decision on the pending question applied)
//
// It does not use regional values, only:
//   (a) Mu[j]: the TYPE of variable j, a probability distribution over the
//       categories (each row sums to 1);
//   (b) d: the mission demand PROFILE (≥ 0, sum > 0, normalized automatically).
//
// F1  affinity   r_j = Σ_c μ_jc d_c = |μ_j||d| cos θ_j        (diagnostic)
// F2′ weight     w_j = Σ_c μ_jc d̃_c / n_c,   n_c = Σ_i μ_ic
//
// F2′ is F1 with the demand of each category distributed among its n_c
// variables. It answers the pending question from the README: the category receives
// exactly the weight requested by the mission, regardless of how many variables
// we measure from it.
//
// Derivation. Each variable j is divided into portions (j, c) with a priori mass
// μ_jc. We look for the distribution q that deviates the least from that a priori mass (minimum
// KL divergence) subject to each category receiving its demand:
//
//  min Σ q_jc ln(q_jc / μ_jc)   s.t.  Σ_j q_jc = d̃_c  ∀c
//  ∂L/∂q_jc = ln(q_jc/μ_jc) + 1 − λ_c = 0  ⇒  q_jc = μ_jc e^{λ_c − 1}
//  Σ_j q_jc = d̃_c  ⇒  e^{λ_c − 1} = d̃_c / n_c  ⇒  q_jc = μ_jc d̃_c / n_c
//
// KL is strictly convex, so the optimum is unique. w_j = Σ_c q_jc.
//
// Relation to F2/F3 from the README (softmax + β calibrated to N* = n e^{H(d)}/C):
// with balanced categories (n_c = n/C) and pure types,
// N_ef(F2′) = e^{H(d)} Π n_c^{d_c} = n e^{H(d)}/C = N*. F2′ achieves the same
// concentration objective without a free parameter: there is no β, bisection,
// BETA_MAX, or floor_applied.

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

var Categories = []string{"GEO", "MEC", "VOL", "TER", "ENE", "ATM", "NAV"}

// GEO terrain geometry | MEC soil mechanics | VOL volatiles/chemistry/bio
// TER thermal | ENE energy/illumination | ATM atmosphere/wind | NAV navigation/comms

var Mu = map[string]map[string]float64{
	"slope":                    {"GEO": 1},
	"radar_roughness":          {"GEO": .7, "MEC": .3},
	"apparent_thermal_inertia": {"MEC": .5, "TER": .5},
	"soil_moisture":            {"MEC": .5, "VOL": .5},
	"visual_texture":           {"GEO": .5, "NAV": .5},
	"low_sun_shadows":          {"GEO": .6, "NAV": .4},
	"line_of_sight":            {"NAV": 1},
	"diurnal_thermal_range":    {"TER": 1},
	"dust_aerosols":            {"ATM": .5, "ENE": .5},
	"insolation":               {"ENE": .8, "TER": .2},
	"rock_abundance_pct":       {"GEO": .6, "MEC": .4},
	"grain_size_um":            {"MEC": 1},
	"angle_of_repose_deg":      {"MEC": 1},
	"depth_to_bedrock":         {"MEC": .8, "GEO": .2}, 
	"vrm_microrelief":          {"GEO": 1},
	"dielectric_constant":      {"VOL": .7, "MEC": .3},
	"salinity_wt_pct":          {"VOL": 1},
	"diffuse_ratio":            {"ENE": 1},
	"albedo":                   {"ENE": .5, "TER": .5},
	"vegetation_ndvi":          {"VOL": 1},
	"surface_pressure_kpa":     {"ATM": 1},
	"wind_typical_ms":          {"ATM": 1},
	"wind_gust_ms":             {"ATM": 1},
	"abrasive_mohs":            {"MEC": 1},

	"ground_ice_index": {"VOL": .7, "MEC": .3},
}

var Missions = map[string]map[string]float64{
	"rover":    {"GEO": .30, "MEC": .35, "VOL": .20, "NAV": .10, "ENE": .05},
	"edl":      {"GEO": .35, "ATM": .35, "NAV": .10, "MEC": .10, "ENE": .05, "TER": .05},
	"habitat":  {"TER": .20, "ENE": .20, "ATM": .15, "MEC": .15, "VOL": .15, "GEO": .10, "NAV": .05},
	"agua_bio": {"VOL": .50, "MEC": .20, "TER": .15, "GEO": .10, "ENE": .05},
}

var ErrUnknownFilter = errors.New("filtro desconocido")

type VariableWeight struct {
	Affinity float64 `json:"affinity"` 
	Weight   float64 `json:"weight"`   
	Factor   float64 `json:"factor"`   
}

type WeightReport struct {
	Mission    string                    `json:"mission"`
	Profile    map[string]float64        `json:"profile"`
	NEf        float64                   `json:"nEf"`     
	NStar      float64                   `json:"nStar"`   
	AngleDeg   float64                   `json:"angleDeg"`
	NoAffinity bool                      `json:"noAffinity"` 
	Variables  map[string]VariableWeight `json:"variables"`
}


func validateVector(vec map[string]float64, ok map[string]bool, name string, sumOne bool) error {
	keys := make([]string, 0, len(vec))
	for c := range vec {
		keys = append(keys, c)
	}
	sort.Strings(keys)
	s := 0.0
	for _, c := range keys {
		// Handle so typos ("GEOO") wont ignore, now raises error.
		if !ok[c] {
			return fmt.Errorf("%s: category unknown %q", name, c)
		}
		x := vec[c]
		if math.IsNaN(x) || math.IsInf(x, 0) || x < 0 {
			return fmt.Errorf("%s[%s]=%v: must be finite y >= 0", name, c, x)
		}
		s += x
	}
	if sumOne && math.Abs(s-1) > 1e-9 {
		return fmt.Errorf("%s: sum %v, must be 1", name, s)
	}
	if !sumOne && !(s > 0) {
		return fmt.Errorf("%s: sum 0, mission is not demanding nothing", name)
	}
	return nil
}

func validateModel(mu map[string]map[string]float64, profile map[string]float64, cats []string) error {
	ok := make(map[string]bool, len(cats))
	for _, c := range cats {
		if ok[c] {
			return errors.New("Duplicated categories")
		}
		ok[c] = true
	}
	if len(cats) == 0 {
		return errors.New("Empty Categorys")
	}
	if len(mu) == 0 {
		return errors.New("Mu has no vars")
	}
	for _, v := range sortedKeys(mu) {
		if err := validateVector(mu[v], ok, "Mu["+v+"]", true); err != nil {
			return err
		}
	}
	return validateVector(profile, ok, "Mision profile", false)
}

func sortedKeys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func entropy(p []float64) float64 {
	h := 0.0
	for _, x := range p {
		if x > 0 {
			h -= x * math.Log(x)
		}
	}
	return h
}


func ComputeWeights(profile map[string]float64, mu map[string]map[string]float64, cats []string) (WeightReport, error) {
	if err := validateModel(mu, profile, cats); err != nil {
		return WeightReport{}, err
	}
	vars := sortedKeys(mu)
	n := len(vars)
	rep := WeightReport{Profile: map[string]float64{}, Variables: make(map[string]VariableWeight, n)}

	// n_c = Σ_j μ_jc.

	nc := map[string]float64{}
	for _, v := range vars {
		for _, c := range cats {
			nc[c] += mu[v][c]
		}
	}
	var used []string
	mass := 0.0
	for _, c := range cats {
		if nc[c] > 0 {
			used = append(used, c)
			mass += profile[c]
		}
	}

	w := make([]float64, n)
	if !(mass > 0) {
		
		for i, v := range vars {
			w[i] = 1 / float64(n)
			rep.Variables[v] = VariableWeight{Weight: w[i], Factor: 1}
		}
		rep.NoAffinity, rep.NEf, rep.NStar = true, float64(n), float64(n)
		rep.AngleDeg = 0
		return rep, nil
	}

	d := make([]float64, 0, len(used))
	for _, c := range used {
		rep.Profile[c] = profile[c] / mass
		d = append(d, rep.Profile[c])
	}

	for i, v := range vars {
		r, wi := 0.0, 0.0
		for _, c := range used {
			x := mu[v][c]
			r += x * rep.Profile[c]
			wi += x * rep.Profile[c] / nc[c]
		}
		w[i] = wi
		rep.Variables[v] = VariableWeight{Affinity: r, Weight: wi, Factor: float64(n) * wi}
	}

	rep.NEf = math.Exp(entropy(w))
	rep.NStar = float64(n) * math.Exp(entropy(d)) / float64(len(used))

	cos := 0.0
	for _, x := range w {
		cos += math.Sqrt(x / float64(n))
	}
	rep.AngleDeg = math.Acos(math.Min(1, cos)) * 180 / math.Pi
	return rep, nil
}


func validateFeatureMapping() error {
	shares := map[string]float64{}
	for _, f := range features {
		if _, ok := Mu[f.MuVar]; !ok {
			return fmt.Errorf("Dimension %q points to %q, which is not in mu", f.Name, f.MuVar)
		}
		if !(f.Share > 0 && f.Share <= 1) {
			return fmt.Errorf("Dimension %q has share = %f outside from (0, 1]", f.Name, f.Share)
		}
		shares[f.MuVar] += f.Share
	}
	for _, v := range sortedKeys(Mu) {
		if math.Abs(shares[v]-1) > 1e-12 {
			return fmt.Errorf(" %q Mu has a Share total %v (Must be 1; 0 = not in vector)", v, shares[v])
		}
	}
	return nil
}


var missionReports = func() map[string]WeightReport {
	if err := validateFeatureMapping(); err != nil {
		panic("knn: " + err.Error())
	}
	out := make(map[string]WeightReport, len(Missions))
	for _, name := range sortedKeys(Missions) {
		rep, err := ComputeWeights(Missions[name], Mu, Categories)
		if err != nil {
			panic(fmt.Sprintf("knn: misión %s: %v", name, err))
		}
		rep.Mission = name
		out[name] = rep
	}
	return out
}()

func MissionNames() []string { return sortedKeys(Missions) }

func MissionReports() []WeightReport {
	out := make([]WeightReport, 0, len(missionReports))
	for _, k := range sortedKeys(missionReports) {
		out = append(out, missionReports[k])
	}
	return out
}


func expand(perVar map[string]float64, names []string) (Vector, error) {
	byName := make(map[string]feature, len(features))
	for _, f := range features {
		byName[f.Name] = f
	}
	w := make(Vector, len(names))
	for i, n := range names {
		f, ok := byName[n]
		if !ok {
			
			return nil, fmt.Errorf("Dimension %q is not in the model of weights", n)
		}
		w[i] = perVar[f.MuVar] * f.Share
	}
	return w, nil
}

func uniformPerVar() map[string]float64 {
	out := make(map[string]float64, len(Mu))
	for v := range Mu {
		out[v] = 1 / float64(len(Mu))
	}
	return out
}

func reportPerVar(rep WeightReport) map[string]float64 {
	out := make(map[string]float64, len(rep.Variables))
	for v, x := range rep.Variables {
		out[v] = x.Weight
	}
	return out
}


func WeightsFor(filter string, names []string) (Vector, error) {
	if filter == "" {
		return expand(uniformPerVar(), names)
	}
	rep, ok := missionReports[filter]
	if !ok {
		return nil, ErrUnknownFilter
	}
	return expand(reportPerVar(rep), names)
}
