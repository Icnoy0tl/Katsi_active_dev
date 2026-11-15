package knn

import (
	"fmt"
	"math"

	"spaceapps/jsonParser"
)

type feature struct {
	
	Name string
	Get func(core *jsonParser.CoreVariables ) float64

}

var features = []feature{
	{"slope", func(core *jsonParser.CoreVariables) float64 { return core.Slope }},
	{"radar_roughness", func(core *jsonParser.CoreVariables) float64 { return core.RadarRoughness }},
	{"apparent_thermal_inertia", func(core *jsonParser.CoreVariables) float64 { return core.ApparentThermalInertia }},
	{"soil_moisture", func(core *jsonParser.CoreVariables) float64 { return core.SoilMoisture }},
	{"visual_texture", func(core *jsonParser.CoreVariables) float64 { return core.VisualTexture }},
	{"low_sun_shadows", func(core *jsonParser.CoreVariables) float64 { return core.LowSunShadows }},
	{"line_of_sight", func(core *jsonParser.CoreVariables) float64 { return core.LineOfSight }},
	{"diurnal_thermal_range", func(core *jsonParser.CoreVariables) float64 { return core.DiurnalThermalRange }},
	{"dust_aerosols", func(core *jsonParser.CoreVariables) float64 { return core.DustAerosols }},
	{"insolation", func(core *jsonParser.CoreVariables) float64 { return core.Insolation }},
}

func FeatureNames() []string {
	
	names := make([]string, len(features))
	for i,f := range features {
		names[i] = f.Name
	}

	return names
}

func ToVector(cv jsonParser.CoreVariables) (Vector, error){
	v := make(Vector, len(features))
	for i, f := range features {
		val := f.Get(&cv)
		if math.IsNaN(val) || math.IsInf(val, 0) {
			return nil, fmt.Errorf("Invalid value in %s", f.Name)
		}
		v[i] = val
	}
	return v, nil
}

type Stats struct {
	
	Min []float64
	Max []float64

}

func ComputeStats(vectors []Vector) Stats {
	n := len (features)
	stat := Stats{Min: make([]float64, n), Max: make([]float64, n)}

	for i := 0; i < n ; i++ {
		stat.Min[i] = math.Inf(1)
		stat.Max[i] = math.Inf(-1)
	}

	for _, v := range vectors {
		for i, val := range v {
			stat.Min[i] = math.Min(stat.Min[i], val)
			stat.Max[i] = math.Max(stat.Max[i], val)
		}
	}

	return stat
}

func (stat Stats) Apply (v Vector) Vector {
	out := make(Vector, len(v))
	for i, val := range v {
		rng := stat.Max[i] - stat.Min[i]
		if rng == 0{
			out[i] = 0
			continue
		}
		out[i] = (val - stat.Min[i]) /rng
	}

	return out

}

func Prepare(target jsonParser.Region, earth []jsonParser.Region) (Candidate, []Candidate, error) {
	targetVec, err := ToVector(target.CoreVariables)
	if err != nil {
		return Candidate{}, nil, fmt.Errorf("región %s: %w", target.RegionId, err)
	}
 
	all := make([]Vector, 0, len(earth)+1)
	all = append(all, targetVec)
 
	earthVecs := make([]Vector, len(earth))
	for i, r := range earth {
		v, err := ToVector(r.CoreVariables)
		if err != nil {
			return Candidate{}, nil, fmt.Errorf("región tierra %s: %w", r.RegionId, err)
		}
		earthVecs[i] = v
		all = append(all, v)
	}
 
	stats := ComputeStats(all)
 
	normTarget := Candidate{ID: target.RegionId, Name: target.Name, Vector: stats.Apply(targetVec)}
	pool := make([]Candidate, len(earth))
	for i, r := range earth {
		pool[i] = Candidate{ID: r.RegionId, Name: r.Name, Vector: stats.Apply(earthVecs[i])}
	}
	return normTarget, pool, nil
}
 
