package main

// Backend entry point.
//
//	go run .                    built-in data only
//	go run . --own-regions      also accept user regions, variables and missions
//
// Environment: DATA_DIR (default "data"), ADDR, ALLOWED_ORIGIN.
// With --own-regions the default ADDR is 127.0.0.1:8080 (only this machine can
// upload); without it, :8080.

import (
	"flag"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"

	"spaceapps/API"
	"spaceapps/custom"
	"spaceapps/jsonParser"
)

// isLocalOrigin: the frontend served from localhost/127.0.0.1 on any port (development)
func isLocalOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1"
}

// cors: with ALLOWED_ORIGIN empty any local origin is accepted (development);
// if it is set, only that origin (production on another domain).
func cors(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (origin == allowedOrigin || (allowedOrigin == "" && isLocalOrigin(origin))) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
	origin := os.Getenv("ALLOWED_ORIGIN") // empty = any localhost

	parser, err := jsonParser.New(dataDir)
	if err != nil {
		log.Fatal(err)
	}

	srv := &API.Server{Parser: parser}
	if *ownRegions {
		srv.Custom = custom.NewStore()
		if !isLoopback(addr) {
			log.Printf("WARNING: --own-regions on %s: anyone who can reach this address can upload data", addr)
		}
	}

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           cors(origin, srv.Routes()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
	}
	log.Printf("listening on %s (data: %s, own-regions: %v)", addr, dataDir, *ownRegions)
	log.Fatal(httpSrv.ListenAndServe())
}