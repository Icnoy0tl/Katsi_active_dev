package knn

import (
	"fmt"
	"math"

	"spaceapps/jsonParser"
)

// feature es una dimensión del vector que compara el KNN.
//
// MuVar es la variable del modelo de pesos (tabla Mu en mission.go) a la que
// pertenece la dimensión, y Share la fracción del peso de esa variable que
// recibe. Casi todas tienen Share = 1. La excepción es depth_to_bedrock: en Mu
// es UNA variable (un intervalo [min, max]), pero en el JSON son dos números.
// Cada extremo recibe la mitad del peso, y eso equivale a comparar el centro y
// el semiancho del intervalo, cada uno con el peso completo:
//
//	(Δmin² + Δmax²) / 2 = Δcentro² + Δsemiancho²
//
// (con centro = (min+max)/2 y semiancho = (max−min)/2; test en mission_test.go).
type feature struct {
	Name  string
	MuVar string
	Share float64
	Get   func(r *jsonParser.Region) *float64
}

func one(name string, get func(r *jsonParser.Region) *float64) feature {
	return feature{Name: name, MuVar: name, Share: 1, Get: get}
}

// 10 core + 16 audit = 26 dimensiones = 25 variables del modelo de pesos.
var features = []feature{
	// --- core
	one("slope", func(r *jsonParser.Region) *float64 { return r.CoreVariables.Slope }),
	one("radar_roughness", func(r *jsonParser.Region) *float64 { return r.CoreVariables.RadarRoughness }),
	one("apparent_thermal_inertia", func(r *jsonParser.Region) *float64 { return r.CoreVariables.ApparentThermalInertia }),
	one("soil_moisture", func(r *jsonParser.Region) *float64 { return r.CoreVariables.SoilMoisture }),
	one("visual_texture", func(r *jsonParser.Region) *float64 { return r.CoreVariables.VisualTexture }),
	one("low_sun_shadows", func(r *jsonParser.Region) *float64 { return r.CoreVariables.LowSunShadows }),
	one("line_of_sight", func(r *jsonParser.Region) *float64 { return r.CoreVariables.LineOfSight }),
	one("diurnal_thermal_range", func(r *jsonParser.Region) *float64 { return r.CoreVariables.DiurnalThermalRange }),
	one("dust_aerosols", func(r *jsonParser.Region) *float64 { return r.CoreVariables.DustAerosols }),
	one("insolation", func(r *jsonParser.Region) *float64 { return r.CoreVariables.Insolation }),
	// --- audit
	one("rock_abundance_pct", func(r *jsonParser.Region) *float64 { return r.AuditVariables.RockAbundancePct }),
	one("grain_size_um", func(r *jsonParser.Region) *float64 { return r.AuditVariables.GrainSizeUm }),
	one("angle_of_repose_deg", func(r *jsonParser.Region) *float64 { return r.AuditVariables.AngleOfReposeDeg }),
	{Name: "depth_to_bedrock_min_m", MuVar: "depth_to_bedrock", Share: 0.5,
		Get: func(r *jsonParser.Region) *float64 { return r.AuditVariables.DepthToBedrockMinM }},
	{Name: "depth_to_bedrock_max_m", MuVar: "depth_to_bedrock", Share: 0.5,
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

func FeatureNames() []string {
	names := make([]string, len(features))
	for i, f := range features {
		names[i] = f.Name
	}
	return names
}

// ToVector convierte una región en vector. Un dato ausente (null) queda como
// NaN: la distancia lo omite y lo reporta en la cobertura (ver knn.go).
func ToVector(r jsonParser.Region) (Vector, error) {
	v := make(Vector, len(features))
	for i, f := range features {
		p := f.Get(&r)
		if p == nil {
			v[i] = math.NaN()
			continue
		}
		if math.IsNaN(*p) || math.IsInf(*p, 0) {
			return nil, fmt.Errorf("valor inválido en %s", f.Name)
		}
		v[i] = *p
	}
	return v, nil
}

type Stats struct {
	Min []float64
	Max []float64
}

// ComputeStats calcula min y max por columna ignorando los datos ausentes.
func ComputeStats(vectors []Vector) Stats {
	n := len(features)
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

// Apply normaliza min-max a [0, 1]. Los ausentes siguen como NaN. Una columna
// constante (o sin datos) queda en 0 y no aporta distancia.
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

// Prepare normaliza el objetivo y el catálogo terrestre.
//
// Proyección al rango terrestre. Si en una variable el objetivo cae fuera del
// rango de todo el catálogo (p. ej. presión: Marte 0.8 kPa, Tierra 68–99.5),
// ningún análogo puede acercarse más que el borde. Para x > max y un sitio e:
//
//	(x − e)² = (x − max)² + 2(x − max)(max − e) + (max − e)²
//
// El 1.er término es igual para todos los sitios (no ordena nada) y el 2.º
// amplifica las diferencias entre sitios en proporción a lo lejos que está el
// objetivo. Solo el 3.º mide algo que un análogo terrestre puede reproducir.
// Por eso el objetivo se proyecta a [min, max] de la Tierra antes de
// normalizar: queda exactamente el 3.er término. Lo que ningún sitio cubre no
// se pierde, se reporta aparte en CheckExtrapolation.
//
// Como el objetivo proyectado siempre cae dentro del rango, las estadísticas
// min-max salen solo del catálogo terrestre: el objetivo ya no comprime la
// escala de la Tierra.
func Prepare(target jsonParser.Region, earth []jsonParser.Region) (Candidate, []Candidate, error) {
	targetVec, err := ToVector(target)
	if err != nil {
		return Candidate{}, nil, fmt.Errorf("región %s: %w", target.RegionId, err)
	}

	earthVecs := make([]Vector, len(earth))
	for i, r := range earth {
		v, err := ToVector(r)
		if err != nil {
			return Candidate{}, nil, fmt.Errorf("región tierra %s: %w", r.RegionId, err)
		}
		earthVecs[i] = v
	}

	stats := ComputeStats(earthVecs)
	normTarget := Candidate{ID: target.RegionId, Name: target.Name, Vector: stats.Apply(stats.Clamp(targetVec))}
	pool := make([]Candidate, len(earth))
	for i, r := range earth {
		pool[i] = Candidate{ID: r.RegionId, Name: r.Name, Vector: stats.Apply(earthVecs[i])}
	}
	return normTarget, pool, nil
}

// Clamp proyecta cada valor al rango [Min, Max] (los ausentes siguen ausentes;
// una columna sin datos en la Tierra no se toca).
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

// OutOfRangeVar: dimensión en la que el objetivo cae fuera del rango de TODO
// el catálogo terrestre. Ningún análogo de la Tierra puede reproducir ese
// aspecto; el KNN igual ordena, pero solo por "quién queda menos lejos".
type OutOfRangeVar struct {
	Name     string  `json:"name"`
	Value    float64 `json:"value"`
	EarthMin float64 `json:"earthMin"`
	EarthMax float64 `json:"earthMax"`
	Weight   float64 `json:"weight"` // peso de esta dimensión en el filtro
}

type Extrapolation struct {
	Variables []OutOfRangeVar `json:"variables"`
	Weight    float64         `json:"weight"`   // fracción del peso total en variables sin análogo terrestre
	Dominant  bool            `json:"dominant"` // Weight >= 0.5: más de la mitad de lo que pide la misión no existe en la Tierra
}

// OutOfRangeTolerance: margen relativo al rango terrestre antes de marcar una
// variable (10 % del rango, para no marcar diferencias mínimas en el borde).
const OutOfRangeTolerance = 0.10

// DominantExtrapolation: a partir de esta fracción del peso sin análogo, el
// resultado se compara con menos de la mitad de lo que la misión pide.
const DominantExtrapolation = 0.5

// CheckExtrapolation compara el objetivo con el rango crudo del catálogo
// terrestre (sin incluir al objetivo) y reporta qué fracción del peso del
// filtro cae en variables que la Tierra no cubre.
func CheckExtrapolation(target jsonParser.Region, earth []jsonParser.Region, w Vector) (Extrapolation, error) {
	tv, err := ToVector(target)
	if err != nil {
		return Extrapolation{}, err
	}
	if len(w) != len(features) {
		return Extrapolation{}, fmt.Errorf("pesos de longitud %d, esperaba %d", len(w), len(features))
	}
	vecs := make([]Vector, 0, len(earth))
	for _, r := range earth {
		v, err := ToVector(r)
		if err != nil {
			return Extrapolation{}, err
		}
		vecs = append(vecs, v)
	}
	st := ComputeStats(vecs)
	out := Extrapolation{Variables: []OutOfRangeVar{}}
	total := 0.0
	for _, x := range w {
		total += x
	}
	for i, f := range features {
		x, lo, hi := tv[i], st.Min[i], st.Max[i]
		if math.IsNaN(x) || math.IsInf(lo, 0) || math.IsInf(hi, 0) {
			continue // sin dato en el objetivo o en toda la Tierra
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
