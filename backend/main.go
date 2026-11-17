package main

// Backend entry point: a thin wrapper around package API.
//
//	go run .                    built-in data only
//	go run . --own-regions      also accept user regions, variables and missions (/api/custom/*)
//
// Environment: DATA_DIR (default "data"), ADDR, ALLOWED_ORIGIN.
// With --own-regions the default ADDR is 127.0.0.1:8080 (only this machine can
// upload); without it, :8080. Every endpoint lives in package API.

import (
	"flag"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"spaceapps/API"
	"spaceapps/custom"
	"spaceapps/jsonParser"
)

// isLocalOrigin: the frontend served from localhost/127.0.0.1 on any port (development).
func isLocalOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1"
}

// defaultAllowedOrigins: the published frontend, always accepted. ALLOWED_ORIGIN
// (comma-separated list) adds others.
const defaultAllowedOrigins = "https://katsi.onrender.com"

// parseOrigins: "a, b/" → ["a", "b"] (no spaces or trailing slash, which the browser never sends)
func parseOrigins(list string) []string {
	var origins []string
	for _, o := range strings.Split(list, ",") {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			origins = append(origins, o)
		}
	}
	return origins
}

// cors: accepts the exact origins in the list and, for development, any localhost/127.0.0.1.
// The API uses no cookies or credentials, so Allow-Credentials is not sent.
// Max-Age caches the preflight of POST requests (Chrome caps it at 2 h).
func cors(allowedOrigins []string, next http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin") // the response depends on the origin: no cache may mix them
		origin := r.Header.Get("Origin")
		if origin != "" && (allowed[origin] || isLocalOrigin(origin)) {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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

func isLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// newHandler builds the whole HTTP handler (API routes + CORS); custom uploads
// are enabled only with ownRegions.
func newHandler(parser *jsonParser.Parser, ownRegions bool, origins []string) http.Handler {
	srv := &API.Server{Parser: parser}
	if ownRegions {
		srv.Custom = custom.NewStore()
	}
	return cors(origins, srv.Routes())
}

func main() {
	ownRegions := flag.Bool("own-regions", false, "accept user-uploaded regions, variables and missions (/api/custom/*)")
	flag.Parse()

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data" // relative to where the binary runs
	}
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
		if *ownRegions {
			addr = "127.0.0.1:8080"
		}
	}
	origins := append(parseOrigins(os.Getenv("ALLOWED_ORIGIN")), defaultAllowedOrigins)

	parser, err := jsonParser.New(dataDir)
	if err != nil {
		log.Fatal(err)
	}
	if *ownRegions && !isLoopback(addr) {
		log.Printf("WARNING: --own-regions on %s: anyone who can reach this address can upload data", addr)
	}

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           newHandler(parser, *ownRegions, origins),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
	}
	log.Printf("listening on %s (data: %s, own-regions: %v, CORS: %v + localhost)", addr, dataDir, *ownRegions, origins)
	log.Fatal(httpSrv.ListenAndServe())
}
