package API

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"backend/jsonParser"
)

func API() {
	http.HandleFunc("/api/Planets", GetPlanetsHandler)

	fmt.Println("Server running at http://localhost:8080/api/Planets")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func GetPlanetsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	NasaURL := "https://caltech.edu"

	Resp, err := http.Get(NasaURL)
	if err != nil {
		http.Error(w, "Error connecting to NASA", http.StatusBadGateway)
		return
	}
	defer Resp.Body.Close()

	RawData, err := io.ReadAll(Resp.Body)
	if err != nil {
		http.Error(w, "Error reading response", http.StatusInternalServerError)
		return
	}

	CleanData, err := jsonParser.Parser(RawData)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(CleanData)
}

