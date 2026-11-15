package knn

import (
	"fmt"
	"math"

	"spaceapps/jsonParser"
)

// feature is a dimension of the vector compared by KNN.
//
// MuVar is the weight model variable (Mu table in mission.go) to which
// the dimension belongs, and Share is the fraction of that variable's weight that
// it receives. Almost all have Share = 1. The exception is depth_to_bedrock: in Mu
// it is ONE variable (an interval [min, max]), but in the JSON they are two numbers.
// Each endpoint receives half of the weight, and that is equivalent to comparing the center and
// the semi-width of the interval, each with full weight:
//
//  (Δmin² + Δmax²) / 2 = Δcenter² + Δsemiwidth²
//
// (with center = (min+max)/2 and semiwidth = (max−min)/2; test in mission_test.go).
//
// Group indicates which block of the JSON it comes from ("core" = coreVariables,
// "audit" = auditVariables); the API exposes it for frontend grouping.

type feature struct {
	Name  string
	Group string
	MuVar string
	Share float64
	Get   func(r *jsonParser.Region) *float64
}

func core(name string, get func(r *jsonParser.Region) *float64) feature {
	return feature{Name: name, Group: "core", MuVar: name, Share: 1, Get: get}
}

func one(name string, get func(r *jsonParser.Region) *float64) feature {
	return feature{Name: name, Group: "audit", MuVar: name, Share: 1, Get: get}
}

var features = []feature{
	// --- core
	core("slope", func(r *jsonParser.Region) *float64 { return r.CoreVariables.Slope }),
	core("radar_roughness", func(r *jsonParser.Region) *float64 { return r.CoreVariables.RadarRoughness }),
	core("apparent_thermal_inertia", func(r *jsonParser.Region) *float64 { return r.CoreVariables.ApparentThermalInertia }),
	core("soil_moisture", func(r *jsonParser.Region) *float64 { return r.CoreVariables.SoilMoisture }),
	core("visual_texture", func(r *jsonParser.Region) *float64 { return r.CoreVariables.VisualTexture }),
	core("low_sun_shadows", func(r *jsonParser.Region) *float64 { return r.CoreVariables.LowSunShadows }),
	core("line_of_sight", func(r *jsonParser.Region) *float64 { return r.CoreVariables.LineOfSight }),
	core("diurnal_thermal_range", func(r *jsonParser.Region) *float64 { return r.CoreVariables.DiurnalThermalRange }),
	core("dust_aerosols", func(r *jsonParser.Region) *float64 { return r.CoreVariables.DustAerosols }),
	core("insolation", func(r *jsonParser.Region) *float64 { return r.CoreVariables.Insolation }),
	// --- audit
	one("rock_abundance_pct", func(r *jsonParser.Region) *float64 { return r.AuditVariables.RockAbundancePct }),
	one("grain_size_um", func(r *jsonParser.Region) *float64 { return r.AuditVariables.GrainSizeUm }),
	one("angle_of_repose_deg", func(r *jsonParser.Region) *float64 { return r.AuditVariables.AngleOfReposeDeg }),
	{Name: "depth_to_bedrock_min_m", Group: "audit", MuVar: "depth_to_bedrock", Share: 0.5,
		Get: func(r *jsonParser.Region) *float64 { return r.AuditVariables.DepthToBedrockMinM }},
	{Name: "depth_to_bedrock_max_m", Group: "audit", MuVar: "depth_to_bedrock", Share: 0.5,
		Get: func(r *jsonParser.Region) *float64 { return r.AuditVariables.DepthToBedrockMaxM }},
	one("vrm_microrelief", func(r *jsonParser.Region) *float64 { return r.AuditVariables.VrmMicrorelief }),
	one("dielectric_constant", func(r *jsonParser.Region) *float64 { return r.AuditVariables.DielectricConstant }),
	one("salinity_wt_pct", func(r *jsonParser.Region) *float64 { return r.AuditVariables.SalinityWtPct }),
	one("diffuse_ratio", func(r *jsonParser.Region) *float64 { return r.AuditVariables.DiffuseRatio }),
	one("albedo", func(r *jsonParser.Region) *float64 { return r.AuditVariables.Albedo }),
	one("vegetation_ndvi", func(r *jsonParser.Region) *float64 { return r.AuditVariables.VegetationNdvi }),
	one("surface_pressure_kpa", func(r *jsonParser.Region) *float64 { return r.AuditVariables.SurfacePressureKpa }),
	one("wind_typical_ms", func(r *jsonParser.Region) *float64 { return r.AuditVariables.WindTypicalMs }),
	one("wind_gust_ms", func(r *jsonParser.Region) *float64 { return r.AuditVariables.WindGustMs }),
	one("abrasive_mohs", func(r *jsonParser.Region) *float64 { return r.AuditVariables.AbrasiveMohs }),
	one("ground_ice_index", func(r *jsonParser.Region) *float64 { return r.AuditVariables.GroundIceIndex }),
}

