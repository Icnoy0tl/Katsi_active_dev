package jsonParser

import (
	"encoding/json"
	"fmt"
)

type FloatConFallback float64

func (f *FloatConFallback) UnmarshalJSON(data []byte) error {

	if string(data) == "null" {
		*f = 0.1
		return nil
	}

	var valor float64
	if err := json.Unmarshal(data, &valor); err != nil {
		return err
	}
	*f = FloatConFallback(valor)
	return nil
}

type DatasetPlaneta struct {
	Regions []Region `json:"regions"`
}

type Region struct {
	RegionID       string         `json:"regionId"`
	Name           string         `json:"name"`
	Coordinates    Coordenadas    `json:"coordinates"`
	CoreVariables  CoreVariables  `json:"coreVariables"`
	AuditVariables AuditVariables `json:"auditVariables"`
}

type Coordenadas struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type CoreVariables struct {
	Slope                  FloatConFallback `json:"slope"`
	RadarRoughness         FloatConFallback `json:"radar_roughness"`
	ApparentThermalInertia FloatConFallback `json:"apparent_thermal_inertia"`
	SoilMoisture           FloatConFallback `json:"soil_moisture"`
	VisualTexture          FloatConFallback `json:"visual_texture"`
	LowSunShadows          FloatConFallback `json:"low_sun_shadows"`
	LineOfSight            FloatConFallback `json:"line_of_sight"`
	DiurnalThermalRange    FloatConFallback `json:"diurnal_thermal_range"`
	DustAerosols           FloatConFallback `json:"dust_aerosols"`
	Insolation             FloatConFallback `json:"insolation"`
}

type AuditVariables struct {
	RockAbundancePct   FloatConFallback `json:"rock_abundance_pct"`
	GrainSizeUm        FloatConFallback `json:"grain_size_um"`
	AngleOfReposeDeg   FloatConFallback `json:"angle_of_repose_deg"`
	DepthToBedrockMinM FloatConFallback `json:"depth_to_bedrock_min_m"`
	DepthToBedrockMaxM FloatConFallback `json:"depth_to_bedrock_max_m"`
	VrmMicrorelief     FloatConFallback `json:"vrm_microrelief"`
	DielectricConstant FloatConFallback `json:"dielectric_constant"`
	SalinityWtPct      FloatConFallback `json:"salinity_wt_pct"`
	DiffuseRatio       FloatConFallback `json:"diffuse_ratio"`
	Albedo             FloatConFallback `json:"albedo"`
	VegetationNdvi     FloatConFallback `json:"vegetation_ndvi"`
	SurfacePressureKpa FloatConFallback `json:"surface_pressure_kpa"`
	WindTypicalMs      FloatConFallback `json:"wind_typical_ms"`
	WindGustMs         FloatConFallback `json:"wind_gust_ms"`
	AbrasiveMohs       FloatConFallback `json:"abrasive_mohs"`
}

func Parser(datosCrudos []byte) ([]Region, error) {
	var dataset DatasetPlaneta

	err := json.Unmarshal(datosCrudos, &dataset)
	if err != nil {
		return nil, fmt.Errorf("error al parsear el JSON de regiones: %w", err)
	}

	return dataset.Regions, nil
}

func (r Region) ObtenerVectorKNN() []float64 {
	c := r.CoreVariables
	return []float64{
		float64(c.Slope),
		float64(c.RadarRoughness),
		float64(c.ApparentThermalInertia),
		float64(c.SoilMoisture),
		float64(c.VisualTexture),
		float64(c.LowSunShadows),
		float64(c.LineOfSight),
		float64(c.DiurnalThermalRange),
		float64(c.DustAerosols),
		float64(c.Insolation),
	}
}
