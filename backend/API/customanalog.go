package API

// Endpoints for user-supplied data (the API view of the frontend):
//
//	GET  /api/missions       → weight model: categories, predefined missions and KNN dimensions
//	POST /api/analog/custom  → closest Earth analogs of the user's own region(s)
//
// POST body: the two JSON files the user drops in the frontend, verbatim:
//
//	{
//	  "characteristics": <region JSON>,
//	  "mission":         <mission JSON>
//	}
//
// characteristics: same schema as data/moon.json — either { "regions": [ {...}, ... ] } or a
// single region object { "regionId", "name", "coordinates", "coreVariables", "auditVariables" }.
// Any variable may be omitted or null: KNN treats it as missing data (see knn.WeightedDistance).
//
// mission: a predefined mission ("mobility" or { "mission": "mobility" }), or a custom demand
// profile over the weight-model categories:
//
//	{ "name": "My mission", "profile": { "GEO": 0.4, "MEC": 0.3, "VOL": 0.3 } }

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

const (
	maxCustomBody    = 1 << 20 // 1 MiB: both JSON files together
	maxCustomRegions = 20
	maxNameLen       = 120
)

type customRequest struct {
	Characteristics json.RawMessage `json:"characteristics"`
	Mission         json.RawMessage `json:"mission"`
}

type customMission struct {
	Mission string             `json:"mission"` // predefined mission name
	Name    string             `json:"name"`    // label of a custom profile
	Profile map[string]float64 `json:"profile"` // custom demand per category
}

type customResult struct {
	SelectedRegion jsonParser.Region `json:"selectedRegion"`
	Matches        []MatchResponse   `json:"matches"`
	Extrapolation  knn.Extrapolation `json:"extrapolation"` // variables outside every Earth site's range
	DataCoverage   float64           `json:"dataCoverage"`  // fraction of the mission weight the region has data for
}

// dataCoverage: share of the mission weight on the variables the user filled in
func dataCoverage(target knn.Candidate, w knn.Vector) float64 {
	total, obs := 0.0, 0.0
	for i, wi := range w {
		total += wi
		if !math.IsNaN(target.Vector[i]) {
			obs += wi
		}
	}
	if total == 0 {
		return 0
	}
	return obs / total
}

type customResponse struct {
	Mission knn.WeightReport `json:"mission"`
	Results []customResult   `json:"results"`
}

// badRequest: a validation error whose message is safe to show to the user
type badRequest struct{ msg string }

func (e badRequest) Error() string { return e.msg }

func badf(format string, args ...any) error { return badRequest{fmt.Sprintf(format, args...)} }

// decodeStrict rejects unknown fields so a typo in a variable name is reported instead of
// silently becoming missing data
func decodeStrict(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("unexpected data after the JSON value")
	}
	return nil
}

func parseRegions(raw json.RawMessage) ([]jsonParser.Region, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, badf("characteristics: missing")
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, badf("characteristics: must be a JSON object")
	}

	var regions []jsonParser.Region
	if _, ok := probe["regions"]; ok {
		var info jsonParser.PlanetInformation
		if err := decodeStrict(raw, &info); err != nil {
			return nil, badf("characteristics: %v", err)
		}
		regions = info.Regions
	} else {
		var region jsonParser.Region
		if err := decodeStrict(raw, &region); err != nil {
			return nil, badf("characteristics: %v", err)
		}
		regions = []jsonParser.Region{region}
	}

	if len(regions) == 0 {
		return nil, badf("characteristics: no regions")
	}
	if len(regions) > maxCustomRegions {
		return nil, badf("characteristics: at most %d regions per request", maxCustomRegions)
	}
	seen := map[string]bool{}
	for i := range regions {
		if err := validateRegion(&regions[i], i); err != nil {
			return nil, err
		}
		if seen[regions[i].RegionId] {
			return nil, badf("characteristics: duplicated regionId %q", regions[i].RegionId)
		}
		seen[regions[i].RegionId] = true
	}
	return regions, nil
}

func validateRegion(r *jsonParser.Region, index int) error {
	label := fmt.Sprintf("region %d", index+1)

	if strings.TrimSpace(r.RegionId) == "" {
		r.RegionId = fmt.Sprintf("USER-%03d", index+1)
	} else {
		id, err := jsonParser.SanitizeRegionID(r.RegionId)
		if err != nil {
			return badf("%s: regionId may only contain letters, digits, '-' and '_' (max 64)", label)
		}
		r.RegionId = id
	}
	label = r.RegionId

	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" {
		r.Name = r.RegionId
	}
	if len([]rune(r.Name)) > maxNameLen {
		return badf("%s: name longer than %d characters", label, maxNameLen)
	}

	lat, lon := r.Coords.Latitude, r.Coords.Longitude
	if math.IsNaN(lat) || lat < -90 || lat > 90 || math.IsNaN(lon) || lon < -180 || lon > 360 {
		return badf("%s: coordinates out of range (latitude −90…90, longitude −180…360)", label)
	}

	vec, err := knn.ToVector(*r)
	if err != nil {
		return badf("%s: %v", label, err)
	}
	for _, x := range vec {
		if !math.IsNaN(x) {
			return nil
		}
	}
	return badf("%s: no variables — fill in coreVariables and/or auditVariables", label)
}

