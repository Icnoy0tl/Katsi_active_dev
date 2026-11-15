package knn

// MODELO DE PESOS POR TIPO DE VARIABLE Y TIPO DE MISIÓN
// (port de pesos_mision.py, con la decisión sobre la pregunta pendiente aplicada)
//
// No usa los valores de las regiones, solo:
//   (a) Mu[j]: el TIPO de la variable j, un reparto de probabilidad sobre las
//       categorías (cada fila suma 1);
//   (b) d: el PERFIL de demanda de la misión (≥ 0, suma > 0, se normaliza solo).
//
// F1  afinidad   r_j = Σ_c μ_jc d_c = |μ_j||d| cos θ_j        (diagnóstico)
// F2′ peso       w_j = Σ_c μ_jc d̃_c / n_c,   n_c = Σ_i μ_ic
//
// F2′ es F1 con la demanda de cada categoría repartida entre sus n_c
// variables. Responde a la pregunta pendiente del README: la categoría recibe
// exactamente el peso que pide la misión, sin importar cuántas variables
// medimos de ella.
//
// Derivación. Cada variable j se divide en porciones (j, c) con masa a priori
// μ_jc. Se busca el reparto q que se aleja menos de esa masa a priori (mínima
// divergencia KL) sujeto a que cada categoría reciba su demanda:
//
//	min Σ q_jc ln(q_jc / μ_jc)   s.a.  Σ_j q_jc = d̃_c  ∀c
//	∂L/∂q_jc = ln(q_jc/μ_jc) + 1 − λ_c = 0  ⇒  q_jc = μ_jc e^{λ_c − 1}
//	Σ_j q_jc = d̃_c  ⇒  e^{λ_c − 1} = d̃_c / n_c  ⇒  q_jc = μ_jc d̃_c / n_c
//
// La KL es estrictamente convexa, así que el óptimo es único. w_j = Σ_c q_jc.
//
// Relación con F2/F3 del README (softmax + β calibrado a N* = n e^{H(d)}/C):
// con categorías balanceadas (n_c = n/C) y tipos puros,
// N_ef(F2′) = e^{H(d)} Π n_c^{d_c} = n e^{H(d)}/C = N*. F2′ alcanza el mismo
// objetivo de concentración sin parámetro libre: no hay β, bisección,
// BETA_MAX ni piso_aplicado.

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

var Categories = []string{"GEO", "MEC", "VOL", "TER", "ENE", "ATM", "NAV"}

// GEO geometría del terreno | MEC mecánica de suelo | VOL volátiles/química/bio
// TER térmico | ENE energía/iluminación | ATM atmósfera/viento | NAV navegación/comms
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
	"depth_to_bedrock":         {"MEC": .8, "GEO": .2}, // agrupa _min_m y _max_m
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
	// Hielo somero: sobre todo volátil (recurso de agua) y en parte mecánico
	// (el suelo cementado por hielo cambia la excavación y la capacidad portante).
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
	Affinity float64 `json:"affinity"` // F1: r_j = μ_j · d̃ (diagnóstico, en [0, 1])
	Weight   float64 `json:"weight"`   // F2′: w_j (Σ = 1)
	Factor   float64 `json:"factor"`   // n · w_j (media 1: >1 sube, <1 baja)
}

type WeightReport struct {
	Mission    string                    `json:"mission"`
	Profile    map[string]float64        `json:"profile"` // d̃: demanda renormalizada sobre las categorías usadas
	NEf        float64                   `json:"nEf"`     // e^{H(w)}: entre cuántas variables "parece" repartirse el peso
	NStar      float64                   `json:"nStar"`   // N* del README (referencia)
	AngleDeg   float64                   `json:"angleDeg"`
	NoAffinity bool                      `json:"noAffinity"` // la misión solo pide categorías sin variables → pesos parejos
	Variables  map[string]VariableWeight `json:"variables"`
}

// ---------------------------------------------------------------- validación

