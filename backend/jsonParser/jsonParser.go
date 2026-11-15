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

	var Value float64
	if err := json.Unmarshal(Data, &Value); err != nil {
		return err
	}
	*F = FallbackFloat(Value)
	return nil
}

type PlanetDataset struct {
	Regions []Region `json:"regions"`
}

type Region struct {
	RegionID       string         `json:"regionId"`
	Name           string         `json:"name"`
	Coordinates    Coordinates    `json:"coordinates"`
	CoreVariables  CoreVariables  `json:"coreVariables"`
	AuditVariables AuditVariables `json:"auditVariables"`
}

type Coordinates struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type CoreVariables struct {
	Slope                  FallbackFloat `json:"slope"`
	RadarRoughness         FallbackFloat `json:"radar_roughness"`
	ApparentThermalInertia FallbackFloat `json:"apparent_thermal_inertia"`
	SoilMoisture           FallbackFloat `json:"soil_moisture"`
	VisualTexture          FallbackFloat `json:"visual_texture"`
	LowSunShadows          FallbackFloat `json:"low_sun_shadows"`
	LineOfSight            FallbackFloat `json:"line_of_sight"`
	DiurnalThermalRange    FallbackFloat `json:"diurnal_thermal_range"`
	DustAerosols           FallbackFloat `json:"dust_aerosols"`
	Insolation             FallbackFloat `json:"insolation"`
}

type AuditVariables struct {
	RockAbundancePct   FallbackFloat `json:"rock_abundance_pct"`
	GrainSizeUm        FallbackFloat `json:"grain_size_um"`
	AngleOfReposeDeg   FallbackFloat `json:"angle_of_repose_deg"`
	DepthToBedrockMinM FallbackFloat `json:"depth_to_bedrock_min_m"`
	DepthToBedrockMaxM FallbackFloat `json:"depth_to_bedrock_max_m"`
	VrmMicrorelief     FallbackFloat `json:"vrm_microrelief"`
	DielectricConstant FallbackFloat `json:"dielectric_constant"`
	SalinityWtPct      FallbackFloat `json:"salinity_wt_pct"`
	DiffuseRatio       FallbackFloat `json:"diffuse_ratio"`
	Albedo             FallbackFloat `json:"albedo"`
	VegetationNdvi     FallbackFloat `json:"vegetation_ndvi"`
	SurfacePressureKpa FallbackFloat `json:"surface_pressure_kpa"`
	WindTypicalMs      FallbackFloat `json:"wind_typical_ms"`
	WindGustMs         FallbackFloat `json:"wind_gust_ms"`
	AbrasiveMohs       FallbackFloat `json:"abrasive_mohs"`
}

func Parser(RawData []byte) ([]Region, error) {
	var Dataset PlanetDataset

	err := json.Unmarshal(RawData, &Dataset)
	if err != nil {
		return nil, fmt.Errorf("error parsing regions JSON: %w", err)
	}

	return Dataset.Regions, nil
}

func (R Region) GetKNNVector() []float64 {
	C := R.CoreVariables
	return []float64{
		float64(C.Slope),
		float64(C.RadarRoughness),
		float64(C.ApparentThermalInertia),
		float64(C.SoilMoisture),
		float64(C.VisualTexture),
		float64(C.LowSunShadows),
		float64(C.LineOfSight),
		float64(C.DiurnalThermalRange),
		float64(C.DustAerosols),
		float64(C.Insolation),
	}
}
