package main

// Hybrid entrypoint: the handlers in this package (analog, regions, missions, filters, custom)
// are what the frontend uses and take precedence; package API fills in the rest of its
// endpoints (/api/status, /api/catalog, /api/calculate) through the "/" fallback below.

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"spaceapps/API"
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

// GET /api/filters → pesos de cada misión (F1 afinidad, F2′ peso, N_ef, ángulo).
func filtersHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, knn.MissionReports())
}

// GET /api/health → 204 sin cuerpo. El front lo llama al cargar para despertar el servicio
// (Render apaga el plan gratuito tras ~15 min sin tráfico y tarda 30–50 s en arrancar).
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// defaultAllowedOrigins: el front publicado. ALLOWED_ORIGIN (lista separada por comas) lo reemplaza.
const defaultAllowedOrigins = "https://katsi.onrender.com"

// parseOrigins: "a, b/" → ["a", "b"] (sin espacios ni barra final, que el navegador nunca envía)
func parseOrigins(list string) []string {
	var origins []string
	for _, o := range strings.Split(list, ",") {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			origins = append(origins, o)
		}
	}
	return origins
}

// cors: acepta los orígenes de la lista exacta y, para desarrollo, cualquier localhost/127.0.0.1.
// La API no usa cookies ni credenciales, así que no se envía Allow-Credentials.
// Max-Age guarda el preflight de POST /api/analog/custom (Chrome lo limita a 2 h).
func cors(allowedOrigins []string, next http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin") // la respuesta cambia según el origen: que ninguna caché la mezcle
		origin := r.Header.Get("Origin")
		if origin != "" && (allowed[origin] || isLocalOrigin(origin)) {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "7200")
		}
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
	origins := parseOrigins(envOr("ALLOWED_ORIGIN", defaultAllowedOrigins))

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
	mux.HandleFunc("GET /api/health", healthHandler)

	// Everything not registered above is served by package API. Go's ServeMux picks the most
	// specific pattern, so the routes above win; API's own /api/analog and /api/regions are
	// never reached. Custom is nil: no --own-regions, so its upload routes answer 403.
	apiServer := &API.Server{Parser: parser}
	mux.Handle("/", apiServer.Routes())

	srv := &http.Server{
		Addr:              addr,
		Handler:           cors(origins, mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
	log.Printf("escuchando en %s (data: %s, CORS: %v + localhost)", addr, dataDir, origins)
	log.Fatal(srv.ListenAndServe())
}