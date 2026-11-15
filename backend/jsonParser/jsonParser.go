package jsonParser

import (
	"encoding/json"
	"fmt"
)

type FallbackFloat float64

func (F *FallbackFloat) UnmarshalJSON(Data []byte) error {
	if string(Data) == "null" {
		*F = 0.1
		return nil
	}

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