// FeatureNames: dimensions of the built-in model (no custom variables).
func FeatureNames() []string { return Default.FeatureNames() }

// FeatureNames: dimensions of this model, in vector order.
func (m *Model) FeatureNames() []string {
	names := make([]string, len(m.features))
	for i, f := range m.features {
		names[i] = f.Name
	}
	return names
}

func ToVector(r jsonParser.Region) (Vector, error) { return Default.ToVector(r) }

// ToVector: region → raw vector in this model's dimension order (nil → NaN).
func (m *Model) ToVector(r jsonParser.Region) (Vector, error) {
	v := make(Vector, len(m.features))
	for i, f := range m.features {
		p := f.Get(&r)
		if p == nil {
			v[i] = math.NaN()
			continue
		}
		if math.IsNaN(*p) || math.IsInf(*p, 0) {
			return nil, fmt.Errorf("Invalid value in %s", f.Name)
		}
		v[i] = *p
	}
	return v, nil
}

type Stats struct {
	Min []float64
	Max []float64
}

// ComputeStats computes min and max ignoring missing values (built-in model).
func ComputeStats(vectors []Vector) Stats { return Default.ComputeStats(vectors) }

// ComputeStats computes min and max per dimension, ignoring missing values.
func (m *Model) ComputeStats(vectors []Vector) Stats {
	n := len(m.features)
	stat := Stats{Min: make([]float64, n), Max: make([]float64, n)}
	for i := 0; i < n; i++ {
		stat.Min[i] = math.Inf(1)
		stat.Max[i] = math.Inf(-1)
	}
	for _, v := range vectors {
		for i, val := range v {
			if math.IsNaN(val) {
				continue
			}
			stat.Min[i] = math.Min(stat.Min[i], val)
			stat.Max[i] = math.Max(stat.Max[i], val)
		}
	}
	return stat
}

// Normalize min-max a [0, 1].
func (stat Stats) Apply(v Vector) Vector {
	out := make(Vector, len(v))
	for i, val := range v {
		if math.IsNaN(val) {
			out[i] = math.NaN()
			continue
		}
		rng := stat.Max[i] - stat.Min[i]
		if !(rng > 0) {
			out[i] = 0
			continue
		}
		out[i] = (val - stat.Min[i]) / rng
	}
	return out
}

// Prepare normalizes the target and the terrestrial catalog.
//
// Projection to the terrestrial range. If for a variable the target falls outside the
// range of the entire catalog (e.g., pressure: Mars 0.8 kPa, Earth 68–99.5),
// no analog can get closer than the boundary. For x > max and a site e:
//
//	(x − e)² = (x − max)² + 2(x − max)(max − e) + (max − e)²
//
// The 1st term is equal for all sites (it does not order anything) and the 2nd
// amplifies the differences between sites in proportion to how far the target is.
// Only the 3rd measures something that a terrestrial analog can reproduce.
// Therefore, the target is projected to Earth's [min, max] before
// normalizing: exactly the 3rd term remains. What no site covers is
// not lost, it is reported separately in CheckExtrapolation.
//
// Since the projected target always falls within the range, the min-max
// statistics come solely from the terrestrial catalog: the target no longer compresses
// the Earth's scale
func Prepare(target jsonParser.Region, earth []jsonParser.Region) (Candidate, []Candidate, error) {
	return Default.Prepare(target, earth)
}

