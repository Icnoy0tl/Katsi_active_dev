package main

//TODO TEST MAIN, NOT FINAL. INTEGRATION WITH API IS DUE

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

const topK = 3

// Análisis de sensibilidad: ±20 % en cada componente del perfil de la misión, 200 ensayos, seed fijo.
const (
	robustEps    = 0.20
	robustTrials = 200
	robustSeed   = 2026
)

type MatchResponse struct {
	knn.Match
	Region   jsonParser.Region   `json:"region"`             // datos completos de la región de la Tierra
	Features []knn.FeatureCompat `json:"features,omitempty"` // desglose por variable (índice de compatibilidad)
}

type AnalogResponse struct {
	Planet         string            `json:"planet"`
	Filter         string            `json:"filter"`
	SelectedRegion jsonParser.Region `json:"selectedRegion"`
	Matches        []MatchResponse   `json:"matches"`
	Robustness     knn.Robustness    `json:"robustness"`
	// Aspectos del objetivo que ningún sitio terrestre del catálogo cubre.
	Extrapolation knn.Extrapolation `json:"extrapolation"`
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// GET /api/analog?planet=mars&regionId=XXX&filter=mobility
func analogHandler(parser *jsonParser.Parser) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		filter := q.Get("filter")

		// 1. Parser: solo la región elegida del planeta elegido (sanitiza planet y regionId)
		info, err := parser.GetRegion(q.Get("planet"), q.Get("regionId"))
		switch {
		case errors.Is(err, jsonParser.ErrInvalidPlanet):
			writeError(w, http.StatusBadRequest, "planet debe ser 'moon' o 'mars'")
			return
		case errors.Is(err, jsonParser.ErrInvalidRegionID):
			writeError(w, http.StatusBadRequest, "regionId inválido")
			return
		case errors.Is(err, jsonParser.ErrRegionNotFound):
			writeError(w, http.StatusNotFound, "región no encontrada")
			return
		case err != nil:
			log.Printf("error leyendo planeta: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}
		selected := info.Regions[0]

		// 2. Parser: todas las regiones de la Tierra
		earth, err := parser.GetEarthRegions()
		if err != nil {
			log.Printf("error leyendo earth.json: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}

		// 3. Normalización (mismas stats para objetivo y Tierra, columna por columna)
		target, pool, stats, err := knn.PrepareWithStats(selected, earth)
		if err != nil {
			log.Printf("error normalizando: %v", err)
			writeError(w, http.StatusUnprocessableEntity, "datos de región inválidos")
			return
		}

		// 4. Pesos del filtro + KNN
		weights, err := knn.WeightsFor(filter, knn.FeatureNames())
		if err != nil {
			writeError(w, http.StatusBadRequest, "filter debe ser "+strings.Join(knn.MissionNames(), ", ")+" o vacío")
			writeError(w, http.StatusBadRequest, "filter debe ser vacío o uno de: "+strings.Join(knn.MissionNames(), ", "))
			return
		}
		matches, err := knn.FindMostSimilar(target, pool, weights, topK)
		if err != nil {
			log.Printf("error en knn: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}

		// 5. Respuesta: cada match con los datos completos de su región terrestre y el desglose
		//    por variable (mismos vectores normalizados, estadísticas y pesos que el KNN)
		rob, err := knn.AnalyzeRobustness(target, pool, filter, topK, robustEps, robustTrials, robustSeed)
		if err != nil {
			log.Printf("error en robustez: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}

		extra, err := knn.CheckExtrapolation(selected, earth, weights)
		if err != nil {
			log.Printf("error en extrapolación: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}

		// 5. Respuesta: cada match con los datos completos de su región terrestre
		byID := make(map[string]jsonParser.Region, len(earth))
		for _, e := range earth {
			byID[e.RegionId] = e
		}
		candByID := make(map[string]knn.Candidate, len(pool))
		for _, c := range pool {
			candByID[c.ID] = c
		}
		resp := AnalogResponse{Planet: info.Planet, Filter: filter, SelectedRegion: selected}
		resp := AnalogResponse{Planet: info.Planet, Filter: filter, SelectedRegion: selected, Robustness: rob, Extrapolation: extra}
		for _, m := range matches {
			features, err := knn.CompareFeatures(selected, byID[m.RegionID], target, candByID[m.RegionID], stats, weights)
			if err != nil {
				log.Printf("error en desglose %s: %v", m.RegionID, err)
				writeError(w, http.StatusInternalServerError, "error interno")
				return
			}
			resp.Matches = append(resp.Matches, MatchResponse{Match: m, Region: byID[m.RegionID], Features: features})
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// isLocalOrigin: el front servido desde localhost/127.0.0.1 en cualquier puerto (desarrollo)
func isLocalOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1"
}

// cors: con ALLOWED_ORIGIN vacío se acepta cualquier origen local (desarrollo); si se define,
// solo ese origen (producción en otro dominio).
// GET /api/filters → pesos de cada misión (F1 afinidad, F2′ peso, N_ef, ángulo).
func filtersHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, knn.MissionReports())
}

func cors(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (origin == allowedOrigin || (allowedOrigin == "" && isLocalOrigin(origin))) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	dataDir := envOr("DATA_DIR", "data") // relativo a donde corres el binario
	addr := envOr("ADDR", ":8080")
	origin := os.Getenv("ALLOWED_ORIGIN") // vacío = cualquier localhost

	parser, err := jsonParser.New(dataDir)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/analog", analogHandler(parser))
	mux.HandleFunc("GET /api/missions", missionsHandler)
	mux.HandleFunc("GET /api/regions", regionsHandler(parser))
	mux.HandleFunc("POST /api/analog/custom", customAnalogHandler(parser))
	mux.HandleFunc("GET /api/filters", filtersHandler)

	srv := &http.Server{
		Addr:              addr,
		Handler:           cors(origin, mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
	log.Printf("escuchando en %s (data: %s)", addr, dataDir)
	log.Fatal(srv.ListenAndServe())
}
