package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"backend/jsonParser"
)

func main() {
	http.HandleFunc("/api/planetas", obtenerPlanetasHandler)

	fmt.Println("Servidor corriendo en http://localhost:8080/api/planetas")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func obtenerPlanetasHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	nasaURL := "https://caltech.edu"

	resp, err := http.Get(nasaURL)
	if err != nil {
		http.Error(w, "Error conectando con la NASA", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	datosCrudos, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Error leyendo respuesta", http.StatusInternalServerError)
		return
	}

	datosLimpios, err := jsonParser.Parser(datosCrudos)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(datosLimpios)
}