func (m *Model) Prepare(target jsonParser.Region, earth []jsonParser.Region) (Candidate, []Candidate, error) {
	t, pool, _, err := m.PrepareWithStats(target, earth)
	return t, pool, err
}

// PrepareWithStats is Prepare and also returns the min-max statistics of the
// terrestrial catalog, to be able to explain the comparison (breakdown.go) with
// exactly the same scale used by the KNN.
func PrepareWithStats(target jsonParser.Region, earth []jsonParser.Region) (Candidate, []Candidate, Stats, error) {
	return Default.PrepareWithStats(target, earth)
}

func (m *Model) PrepareWithStats(target jsonParser.Region, earth []jsonParser.Region) (Candidate, []Candidate, Stats, error) {
	targetVec, err := m.ToVector(target)
	if err != nil {
		return Candidate{}, nil, Stats{}, fmt.Errorf("región %s: %w", target.RegionId, err)
	}

	earthVecs := make([]Vector, len(earth))
	for i, r := range earth {
		v, err := m.ToVector(r)
		if err != nil {
			return Candidate{}, nil, Stats{}, fmt.Errorf("región tierra %s: %w", r.RegionId, err)
		}
		earthVecs[i] = v
	}

	stats := m.ComputeStats(earthVecs)
	normTarget := Candidate{ID: target.RegionId, Name: target.Name, Vector: stats.Apply(stats.Clamp(targetVec))}
	pool := make([]Candidate, len(earth))
	for i, r := range earth {
		pool[i] = Candidate{ID: r.RegionId, Name: r.Name, Vector: stats.Apply(earthVecs[i])}
	}
	return normTarget, pool, stats, nil
}

func (stat Stats) Clamp(v Vector) Vector {
	out := make(Vector, len(v))
	for i, x := range v {
		lo, hi := stat.Min[i], stat.Max[i]
		switch {
		case math.IsNaN(x) || math.IsInf(lo, 0) || math.IsInf(hi, 0):
			out[i] = x
		default:
			out[i] = math.Min(math.Max(x, lo), hi)
		}
	}
	return out
}

type OutOfRangeVar struct {
	Name     string  `json:"name"`
	Value    float64 `json:"value"`
	EarthMin float64 `json:"earthMin"`
	EarthMax float64 `json:"earthMax"`
	Weight   float64 `json:"weight"`
}

type Extrapolation struct {
	Variables []OutOfRangeVar `json:"variables"`
	Weight    float64         `json:"weight"`
	Dominant  bool            `json:"dominant"`
}

const OutOfRangeTolerance = 0.10

const DominantExtrapolation = 0.5

func CheckExtrapolation(target jsonParser.Region, earth []jsonParser.Region, w Vector) (Extrapolation, error) {
	return Default.CheckExtrapolation(target, earth, w)
}

func (m *Model) CheckExtrapolation(target jsonParser.Region, earth []jsonParser.Region, w Vector) (Extrapolation, error) {
	tv, err := m.ToVector(target)
	if err != nil {
		return Extrapolation{}, err
	}
	if len(w) != len(m.features) {
		return Extrapolation{}, fmt.Errorf("pesos de longitud %d, esperaba %d", len(w), len(m.features))
	}
	vecs := make([]Vector, 0, len(earth))
	for _, r := range earth {
		v, err := m.ToVector(r)
		if err != nil {
			return Extrapolation{}, err
		}
		vecs = append(vecs, v)
	}
	st := m.ComputeStats(vecs)
	out := Extrapolation{Variables: []OutOfRangeVar{}}
	total := 0.0
	for _, x := range w {
		total += x
	}
	for i, f := range m.features {
		x, lo, hi := tv[i], st.Min[i], st.Max[i]
		if math.IsNaN(x) || math.IsInf(lo, 0) || math.IsInf(hi, 0) {
			continue
		}
		tol := OutOfRangeTolerance * (hi - lo)
		if x < lo-tol || x > hi+tol {
			out.Variables = append(out.Variables, OutOfRangeVar{Name: f.Name, Value: x, EarthMin: lo, EarthMax: hi, Weight: w[i]})
			out.Weight += w[i]
		}
	}
	if total > 0 {
		out.Weight /= total
	}
	out.Dominant = out.Weight >= DominantExtrapolation
	return out, nil
}