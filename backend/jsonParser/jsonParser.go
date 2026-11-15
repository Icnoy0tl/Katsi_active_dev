package jsonParser

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Coordinates struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// Variables as *float64: a field missing (or null) in the JSON stays nil and KNN treats it as
// missing data (weight renormalized over the observed ones, see knn.WeightedDistance)
// instead of a fake 0.
// Every variable is *float64: JSON null (or a missing key) means "no data" and stays nil,
// instead of silently becoming 0. knn turns nil into NaN and treats it as missing (coverage).
type CoreVariables struct {
	Slope                  *float64 `json:"slope"`
	RadarRoughness         *float64 `json:"radar_roughness"`
	ApparentThermalInertia *float64 `json:"apparent_thermal_inertia"`
	SoilMoisture           *float64 `json:"soil_moisture"`
	VisualTexture          *float64 `json:"visual_texture"`
	LowSunShadows          *float64 `json:"low_sun_shadows"`
	LineOfSight            *float64 `json:"line_of_sight"`
	DiurnalThermalRange    *float64 `json:"diurnal_thermal_range"`
	DustAerosols           *float64 `json:"dust_aerosols"`
	Insolation             *float64 `json:"insolation"`
}

type AuditVariables struct {
	RockAbundancePct   *float64 `json:"rock_abundance_pct"`
	GrainSizeUm        *float64 `json:"grain_size_um"`
	AngleOfReposeDeg   *float64 `json:"angle_of_repose_deg"`
	DepthToBedrockMinM *float64 `json:"depth_to_bedrock_min_m"`
	DepthToBedrockMaxM *float64 `json:"depth_to_bedrock_max_m"`
	VrmMicrorelief     *float64 `json:"vrm_microrelief"`
	DielectricConstant *float64 `json:"dielectric_constant"`
	SalinityWtPct      *float64 `json:"salinity_wt_pct"`
	DiffuseRatio       *float64 `json:"diffuse_ratio"`
	Albedo             *float64 `json:"albedo"`
	VegetationNdvi     *float64 `json:"vegetation_ndvi"`
	SurfacePressureKpa *float64 `json:"surface_pressure_kpa"`
	WindTypicalMs      *float64 `json:"wind_typical_ms"`
	WindGustMs         *float64 `json:"wind_gust_ms"`
	AbrasiveMohs       *float64 `json:"abrasive_mohs"`
	GroundIceIndex     *float64 `json:"ground_ice_index"` // 1 low, 2 medium, 3 high; null = no data
}

type Region struct {
	RegionId       string         `json:"regionId"`
	Name           string         `json:"name"`
	Coords         Coordinates    `json:"coordinates"`
	CoreVariables  CoreVariables  `json:"coreVariables"`
	AuditVariables AuditVariables `json:"auditVariables"`

	// CustomVariables: values of user-defined variables (--own-regions), by name.
	CustomVariables map[string]*float64 `json:"customVariables,omitempty"`
}

type PlanetInformation struct {
	Planet  string   `json:"planet"`
	Regions []Region `json:"regions"`
}

var (
	ErrInvalidPlanet   = errors.New("Planet Not valid")
	ErrInvalidRegionID = errors.New("RegionId not valid")
	ErrRegionNotFound  = errors.New("Region not found")
)

// Allowed/available planets from the frontend
var planetFiles = map[string]string{
	"moon": "moon.json",
	"mars": "mars.json",
}

const earthFile = "earth.json"

var (
	planetNameRe = regexp.MustCompile(`^[a-z]{1,16}$`)
	regionIDRe   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// SanitizePlanet normalize and validates planet name
func SanitizePlanet(raw string) (string, error) {
	p := strings.ToLower(strings.TrimSpace(raw))
	if !planetNameRe.MatchString(p) {
		return "", ErrInvalidPlanet
	}
	if _, ok := planetFiles[p]; !ok {
		return "", ErrInvalidPlanet
	}
	return p, nil
}

func SanitizeRegionID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if !regionIDRe.MatchString(id) {
		return "", ErrInvalidRegionID
	}
	return id, nil
}

type Parser struct {
	dataDir string
}

// constructor of the parser, checks for the data directory
func New(dataDir string) (*Parser, error) {
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("Error looking for datadir: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("dataDir %q does NOT exist", abs)
	}
	return &Parser{dataDir: abs}, nil
}

// Sanitization function, filename can only come from constants in here, never accept arbitrary filenames from userr
func (p *Parser) readFile(filename string) ([]Region, error) {
	path := filepath.Join(p.dataDir, filename)

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("abriendo %s: %w", filename, err)
	}

	var data PlanetInformation
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("parseando %s: %w", filename, err)
	}
	return data.Regions, nil
}

// GetRegion returns PlanetInformation with justONE specific region consulted.
func (p *Parser) GetRegion(planet, regionID string) (PlanetInformation, error) {
	planet, err := SanitizePlanet(planet)
	if err != nil {
		return PlanetInformation{}, err
	}
	regionID, err = SanitizeRegionID(regionID)
	if err != nil {
		return PlanetInformation{}, err
	}

	regions, err := p.readFile(planetFiles[planet])
	if err != nil {
		return PlanetInformation{}, err
	}

	for _, r := range regions {
		if r.RegionId == regionID {
			return PlanetInformation{Planet: planet, Regions: []Region{r}}, nil
		}
	}
	return PlanetInformation{}, ErrRegionNotFound
}

// GetPlanetRegions returns every region of the Moon or Mars (the planet is sanitized).
func (p *Parser) GetPlanetRegions(planet string) (PlanetInformation, error) {
	planet, err := SanitizePlanet(planet)
	if err != nil {
		return PlanetInformation{}, err
	}
	regions, err := p.readFile(planetFiles[planet])
	if err != nil {
		return PlanetInformation{}, err
	}
	return PlanetInformation{Planet: planet, Regions: regions}, nil
}

// GetEarthRegions returns the whole planet region pool to procces using knn
//TODO maybe if needed we can just make this one a generic function to get the information of a whole planet 
// GetRegions returns every built-in region of a body: "moon", "mars" or "earth".
func (p *Parser) GetRegions(planet string) ([]Region, error) {
	planet = strings.ToLower(strings.TrimSpace(planet))
	if planet == "earth" {
		return p.readFile(earthFile)
	}
	planet, err := SanitizePlanet(planet)
	if err != nil {
		return nil, err
	}
	return p.readFile(planetFiles[planet])
}

// GetEarthRegions returns the whole Earth region pool to process using knn
func (p *Parser) GetEarthRegions() ([]Region, error) {
	regions, err := p.readFile(earthFile)
	if err != nil {
		return nil, err
	}
	if len(regions) == 0 {
		return nil, errors.New("earth.json no tiene regiones")
	}
	return regions, nil
}
