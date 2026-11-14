package main

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
