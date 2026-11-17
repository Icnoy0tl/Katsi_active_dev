// Package API: every HTTP endpoint of the backend. main.go only wraps it
// (flags, environment, CORS, http.Server).
//
//	GET    /api/health                          204, no body (wakes the Render free plan)
//	GET    /api/status                          HTML page: message + status image
//	GET    /api/status/image                    data/status.png
//	GET    /api/catalog                         categories, variables, missions, capabilities
//	GET    /api/filters                         weight report of each built-in mission
//	GET    /api/missions                        weight model: categories, missions, KNN variables
//	GET    /api/regions?planet=&filter=         Moon/Mars terrains ranked for a mission (frontend)
//	GET    /api/regions/all?planet=             raw built-in + custom regions ({ regions: [...] })
//	GET    /api/analog?planet=&regionId=&filter= top-3 Earth analogs (frontend)
//	POST   /api/calculate                       same, JSON body (AnalogRequest)
//	POST   /api/analog/custom                   analogs of the user's own region(s), no upload
//
// Only with --own-regions (otherwise 403):
//
//	POST   /api/custom/regions                  upload the regions file (replaces)
//	POST   /api/custom/missions                 upload the missions file (replaces)
//	GET    /api/custom                          what is loaded
//	DELETE /api/custom                          clear everything
//
// Built-in and custom data go through the same function (analyze), so custom
// regions, variables and missions use exactly the tested KNN path.
package API

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"sort"
	"strings"

	"spaceapps/custom"
	"spaceapps/jsonParser"
	"spaceapps/knn"
)

const TopK = 3

// Sensitivity analysis of GET /api/analog: ±20 % on each component of the
// mission profile, 200 trials, fixed seed (reproducible).
const (
	RobustEps    = 0.20
	RobustTrials = 200
	RobustSeed   = 2026
)

// MaxUploadBytes bounds the body of an upload.
const MaxUploadBytes = 5 << 20

// Server holds the dependencies of the handlers. Custom is nil when the server
// runs without --own-regions.
type Server struct {
	Parser *jsonParser.Parser
	Custom *custom.Store
}

// Routes registers every endpoint. Errors produced by the mux itself
// (unknown route 404, wrong method 405) are also returned as JSON.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", Health)
	mux.HandleFunc("GET /api/status", Status)
	mux.HandleFunc("GET /api/status/image", s.StatusImage)
	mux.HandleFunc("GET /api/catalog", s.Catalog)
	mux.HandleFunc("GET /api/filters", Filters)
	mux.HandleFunc("GET /api/missions", Missions)
	mux.HandleFunc("GET /api/regions", s.RankedRegions)
	mux.HandleFunc("GET /api/regions/all", s.Regions)
	mux.HandleFunc("GET /api/analog", s.AnalogGET)
	mux.HandleFunc("POST /api/calculate", s.Calculate)
	mux.HandleFunc("POST /api/analog/custom", s.CustomAnalog)
	mux.HandleFunc("POST /api/custom/regions", s.ownOnly(s.UploadRegions))
	mux.HandleFunc("POST /api/custom/missions", s.ownOnly(s.UploadMissions))
	mux.HandleFunc("GET /api/custom", s.ownOnly(s.CustomState))
	mux.HandleFunc("DELETE /api/custom", s.ownOnly(s.ClearCustom))
	return jsonErrors(mux)
}

// jsonErrors rewrites the plain-text 404/405 replies of http.ServeMux as
// {"error": "..."}; handlers that already answer JSON are left untouched.
func jsonErrors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&errorRewriter{ResponseWriter: w}, r)
	})
}

type errorRewriter struct {
	http.ResponseWriter
	swallow bool
}

func (e *errorRewriter) WriteHeader(code int) {
	if (code == http.StatusNotFound || code == http.StatusMethodNotAllowed) &&
		!strings.HasPrefix(e.Header().Get("Content-Type"), "application/json") {
		e.swallow = true
		e.Header().Del("X-Content-Type-Options")
		msg := "Route not found"
		if code == http.StatusMethodNotAllowed {
			msg = "Method not allowed (allowed: " + e.Header().Get("Allow") + ")"
		}
		WriteJSON(e.ResponseWriter, code, map[string]string{"error": msg})
		return
	}
	e.ResponseWriter.WriteHeader(code)
}

func (e *errorRewriter) Write(b []byte) (int, error) {
	if e.swallow {
		return len(b), nil // drop the original plain-text body
	}
	return e.ResponseWriter.Write(b)
}

