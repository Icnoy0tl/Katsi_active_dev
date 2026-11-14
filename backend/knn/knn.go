package knn

import (
	"errors"
	"math"
)

type RecentStack[T any] struct {
	
	items []T
	limit int

}

func NewRecentStack[T any](limit int) *RecentStack[T]{
	return &RecentStack[T]{
		items: make([]T, 0, limit),
		limit: limit,
	}
}

func (stack *RecentStack[T]) Push (item T){
	if len(stack.items) == stack.limit {
		copy(stack.items, stack.items[1:])
		stack.items[stack.limit-1] = item
		return 
	}

	stack.items = append(stack.items, item)

}

func (stack *RecentStack[T]) Pop() (T,error){
	var zero T
	if len(stack.items) == 0 {
		return zero, errors.New("buffer's empty")
	}

	lastIdx := len(stack.items) - 1
	item := stack.items[lastIdx]
	stack.items[lastIdx] = zero // Clear reference for garbage collector
	stack.items = stack.items[:lastIdx]
	return item, nil
}

//shows the latest value without deleting it
func (stack *RecentStack[T]) peek() (T, error){
	var zero T
	if len(stack.items) == 0 {
		return zero, errors.New("Buffers empty")
	}

	return stack.items[len(stack.items) - 1], nil

}


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
