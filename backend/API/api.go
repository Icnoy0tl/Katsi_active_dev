package API

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

const TopK = 3

type MatchResponse struct {
	knn.Match
	Region jsonParser.Region `json:"region"`
}

type AnalogResponse struct {
	Planet         string            `json:"planet"`
	Filter         string            `json:"filter"`
	SelectedRegion jsonParser.Region `json:"selectedRegion"`
	Matches        []MatchResponse   `json:"matches"`
}

type CalculateRequest struct {
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

// Endpoint 1: Status -> Returns "Status: 200 ok" and an image
func Status(w http.ResponseWriter, r *http.Request) {
	Response := map[string]string{
		"status": "Status: 200 ok",
		"image":  "PASTE_IMAGE_URL_OR_BASE64_HERE",
	}
	WriteJSON(w, http.StatusOK, Response)
}

// Endpoint 2: Calculate -> Parsers both jsons, normalize data, and runs KNN
func Calculate(ParserInstance *jsonParser.Parser) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var Req CalculateRequest
		if err := json.NewDecoder(r.Body).Decode(&Req); err != nil {
			WriteError(w, http.StatusBadRequest, "Invalid JSON payload: "+err.Error())
			return
		}

		// 1. Parse target region from Moon or Mars
		PlanetInfo, err := ParserInstance.GetRegion(Req.Characteristics.Planet, Req.Characteristics.RegionID)
		switch {
		case errors.Is(err, jsonParser.ErrInvalidPlanet):
			WriteError(w, http.StatusBadRequest, "Planet must be 'moon' or 'mars'")
			return
		case errors.Is(err, jsonParser.ErrInvalidRegionID):
			WriteError(w, http.StatusBadRequest, "Invalid regionId")
			return
		case errors.Is(err, jsonParser.ErrRegionNotFound):
			WriteError(w, http.StatusNotFound, "Region not found")
			return
		case err != nil:
			log.Printf("Error reading planet data: %v", err)
			WriteError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		Selected := PlanetInfo.Regions[0]

		// 2. Parse all Earth regions
		EarthRegions, err := ParserInstance.GetEarthRegions()
		if err != nil {
			log.Printf("Error reading earth.json: %v", err)
			WriteError(w, http.StatusInternalServerError, "Internal server error")
			return
		}

		// 3. Normalize data (Target vs Earth pool)
		Target, Pool, err := knn.Prepare(Selected, EarthRegions)
		if err != nil {
			log.Printf("Error normalizing data: %v", err)
			WriteError(w, http.StatusUnprocessableEntity, "Invalid region data")
			return
		}

		// 4. Get mission weights and calculate Top 3 matches via KNN
		Weights, err := knn.WeightsFor(Req.Missions.Filter, knn.FeatureNames())
		if err != nil {
			WriteError(w, http.StatusBadRequest, "Filter must be rover, ice_and_volatiles, thermal_cycles, or empty")
			return
		}
		Matches, err := knn.FindMostSimilar(Target, Pool, Weights, TopK)
		if err != nil {
			log.Printf("Error running KNN: %v", err)
			WriteError(w, http.StatusInternalServerError, "Internal server error")
			return
		}

		// 5. Build final JSON response
		ByID := make(map[string]jsonParser.Region, len(EarthRegions))
		for _, E := range EarthRegions {
			ByID[E.RegionId] = E
		}

		Resp := AnalogResponse{
			Planet:         PlanetInfo.Planet,
			Filter:         Req.Missions.Filter,
			SelectedRegion: Selected,
		}
		for _, M := range Matches {
			Resp.Matches = append(Resp.Matches, MatchResponse{
				Match:  M,
				Region: ByID[M.RegionID],
			})
		}

		WriteJSON(w, http.StatusOK, Resp)
	}
}
