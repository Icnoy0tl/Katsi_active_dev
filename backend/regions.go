package main

// GET /api/regions?planet=mars&filter=mobility
//
// Terrains of the Moon or Mars ranked for a mission: each region is scored by the similarity of
// its best Earth analog under the mission weights (the same KNN as GET /api/analog), so the list
// starts with the terrains a mission can best rehearse on Earth. A region is left out when it
// lacks data for the mission (dataCoverage < knn.MinCoverage) or when no Earth site shares enough
// of the mission's variables with it (best analog coverage < knn.MinCoverage).

import (
	"errors"
	"log"
	"net/http"
	"sort"
	"strings"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

type rankedAnalog struct {
	RegionID   string  `json:"regionId"`
	Name       string  `json:"name"`
	Similarity float64 `json:"similarity"`
	Coverage   float64 `json:"coverage"`
}

type rankedRegion struct {
	RegionID     string                 `json:"regionId"`
	Name         string                 `json:"name"`
	Coordinates  jsonParser.Coordinates `json:"coordinates"`
	Score        float64                `json:"score"`        // similarity of the best Earth analog (0–1)
	DataCoverage float64                `json:"dataCoverage"` // share of the mission weight the region has data for
	BestAnalog   rankedAnalog           `json:"bestAnalog"`
}

type regionsResponse struct {
	Planet   string         `json:"planet"`
	Filter   string         `json:"filter"`
	Total    int            `json:"total"`    // regions of the planet before filtering
	Regions  []rankedRegion `json:"regions"`  // from best to worst score
	Excluded []string       `json:"excluded"` // regionIds left out (not enough data for the mission)
}

func regionsHandler(parser *jsonParser.Parser) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		filter := q.Get("filter")

		info, err := parser.GetPlanetRegions(q.Get("planet"))
		switch {
		case errors.Is(err, jsonParser.ErrInvalidPlanet):
			writeError(w, http.StatusBadRequest, "planet debe ser 'moon' o 'mars'")
			return
		case err != nil:
			log.Printf("error leyendo planeta: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}

		weights, err := knn.WeightsFor(filter, knn.FeatureNames())
		if err != nil {
			writeError(w, http.StatusBadRequest, "filter debe ser "+strings.Join(knn.MissionNames(), ", ")+" o vacío")
			return
		}

		earth, err := parser.GetEarthRegions()
		if err != nil {
			log.Printf("error leyendo earth.json: %v", err)
			writeError(w, http.StatusInternalServerError, "error interno")
			return
		}

		resp := regionsResponse{
			Planet:   info.Planet,
			Filter:   filter,
			Total:    len(info.Regions),
			Regions:  make([]rankedRegion, 0, len(info.Regions)),
			Excluded: []string{},
		}
		for _, region := range info.Regions {
			target, pool, err := knn.Prepare(region, earth)
			if err != nil {
				log.Printf("error normalizando %s: %v", region.RegionId, err)
				resp.Excluded = append(resp.Excluded, region.RegionId)
				continue
			}
			coverage := dataCoverage(target, weights)
			matches, err := knn.FindMostSimilar(target, pool, weights, 1)
			if err != nil {
				log.Printf("error en knn %s: %v", region.RegionId, err)
				writeError(w, http.StatusInternalServerError, "error interno")
				return
			}
			if coverage < knn.MinCoverage || len(matches) == 0 || matches[0].Coverage < knn.MinCoverage {
				resp.Excluded = append(resp.Excluded, region.RegionId)
				continue
			}
			best := matches[0]
			resp.Regions = append(resp.Regions, rankedRegion{
				RegionID:     region.RegionId,
				Name:         region.Name,
				Coordinates:  region.Coords,
				Score:        best.Similarity,
				DataCoverage: coverage,
				BestAnalog:   rankedAnalog{RegionID: best.RegionID, Name: best.Name, Similarity: best.Similarity, Coverage: best.Coverage},
			})
		}
		sort.SliceStable(resp.Regions, func(i, j int) bool { return resp.Regions[i].Score > resp.Regions[j].Score })
		writeJSON(w, http.StatusOK, resp)
	}
}
