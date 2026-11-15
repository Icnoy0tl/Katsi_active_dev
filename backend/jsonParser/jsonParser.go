package jsonParser

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Coordinates struct{
	Latitude	float64	`json:"latitude"`
	Longiude 	float64 `json:"longitude"`
}

type CoreVariables struct {
	Slope					float64	`json:"slope"`
	RadarRoughness			float64	`json:"radar_roughness"`
	ApparentThermalInertia	int64	`json:"apparent_thermal_inertia"`
	SoilMoisture			float64	`json:"soil_moisture"`
	VisualTexture			float64	`json:"visual/_texture"`
	LowSunShadows			int64	`json:"low_sun_shadows"`
	LineOfSight				int64	`json:"line_of_sight"`
	DiurnalThermalRange		int64	`json:"diurnal_thermal_range"`
	DustAerosols			float64	`json:"dust_aerosols"`
	Insolation				int64	`json:"insolation"`

}

type AuditVariables struct {
	RockAbundancePct	int64
	GrainSizeUm			int64
	AngleOfReposeDeg	int64
	DepthToBedrockMinM	int64
	DepthToBedrockMaxM	int64
	VrmMicrorelief		float64
	DielectrictConstant	float64
	SalinityWtPct		float64
	DiffuseRatio		float64
	Elbedo				float64
	VegetationNvdi		float64
	SurfacePressureKpa	float64
	WindTypicalMs		int64
	WindGustMs			int64
	AbrasiveMohs		float64
}

type Region struct {
	
	RegionId		string				`json:"regionId"`
	Name			string 				`json:"name"`	
	Coords			Coordinates 		`json:"coordinates"`
	CoreVariables 	CoreVariables		`json:"coreVariables"`
	AuditVariables 	AuditVariables		`json:"auditVariables"`

}

type PlanetInformation struct { //Only parses the database of the selected planet
	Regions []Region `json:"regions"`
}



func parseJson(filename string) (PlanetInformation, error){

	baseDir := "backend/data/" // TODO dont think this is the right file path
	path := filepath.Join(baseDir, filename)
	
	file , err := os.ReadFile(path)

	if err != nil {
		fmt.Println("Error while opening the file", err)
		return PlanetInformation{}, errors.New("Error opening the file")
	}	
		
	var data PlanetInformation

	err = json.Unmarshal(file, &data)

		if err != nil {
		fmt.Println("Error while reading the file", err)
		return PlanetInformation{}, errors.New("Error reading from file")
	}	
	
	return data, nil

}