func parseMission(raw json.RawMessage) (knn.Vector, knn.WeightReport, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, knn.WeightReport{}, badf("mission: missing")
	}
	names := knn.FeatureNames()
	known := strings.Join(knn.MissionNames(), ", ")

	var m customMission
	var asName string
	if err := json.Unmarshal(raw, &asName); err == nil {
		m.Mission = asName
	} else if err := decodeStrict(raw, &m); err != nil {
		return nil, knn.WeightReport{}, badf("mission: %v", err)
	}

	switch {
	case m.Mission != "" && m.Profile != nil:
		return nil, knn.WeightReport{}, badf("mission: use either \"mission\" or \"profile\", not both")

	case m.Mission != "":
		name := strings.ToLower(strings.TrimSpace(m.Mission))
		rep, ok := knn.MissionReport(name)
		if !ok {
			return nil, knn.WeightReport{}, badf("mission: unknown mission %q (available: %s)", m.Mission, known)
		}
		w, err := knn.WeightsFor(name, names)
		if err != nil {
			return nil, knn.WeightReport{}, err
		}
		return w, rep, nil

	case m.Profile != nil:
		w, rep, err := knn.WeightsForProfile(m.Profile, names)
		if err != nil {
			return nil, knn.WeightReport{}, badf("mission profile: %v (categories: %s)", err, strings.Join(knn.Categories, ", "))
		}
		rep.Mission = strings.TrimSpace(m.Name)
		if rep.Mission == "" {
			rep.Mission = "custom"
		}
		if len([]rune(rep.Mission)) > maxNameLen {
			return nil, knn.WeightReport{}, badf("mission: name longer than %d characters", maxNameLen)
		}
		return w, rep, nil
	}
	return nil, knn.WeightReport{}, badf("mission: give \"mission\" (%s) or a \"profile\"", known)
}

// POST /api/analog/custom
// CustomAnalog: POST /api/analog/custom.
func (s *Server) CustomAnalog(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCustomBody))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			WriteError(w, http.StatusRequestEntityTooLarge, "request larger than 1 MB")
		} else {
			WriteError(w, http.StatusBadRequest, "could not read the request body")
		}
		return
	}
	var req customRequest
	if err := decodeStrict(body, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "body must be { \"characteristics\": {...}, \"mission\": {...} }: "+err.Error())
		return
	}

	regions, err := parseRegions(req.Characteristics)
	if err != nil {
		WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	weights, report, err := parseMission(req.Mission)
	if err != nil {
		var bad badRequest
		if errors.As(err, &bad) {
			WriteError(w, http.StatusBadRequest, err.Error())
		} else {
			log.Printf("custom mission weights: %v", err)
			WriteError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}

	earth, err := s.Parser.GetEarthRegions()
	if err != nil {
		log.Printf("reading earth.json: %v", err)
		WriteError(w, http.StatusInternalServerError, "internal error")
		return
	}
	byID := make(map[string]jsonParser.Region, len(earth))
	for _, e := range earth {
		byID[e.RegionId] = e
	}

	resp := customResponse{Mission: report, Results: make([]customResult, 0, len(regions))}
	for _, region := range regions {
		target, pool, stats, err := knn.PrepareWithStats(region, earth)
		if err != nil {
			WriteError(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		coverage := dataCoverage(target, weights)
		if coverage == 0 {
			WriteError(w, http.StatusUnprocessableEntity, fmt.Sprintf(
				"%s: none of its variables count for mission %q — add variables the mission weights", region.RegionId, report.Mission))
			return
		}
		matches, err := knn.FindMostSimilar(target, pool, weights, TopK)
		if err != nil {
			log.Printf("custom knn: %v", err)
			WriteError(w, http.StatusInternalServerError, "internal error")
			return
		}
		extrap, err := knn.CheckExtrapolation(region, earth, weights)
		if err != nil {
			log.Printf("custom extrapolation: %v", err)
			WriteError(w, http.StatusInternalServerError, "internal error")
			return
		}
		candByID := make(map[string]knn.Candidate, len(pool))
		for _, c := range pool {
			candByID[c.ID] = c
		}
		result := customResult{SelectedRegion: region, Extrapolation: extrap, DataCoverage: coverage}
		for _, m := range matches {
			// Desglose por variable, como en GET /api/analog (columna Match de la comparativa)
			features, err := knn.CompareFeatures(region, byID[m.RegionID], target, candByID[m.RegionID], stats, weights)
			if err != nil {
				log.Printf("custom breakdown %s: %v", m.RegionID, err)
				WriteError(w, http.StatusInternalServerError, "internal error")
				return
			}
			result.Matches = append(result.Matches, MatchResponse{Match: m, Region: RegionView{byID[m.RegionID], "builtin"}, Features: features})
		}
		resp.Results = append(resp.Results, result)
	}
	WriteJSON(w, http.StatusOK, resp)
}

// Missions: GET /api/missions.
func Missions(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{
		"categories": knn.Categories,
		"missions":   knn.MissionReports(),
		"variables":  knn.FeatureNames(),
	})
}

// Filters: GET /api/filters → weights of each mission (F1 affinity, F2′ weight, N_ef, angle).
func Filters(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, knn.MissionReports())
}