func validateVector(vec map[string]float64, ok map[string]bool, name string, sumOne bool) error {
	keys := make([]string, 0, len(vec))
	for c := range vec {
		keys = append(keys, c)
	}
	sort.Strings(keys)
	s := 0.0
	for _, c := range keys {
		// Una clave mal escrita ("GEOO") se ignoraría en silencio → error.
		if !ok[c] {
			return fmt.Errorf("%s: categoría desconocida %q", name, c)
		}
		x := vec[c]
		if math.IsNaN(x) || math.IsInf(x, 0) || x < 0 {
			return fmt.Errorf("%s[%s]=%v: debe ser finito y >= 0", name, c, x)
		}
		s += x
	}
	if sumOne && math.Abs(s-1) > 1e-9 {
		return fmt.Errorf("%s: suma %v, debe sumar 1", name, s)
	}
	if !sumOne && !(s > 0) {
		return fmt.Errorf("%s: suma 0, la misión no demanda nada", name)
	}
	return nil
}

func validateModel(mu map[string]map[string]float64, profile map[string]float64, cats []string) error {
	ok := make(map[string]bool, len(cats))
	for _, c := range cats {
		if ok[c] {
			return errors.New("categorías con duplicados")
		}
		ok[c] = true
	}
	if len(cats) == 0 {
		return errors.New("categorías vacías")
	}
	if len(mu) == 0 {
		return errors.New("Mu no tiene variables")
	}
	for _, v := range sortedKeys(mu) {
		if err := validateVector(mu[v], ok, "Mu["+v+"]", true); err != nil {
			return err
		}
	}
	return validateVector(profile, ok, "perfil de misión", false)
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

// ---------------------------------------------------------------- F1 + F2′

func ComputeWeights(profile map[string]float64, mu map[string]map[string]float64, cats []string) (WeightReport, error) {
	if err := validateModel(mu, profile, cats); err != nil {
		return WeightReport{}, err
	}
	vars := sortedKeys(mu)
	n := len(vars)
	rep := WeightReport{Profile: map[string]float64{}, Variables: make(map[string]VariableWeight, n)}

	// n_c = Σ_j μ_jc. Solo cuentan las categorías que alguna variable usa: una
	// categoría vacía no puede influir (invariancia del README).
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
		// La misión solo demanda categorías que ninguna variable cubre:
		// no hay información para priorizar → pesos parejos (no se inventa nada).
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
	// Ángulo de Hellinger respecto del reparto parejo: √w está en la esfera
	// unidad; cos θ = Σ √(w_j / n). θ = 0 → parejo; mayor θ → más concentrado.
	cos := 0.0
	for _, x := range w {
		cos += math.Sqrt(x / float64(n))
	}
	rep.AngleDeg = math.Acos(math.Min(1, cos)) * 180 / math.Pi
	return rep, nil
}

// ---------------------------------------------------------------- arranque

// validateFeatureMapping comprueba que el vector del KNN y Mu describan
// exactamente las mismas variables: cada dimensión apunta a una variable de Mu,
// cada variable de Mu tiene al menos una dimensión y sus Share suman 1.
func validateFeatureMapping() error {
	shares := map[string]float64{}
	for _, f := range features {
		if _, ok := Mu[f.MuVar]; !ok {
			return fmt.Errorf("la dimensión %q apunta a %q, que no está en Mu", f.Name, f.MuVar)
		}
		if !(f.Share > 0 && f.Share <= 1) {
			return fmt.Errorf("la dimensión %q tiene Share=%v fuera de (0, 1]", f.Name, f.Share)
		}
		shares[f.MuVar] += f.Share
	}
	for _, v := range sortedKeys(Mu) {
		if math.Abs(shares[v]-1) > 1e-12 {
			return fmt.Errorf("la variable %q de Mu tiene Share total %v (debe ser 1; 0 = no está en el vector)", v, shares[v])
		}
	}
	return nil
}

// Se calcula una vez al arrancar; si el modelo es inválido el servidor no
// arranca (es configuración en código: mejor fallar temprano).
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

// expand reparte el peso de cada variable de Mu entre sus dimensiones del
// vector (según Share), alineado con names.
func expand(perVar map[string]float64, names []string) (Vector, error) {
	byName := make(map[string]feature, len(features))
	for _, f := range features {
		byName[f.Name] = f
	}
	w := make(Vector, len(names))
	for i, n := range names {
		f, ok := byName[n]
		if !ok {
			// Antes esto daba peso 0 en silencio y la variable se ignoraba.
			return nil, fmt.Errorf("la dimensión %q no está en el modelo de pesos", n)
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

// WeightsFor devuelve el vector de pesos (Σ = 1) alineado con names.
// Sin filtro: peso parejo 1/25 por VARIABLE (no por dimensión), así que las dos
// columnas de depth_to_bedrock se reparten 1/50 cada una.
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