// Health: 204 with no body. The frontend calls it on load to wake the service
// (Render stops the free plan after ~15 min without traffic and takes 30–50 s to start).
func Health(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------- responses

// RegionView: a region plus where it comes from ("builtin" or "custom").
type RegionView struct {
	jsonParser.Region
	Source string `json:"source"`
}

type MissionView struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Source      string             `json:"source"`
	Demand      map[string]float64 `json:"demand"`
	Report      *knn.WeightReport  `json:"report,omitempty"`
}

type MatchResponse struct {
	knn.Match
	Region   RegionView          `json:"region"`
	Features []knn.FeatureCompat `json:"features"`
}

type AnalogResponse struct {
	Planet         string            `json:"planet"`
	Filter         string            `json:"filter"`
	Mission        *MissionView      `json:"mission"` // null = no filter (every variable weighs the same)
	SelectedRegion RegionView        `json:"selectedRegion"`
	Matches        []MatchResponse   `json:"matches"`
	Robustness     knn.Robustness    `json:"robustness"`
	Extrapolation  knn.Extrapolation `json:"extrapolation"`
}

// AnalogRequest: body of POST /api/calculate.
type AnalogRequest struct {
	Missions struct {
		Filter string `json:"filter"`
	} `json:"misiones"`
	Characteristics struct {
		Planet   string `json:"planet"`
		RegionID string `json:"regionId"`
	} `json:"caracteristicas"`
}

func WriteJSON(w http.ResponseWriter, StatusCode int, Payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(StatusCode)
	_ = json.NewEncoder(w).Encode(Payload)
}

func WriteError(w http.ResponseWriter, StatusCode int, Message string) {
	WriteJSON(w, StatusCode, map[string]string{"error": Message})
}

// apiError: an error with its HTTP status (Message is safe to show to the user).
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }

func internal(format string, args ...any) *apiError {
	log.Printf(format, args...)
	return &apiError{http.StatusInternalServerError, "Internal server error"}
}

// statusPage: HTML returned by GET /api/status (message + image).
const statusPage = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API status</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
         align-items: center; justify-content: center; gap: 1rem;
         font-family: system-ui, sans-serif; background: #0b0f1a; color: #e6e9f0; }
  h1 { margin: 0; font-size: 1.5rem; }
  img { max-width: min(447px, 90vw); height: auto; }
</style>
</head>
<body>
  <h1>Status: 200 ok</h1>
  <img src="/api/status/image" alt="API status">
