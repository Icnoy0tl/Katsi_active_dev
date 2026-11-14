package main

import (
	"math"
)

type Features struct {

	Foo	float64
	Faa float64
	Fii float64
	// fill with whatever pookie(jorge) say 

} // physical and ambiental characteristics 

type Region struct {
	ID		string `json:"id"`
	Name	string `json:"name"`
	Features Features `json:"features"`
}

type FilterWeights struct { // it adds a weight to the characteristics based in the filter
	Foo	float64
	Faa float64
	Fii float64
}

func GetWeights(filter string) FilterWeights {
	switch filter{
		case "rover":
			return FilterWeights{Foo:0.8,Faa:0.2,Fii: 0.25} //Filter weigths shall be dynamically obtained (with mathematical fundament rather than hardcoded like rn)
															// Weights goes from 0 to 1, default case is .25 to keep it equilibrated (default)
		case "ice_and_volatiles":
			return FilterWeights{Foo: 0.3, Faa: 0.1 , Fii: 0.4}

		case "thermal_cycles":
			return FilterWeights{Foo: 0.1 , Faa: 0.3 , Fii: 0.6 }

		default: 
			return FilterWeights{Foo: 0.3, Faa: 0.1, Fii: 0.4}
		}
}

func WeightedEuclideanDistance(f1, f2 Features, w FilterWeights) float64 {
	//calculates euclidean distance
	sum := w.Fii * math.Pow(f1.Foo - f2.Foo, 2 ) + w.Faa * math.Pow(f1.Fii - f2.Fii, 2) + w.Foo * math.Pow(f1.Faa - f2.Faa,2 ) // Mock values, to be changed when final characteristic decided
	
	return math.Sqrt(sum) 
}

func FindMostSimilar(targetFeatures Features, earthRegions []Region, filter string)(Region, float64){

	

	weights := GetWeights(filter)
	
	var bestMatches Region //TODO caping bestMatches to 1 rn, change for a queue to have 3 options of matches 
	minDistance := math.MaxFloat64 

	for _, region := range earthRegions{
		dist := WeightedEuclideanDistance(targetFeatures, region.Features, weights)
		if dist < minDistance {
			minDistance = dist 
			bestMatches = region
		}
	}
	
	return bestMatches, minDistance

}
