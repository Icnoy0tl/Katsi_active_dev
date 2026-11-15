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
}

// Weight based in mision filter, name indexed so weights cant multiply wrong variables
//TODO Weights are hardcoded, full mathematical fundamentation is due 
var filterWeights = map[string]map[string]float64{
	"rover": {
		"slope": 1.0, "radar_roughness": 0.9, "visual_texture": 0.7,
		"low_sun_shadows": 0.6, "dust_aerosols": 0.6, "line_of_sight": 0.5,
		"insolation": 0.4, "apparent_thermal_inertia": 0.3,
		"soil_moisture": 0.2, "diurnal_thermal_range": 0.2,
	},
	"ice_and_volatiles": {
		"soil_moisture": 1.0, "apparent_thermal_inertia": 0.8, "insolation": 0.8,
		"low_sun_shadows": 0.7, "diurnal_thermal_range": 0.5, "radar_roughness": 0.3,
		"dust_aerosols": 0.3, "slope": 0.2, "visual_texture": 0.2, "line_of_sight": 0.1,
	},
	"thermal_cycles": {
		"diurnal_thermal_range": 1.0, "apparent_thermal_inertia": 0.9, "insolation": 0.7,
		"dust_aerosols": 0.5, "soil_moisture": 0.4, "slope": 0.1, "radar_roughness": 0.1,
		"visual_texture": 0.1, "low_sun_shadows": 0.2, "line_of_sight": 0.1,
	},
}

var ErrUnknownFilter = errors.New("filtro desconocido")

// Coonstructs the vectore of weights to be evaluated 

func WeightsFor(filter string, names []string) (Vector, error) {
	w := make(Vector, len(names))
	if filter == "" {
		for i := range w {
			w[i] = 1.0
		}
		return w, nil // if not active filter by default every value weights the same
	}
	table, ok := filterWeights[filter]
	if !ok {
		return nil, ErrUnknownFilter
	}
	for i, n := range names {
		w[i] = table[n] 
	}
	return w, nil
}

func WeightedEuclideanDistance(a, b, w Vector) (float64, error) {
	if len(a) != len(b) || len(a) != len(w) {
		return 0, errors.New("vectores de distinta longitud")
	}
	sum := 0.0
	for i := range a {
		d := a[i] - b[i]
		sum += w[i] * d * d
	}
	return math.Sqrt(sum), nil
}

// FindMostSimilar returns k regions closer
func FindMostSimilar(target Candidate, pool []Candidate, w Vector, k int) ([]Match, error) {
	if k <= 0 {
		return nil, errors.New("k debe ser > 0")
	}

	maxDist := 0.0
	for _, wi := range w {
		maxDist += wi
	}
	maxDist = math.Sqrt(maxDist)

	matches := make([]Match, 0, len(pool))
	for _, c := range pool {
		d, err := WeightedEuclideanDistance(target.Vector, c.Vector, w)
		if err != nil {
			return nil, err
		}
		sim := 0.0
		if maxDist > 0 {
			sim = 1 - d/maxDist
		}
		matches = append(matches, Match{RegionID: c.ID, Name: c.Name, Distance: d, Similarity: sim})
	}

	sort.SliceStable(matches, func(i, j int) bool { return matches[i].Distance < matches[j].Distance })

	if len(matches) > k {
		matches = matches[:k]
	}
	return matches, nil
}