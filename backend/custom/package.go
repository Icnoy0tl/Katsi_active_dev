package custom

// Package custom: user-uploaded regions, variables and missions (--own-regions).
//
// The user uploads two JSON files:
//
//   - regions file  → POST /api/custom/regions
//     {"planet": "mars", "variables": [...], "regions": [...]}
//     Regions have the same shape as data/*.json plus an optional "planet" per
//     region (moon | mars | earth; default: the top-level "planet") and an optional
//     "customVariables" object. Mars/Moon regions become new targets; Earth regions
//     join the analog catalog. "variables" defines new variables and their type.
//
//   - missions file → POST /api/custom/missions
//     {"missions": [{"id": "cubesat_unam", "name": "...", "demand": {"ENE": .4, ...}}]}
//
// Each upload REPLACES the previous one of its kind (re-uploading an edited file is
// idempotent). Everything lives in memory: nothing is written to disk and a restart
// clears it. Validation collects every error with its JSON path.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strings"
	"sync"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

// Limits of one upload.
const (
	MaxRegions  = 1000
	MaxMissions = 50
	MaxNameLen  = 120
	MaxDescLen  = 1000
)

// Planets a custom region can belong to (the frontend has a 3D body for each).
var Planets = []string{"earth", "mars", "moon"}

var (
	regionIDRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	missionIDRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,47}$`)
)

// ---------------------------------------------------------------- file formats

type RegionsFile struct {
	Planet    string               `json:"planet,omitempty"`
	Variables []knn.CustomVariable `json:"variables,omitempty"`
	Regions   []UploadRegion       `json:"regions"`
}

type UploadRegion struct {
	Planet          string                    `json:"planet,omitempty"`
	RegionId        string                    `json:"regionId"`
	Name            string                    `json:"name"`
	Coordinates     *UploadCoordinates        `json:"coordinates"`
	CoreVariables   jsonParser.CoreVariables  `json:"coreVariables"`
	AuditVariables  jsonParser.AuditVariables `json:"auditVariables"`
	CustomVariables map[string]*float64       `json:"customVariables,omitempty"`
}

type UploadCoordinates struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
}

type Mission struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Demand      map[string]float64 `json:"demand"`
}

type MissionsFile struct {
	Missions []Mission `json:"missions"`
}

// ---------------------------------------------------------------- errors

// FieldError: one problem in an uploaded file, located by its JSON path.
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidationError: every problem found in one upload.
type ValidationError struct {
	Errors []FieldError
}

func (e *ValidationError) Error() string {
	parts := make([]string, len(e.Errors))
	for i, fe := range e.Errors {
		parts[i] = fe.Path + ": " + fe.Message
	}
	return strings.Join(parts, "; ")
}

type collector struct{ errs []FieldError }

func (c *collector) add(path, format string, args ...any) {
	c.errs = append(c.errs, FieldError{Path: path, Message: fmt.Sprintf(format, args...)})
}

func (c *collector) err() error {
	if len(c.errs) == 0 {
		return nil
	}
	return &ValidationError{Errors: c.errs}
}

// decodeStrict: exactly one JSON value, unknown fields rejected (a typo such as
// "slpoe" must fail instead of silently becoming "no data").
func decodeStrict(r io.Reader, v any) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return &ValidationError{Errors: []FieldError{{Path: "$", Message: "invalid JSON: " + err.Error()}}}
	}
	if dec.More() {
		return &ValidationError{Errors: []FieldError{{Path: "$", Message: "invalid JSON: more than one value"}}}
	}
	return nil
}

// ---------------------------------------------------------------- regions

// RegionSet: a validated regions file, ready for the KNN.
type RegionSet struct {
	Model    *knn.Model                     // built-in + custom variables
	ByPlanet map[string][]jsonParser.Region // custom regions per planet
	Warnings []string
}

// ParseRegions validates a regions file. builtinIDs[planet] holds the region IDs
// already shipped with the app (a custom region may not reuse them).
func ParseRegions(r io.Reader, builtinIDs map[string]map[string]bool) (*RegionSet, error) {
	var f RegionsFile
	if err := decodeStrict(r, &f); err != nil {
		return nil, err
	}
	c := &collector{}

	model, err := knn.NewModel(f.Variables)
	if err != nil {
		c.add("variables", "%v", err)
		return nil, c.err() // without a valid model the regions cannot be checked
	}

	okPlanet := map[string]bool{}
	for _, p := range Planets {
		okPlanet[p] = true
	}
	if f.Planet != "" && !okPlanet[f.Planet] {
		c.add("planet", "%q: must be one of %v", f.Planet, Planets)
	}
	if len(f.Regions) == 0 {
		c.add("regions", "no regions")
	}
	if len(f.Regions) > MaxRegions {
		c.add("regions", "%d regions, max %d", len(f.Regions), MaxRegions)
		return nil, c.err()
	}

	set := &RegionSet{Model: model, ByPlanet: map[string][]jsonParser.Region{}}
	seen := map[string]map[string]bool{}
	valuesPerVar := map[string]map[string]int{} // custom variable → planet → regions with a value

	for i, u := range f.Regions {
		path := fmt.Sprintf("regions[%d]", i)
		planet := u.Planet
		if planet == "" {
			planet = f.Planet
		}
		switch {
		case planet == "":
			c.add(path+".planet", "missing (set it here or at the top level)")
		case !okPlanet[planet]:
			c.add(path+".planet", "%q: must be one of %v", planet, Planets)
		}

		id := strings.TrimSpace(u.RegionId)
		switch {
		case !regionIDRe.MatchString(id):
			c.add(path+".regionId", "%q: use 1-64 letters, digits, - or _", u.RegionId)
		case builtinIDs[planet][id]:
			c.add(path+".regionId", "%q already exists in the built-in %s regions", id, planet)
		case seen[planet][id]:
			c.add(path+".regionId", "%q is repeated", id)
		}
		if seen[planet] == nil {
			seen[planet] = map[string]bool{}
		}
		seen[planet][id] = true

		name := strings.TrimSpace(u.Name)
		if name == "" || len(name) > MaxNameLen {
			c.add(path+".name", "required, max %d characters", MaxNameLen)
		}

		var coords jsonParser.Coordinates
		switch {
		case u.Coordinates == nil || u.Coordinates.Latitude == nil || u.Coordinates.Longitude == nil:
			c.add(path+".coordinates", "latitude and longitude are required")
		case math.Abs(*u.Coordinates.Latitude) > 90:
			c.add(path+".coordinates.latitude", "%v: must be in [-90, 90]", *u.Coordinates.Latitude)
		case math.Abs(*u.Coordinates.Longitude) > 180:
			c.add(path+".coordinates.longitude", "%v: must be in [-180, 180]", *u.Coordinates.Longitude)
		default:
			coords = jsonParser.Coordinates{Latitude: *u.Coordinates.Latitude, Longitude: *u.Coordinates.Longitude}
		}

		for _, k := range sortedKeys(u.CustomVariables) {
			if !model.IsCustomVariable(k) {
				c.add(path+".customVariables."+k, "not defined in \"variables\"")
				continue
			}
			if u.CustomVariables[k] != nil {
				if valuesPerVar[k] == nil {
					valuesPerVar[k] = map[string]int{}
				}
				valuesPerVar[k][planet]++
			}
		}

		region := jsonParser.Region{
			RegionId: id, Name: name, Coords: coords,
			CoreVariables: u.CoreVariables, AuditVariables: u.AuditVariables,
			CustomVariables: u.CustomVariables,
		}
		vec, err := model.ToVector(region)
		if err != nil {
			c.add(path, "%v", err)
		} else if !hasData(vec) {
			c.add(path, "every variable is null: the region cannot be compared")
		}
		set.ByPlanet[planet] = append(set.ByPlanet[planet], region)
	}

	for _, cv := range model.CustomVariables() {
		counts := valuesPerVar[cv.Name]
		switch {
		case len(counts) == 0:
			set.Warnings = append(set.Warnings, fmt.Sprintf("variable %q has no values in any region", cv.Name))
		case counts["earth"] == 0:
			set.Warnings = append(set.Warnings, fmt.Sprintf(
				"variable %q has no values in Earth regions: no analog can be compared on it, so it only lowers coverage", cv.Name))
		}
	}
	if err := c.err(); err != nil {
		return nil, err
	}
	return set, nil
}

func hasData(v knn.Vector) bool {
	for _, x := range v {
		if !math.IsNaN(x) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- missions

// ParseMissions validates a missions file. Built-in mission IDs cannot be reused.
func ParseMissions(r io.Reader) (map[string]Mission, error) {
	var f MissionsFile
	if err := decodeStrict(r, &f); err != nil {
		return nil, err
	}
	c := &collector{}
	if len(f.Missions) == 0 {
		c.add("missions", "no missions")
	}
	if len(f.Missions) > MaxMissions {
		c.add("missions", "%d missions, max %d", len(f.Missions), MaxMissions)
		return nil, c.err()
	}
	out := make(map[string]Mission, len(f.Missions))
	for i, m := range f.Missions {
		path := fmt.Sprintf("missions[%d]", i)
		m.ID = strings.TrimSpace(m.ID)
		m.Name = strings.TrimSpace(m.Name)
		switch {
		case !missionIDRe.MatchString(m.ID):
			c.add(path+".id", "%q: lowercase letters, digits and _ (max 48), starting with a letter", m.ID)
		case knn.Missions[m.ID] != nil:
			c.add(path+".id", "%q is a built-in mission", m.ID)
		case out[m.ID].ID != "":
			c.add(path+".id", "%q is repeated", m.ID)
		}
		if m.Name == "" || len(m.Name) > MaxNameLen {
			c.add(path+".name", "required, max %d characters", MaxNameLen)
		}
		if len(m.Description) > MaxDescLen {
			c.add(path+".description", "max %d characters", MaxDescLen)
		}
		if err := knn.ValidateProfile(m.Demand); err != nil {
			c.add(path+".demand", "%v (categories: %v)", err, knn.Categories)
		}
		out[m.ID] = m
	}
	if err := c.err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------- store

// Snapshot: an immutable view of the custom data. Uploads replace the snapshot
// instead of mutating it, so a request can use it without holding the lock.
type Snapshot struct {
	Model    *knn.Model
	Regions  map[string][]jsonParser.Region
	Missions map[string]Mission
	Warnings []string // from the last regions upload
}

// Empty: no custom data (also what handlers use when --own-regions is off).
func Empty() Snapshot {
	return Snapshot{Model: knn.Default, Regions: map[string][]jsonParser.Region{}, Missions: map[string]Mission{}}
}

type Store struct {
	mu   sync.RWMutex
	snap Snapshot
}

func NewStore() *Store { return &Store{snap: Empty()} }

func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snap
}

func (s *Store) SetRegions(set *RegionSet) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snap = Snapshot{Model: set.Model, Regions: set.ByPlanet, Missions: s.snap.Missions, Warnings: set.Warnings}
}

func (s *Store) SetMissions(m map[string]Mission) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.snap
	next.Missions = m
	s.snap = next
}

// Clear removes every custom region, variable and mission.
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snap = Empty()
}

// ---------------------------------------------------------------- helpers

func sortedKeys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// IsValidation reports whether err is a *ValidationError and returns it.
func IsValidation(err error) (*ValidationError, bool) {
	var ve *ValidationError
	ok := errors.As(err, &ve)
	return ve, ok
}