package knn

import (
	"errors"
	"math"
	"sort"
)

// Vector: NaN marca un dato ausente (null en el JSON).
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

// MinCoverage: un candidato comparado con menos de la mitad del peso de la
// misión va detrás de los que sí alcanzan ese mínimo, aunque su distancia
// parcial sea menor (una coincidencia con pocos datos no es evidencia fuerte).
const MinCoverage = 0.5

// WeightedDistance: distancia euclídea ponderada con datos ausentes.
//
// Sea O el conjunto de dimensiones observadas en ambas regiones, W = Σ_i w_i y
// W_O = Σ_{i∈O} w_i. Entonces:
//
//	d = sqrt( W · Σ_{i∈O} w_i (a_i − b_i)² / W_O )      cobertura = W_O / W
//
// Las dimensiones ausentes se omiten y el peso se renormaliza sobre las
// presentes; es el mismo tratamiento de la distancia de Gower (1971).
// Propiedades (tests en knn_test.go):
//   - Sin ausentes, es exactamente sqrt(Σ w_i Δ_i²).
//   - Es una métrica si w_i > 0; con algún w_i = 0 (variable que la misión no
//     pide) es una pseudométrica. Con ausentes la desigualdad triangular puede
//     fallar; por eso se reporta la cobertura.
//   - Invariancia de escala: w → c·w ⇒ d → √c·d; el orden y la similitud no cambian.
//   - Tras min-max, |Δ_i| ≤ 1 ⇒ d ≤ sqrt(W) = d_max ⇒ sim = 1 − d/d_max ∈ [0, 1].
//   - Sin ninguna dimensión común (W_O = 0): d = d_max, sim = 0, cobertura = 0.
func WeightedDistance(a, b, w Vector) (dist, coverage float64, err error) {
	if len(a) != len(b) || len(a) != len(w) {
		return 0, 0, errors.New("vectores de distinta longitud")
	}
	total, obs, sum := 0.0, 0.0, 0.0
	for i := range a {
		if w[i] < 0 || math.IsNaN(w[i]) {
			return 0, 0, errors.New("pesos negativos o NaN")
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
		return 0, 0, errors.New("la suma de pesos debe ser > 0")
	}
	if obs == 0 {
		return math.Sqrt(total), 0, nil
	}
	return math.Sqrt(total * sum / obs), obs / total, nil
}

// FindMostSimilar devuelve las k regiones más parecidas.
// Orden: primero las de cobertura >= MinCoverage, luego por distancia y, a
// igual distancia, por mayor cobertura.
func FindMostSimilar(target Candidate, pool []Candidate, w Vector, k int) ([]Match, error) {
	if k <= 0 {
		return nil, errors.New("k debe ser > 0")
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