</body>
</html>
`

// Endpoint 1: Status -> HTML page with "Status: 200 ok" and the status image.
func Status(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(statusPage))
}

// StatusImage: serves data/status.png (fixed filename, never taken from the request).
func (s *Server) StatusImage(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, filepath.Join(s.Parser.DataDir(), "status.png"))
}

// snapshot: custom data, or an empty snapshot without --own-regions.
func (s *Server) snapshot() custom.Snapshot {
	if s.Custom == nil {
		return custom.Empty()
	}
	return s.Custom.Snapshot()
}

// ---------------------------------------------------------------- analog

func (s *Server) AnalogGET(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.respondAnalog(w, q.Get("planet"), q.Get("regionId"), q.Get("filter"))
}

// Calculate: POST /api/calculate with an AnalogRequest body.
func (s *Server) Calculate(w http.ResponseWriter, r *http.Request) {
	var req AnalogRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := dec.Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "Invalid JSON payload: "+err.Error())
		return
	}
	s.respondAnalog(w, req.Characteristics.Planet, req.Characteristics.RegionID, req.Missions.Filter)
}

func (s *Server) respondAnalog(w http.ResponseWriter, planet, regionID, filter string) {
	resp, err := s.analyze(planet, regionID, filter)
	if err != nil {
		WriteError(w, err.Status, err.Message)
		return
	}
	WriteJSON(w, http.StatusOK, resp)
}

// analyze: the whole pipeline for one target region and one filter.
func (s *Server) analyze(planet, regionID, filter string) (AnalogResponse, *apiError) {
	snap := s.snapshot()
	model := snap.Model

	// 1. Target region: built-in first, then custom.
	planet, err := jsonParser.SanitizePlanet(planet)
	if err != nil {
		return AnalogResponse{}, &apiError{http.StatusBadRequest, "Planet must be 'moon' or 'mars'"}
	}
	regionID, err = jsonParser.SanitizeRegionID(regionID)
	if err != nil {
		return AnalogResponse{}, &apiError{http.StatusBadRequest, "Invalid regionId"}
	}
	var selected RegionView
	info, err := s.Parser.GetRegion(planet, regionID)
	switch {
	case err == nil:
		selected = RegionView{info.Regions[0], "builtin"}
	case errors.Is(err, jsonParser.ErrRegionNotFound):
		found := false
		for _, cr := range snap.Regions[planet] {
			if cr.RegionId == regionID {
				selected, found = RegionView{cr, "custom"}, true
				break
			}
		}
		if !found {
			return AnalogResponse{}, &apiError{http.StatusNotFound, "Region not found"}
		}
	default:
		return AnalogResponse{}, internal("Error reading planet data: %v", err)
	}

	// 2. Earth catalog: built-in + custom analogs.
	builtinEarth, err := s.Parser.GetEarthRegions()
	if err != nil {
		return AnalogResponse{}, internal("Error reading earth.json: %v", err)
	}
	earth := make([]RegionView, 0, len(builtinEarth)+len(snap.Regions["earth"]))
	for _, e := range builtinEarth {
		earth = append(earth, RegionView{e, "builtin"})
	}
	for _, e := range snap.Regions["earth"] {
		earth = append(earth, RegionView{e, "custom"})
	}
	pool := make([]jsonParser.Region, len(earth))
	for i := range earth {
		pool[i] = earth[i].Region
	}

	// 3. Mission weights.
	mission, profile, aerr := s.resolveMission(snap, filter)
	if aerr != nil {
		return AnalogResponse{}, aerr
	}
	weights, err := model.Weights(profile)
	if err != nil {
		return AnalogResponse{}, internal("Error computing weights for %q: %v", filter, err)
	}

	// 4. Normalization (target projected to the Earth range) + KNN.
	target, cands, stats, err := model.PrepareWithStats(selected.Region, pool)
	if err != nil {
		log.Printf("Error normalizing data: %v", err)
		return AnalogResponse{}, &apiError{http.StatusUnprocessableEntity, "Invalid region data"}
	}
	matches, err := knn.FindMostSimilar(target, cands, weights, TopK)
	if err != nil {
		return AnalogResponse{}, internal("Error running KNN: %v", err)
	}
	rob, err := model.AnalyzeRobustness(target, cands, profile, TopK, RobustEps, RobustTrials, RobustSeed)
	if err != nil {
		return AnalogResponse{}, internal("Error in sensitivity analysis: %v", err)
	}
	extra, err := model.CheckExtrapolation(selected.Region, pool, weights)
	if err != nil {
		return AnalogResponse{}, internal("Error checking extrapolation: %v", err)
	}

	// 5. Response: each match with its full region and per-variable breakdown.
	idx := make(map[string]int, len(earth))
	for i, e := range earth {
		idx[e.RegionId] = i
	}
	resp := AnalogResponse{
		Planet: planet, Filter: filter, Mission: mission,
		SelectedRegion: selected, Matches: []MatchResponse{}, Robustness: rob, Extrapolation: extra,
	}
	for _, m := range matches {
		i := idx[m.RegionID]
		feats, err := model.CompareFeatures(selected.Region, earth[i].Region, target, cands[i], stats, weights)
		if err != nil {
			return AnalogResponse{}, internal("Error building breakdown: %v", err)
		}
		resp.Matches = append(resp.Matches, MatchResponse{Match: m, Region: earth[i], Features: feats})
	}
	return resp, nil
}

// resolveMission: "" = no filter; otherwise a built-in or custom mission ID.
func (s *Server) resolveMission(snap custom.Snapshot, filter string) (*MissionView, map[string]float64, *apiError) {
	if filter == "" {
		return nil, nil, nil
	}
	if d, ok := knn.Missions[filter]; ok {
		return &MissionView{ID: filter, Name: filter, Source: "builtin", Demand: d}, d, nil
	}
	if m, ok := snap.Missions[filter]; ok {
		return &MissionView{ID: m.ID, Name: m.Name, Description: m.Description, Source: "custom", Demand: m.Demand}, m.Demand, nil
	}
	return nil, nil, &apiError{http.StatusBadRequest,
		fmt.Sprintf("Unknown filter %q. Available: %s (or empty)", filter, strings.Join(missionIDs(snap), ", "))}
}

func missionIDs(snap custom.Snapshot) []string {
	ids := knn.MissionNames()
	for id := range snap.Missions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// ---------------------------------------------------------------- catalog & regions

type planetCount struct {
	Builtin int `json:"builtin"`
	Custom  int `json:"custom"`
}

// Catalog: everything the frontend needs to build menus and forms without hardcoding.
func (s *Server) Catalog(w http.ResponseWriter, r *http.Request) {
	snap := s.snapshot()
	missions := []MissionView{}
	for _, id := range missionIDs(snap) {
		mv, profile, _ := s.resolveMission(snap, id)
		rep, err := snap.Model.Report(profile)
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "Internal server error")
			log.Printf("catalog: mission %s: %v", id, err)
			return
		}
		mv.Report = &rep
		missions = append(missions, *mv)
	}
	planets := map[string]planetCount{}
	for _, p := range custom.Planets {
		regs, err := s.Parser.GetRegions(p)
		if err != nil {
			log.Printf("catalog: reading %s: %v", p, err)
			WriteError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		planets[p] = planetCount{Builtin: len(regs), Custom: len(snap.Regions[p])}
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"capabilities": map[string]bool{"ownRegions": s.Custom != nil},
		"categories":   knn.Categories,
		"features":     snap.Model.Features(),
		"missions":     missions,
		"planets":      planets,
		"warnings":     nonNil(snap.Warnings),
	})
}

// Regions (GET /api/regions/all): { planet, regions: [...] } — same shape as data/*.json, so the
// frontend's loadRegions(url) can point here instead of the static file.
func (s *Server) Regions(w http.ResponseWriter, r *http.Request) {
	planet := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("planet")))
	regs, err := s.Parser.GetRegions(planet)
	switch {
	case errors.Is(err, jsonParser.ErrInvalidPlanet):
		WriteError(w, http.StatusBadRequest, "Planet must be 'moon', 'mars' or 'earth'")
		return
	case err != nil:
		log.Printf("regions: %v", err)
		WriteError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	snap := s.snapshot()
	out := make([]RegionView, 0, len(regs)+len(snap.Regions[planet]))
	for _, reg := range regs {
		out = append(out, RegionView{reg, "builtin"})
	}
	for _, reg := range snap.Regions[planet] {
		out = append(out, RegionView{reg, "custom"})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"planet": planet, "regions": out})
}

// ---------------------------------------------------------------- uploads (--own-regions)

func (s *Server) ownOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Custom == nil {
			WriteError(w, http.StatusForbidden, "Custom data is disabled: start the backend with --own-regions")
			return
		}
		h(w, r)
	}
}

func writeValidation(w http.ResponseWriter, err error) {
	if ve, ok := custom.IsValidation(err); ok {
		WriteJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "Invalid file", "errors": ve.Errors})
		return
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		WriteError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("File larger than %d MB", MaxUploadBytes>>20))
		return
	}
	WriteError(w, http.StatusBadRequest, err.Error())
}

func (s *Server) builtinIDs() (map[string]map[string]bool, error) {
	out := map[string]map[string]bool{}
	for _, p := range custom.Planets {
		regs, err := s.Parser.GetRegions(p)
		if err != nil {
			return nil, err
		}
		out[p] = make(map[string]bool, len(regs))
		for _, reg := range regs {
			out[p][reg.RegionId] = true
		}
	}
	return out, nil
}

func (s *Server) UploadRegions(w http.ResponseWriter, r *http.Request) {
	ids, err := s.builtinIDs()
	if err != nil {
		log.Printf("upload regions: %v", err)
		WriteError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	set, err := custom.ParseRegions(http.MaxBytesReader(w, r.Body, MaxUploadBytes), ids)
	if err != nil {
		writeValidation(w, err)
		return
	}
	s.Custom.SetRegions(set)
	s.CustomState(w, r)
}

func (s *Server) UploadMissions(w http.ResponseWriter, r *http.Request) {
	ms, err := custom.ParseMissions(http.MaxBytesReader(w, r.Body, MaxUploadBytes))
	if err != nil {
		writeValidation(w, err)
		return
	}
	s.Custom.SetMissions(ms)
	s.CustomState(w, r)
}

// CustomState: what is loaded right now (IDs per planet, variables, missions).
func (s *Server) CustomState(w http.ResponseWriter, r *http.Request) {
	snap := s.Custom.Snapshot()
	regions := map[string][]string{}
	for _, p := range custom.Planets {
		ids := []string{}
		for _, reg := range snap.Regions[p] {
			ids = append(ids, reg.RegionId)
		}
		regions[p] = ids
	}
	missions := []custom.Mission{}
	for _, id := range missionIDs(snap) {
		if m, ok := snap.Missions[id]; ok {
			missions = append(missions, m)
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"regions":   regions,
		"variables": snap.Model.CustomVariables(),
		"missions":  missions,
		"warnings":  nonNil(snap.Warnings),
	})
}

func (s *Server) ClearCustom(w http.ResponseWriter, r *http.Request) {
	s.Custom.Clear()
	w.WriteHeader(http.StatusNoContent)
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
