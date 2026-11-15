// analogaudit: corre todas las regiones de Marte y la Luna contra todos los
// filtros y explica cada top-1 (qué variables pesan más en la distancia).
//
//	go run ./tools/analogaudit -data data
package main

import (
	"flag"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"

	"spaceapps/jsonParser"
	"spaceapps/knn"
)

func main() {
	dataDir := flag.String("data", "data", "directorio con earth/mars/moon.json")
	flag.Parse()
	p, err := jsonParser.New(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	earth, err := p.GetEarthRegions()
	if err != nil {
		log.Fatal(err)
	}
	names := knn.FeatureNames()
	filters := append([]string{""}, knn.MissionNames()...)

	for _, planet := range []string{"mars", "moon"} {
		ids := map[string][]string{"mars": {"MARS-001", "MARS-002", "MARS-003"}, "moon": {"MOON-001", "MOON-002", "MOON-003"}}[planet]
		for _, id := range ids {
			info, err := p.GetRegion(planet, id)
			if err != nil {
				log.Fatal(err)
			}
			sel := info.Regions[0]
			target, pool, err := knn.Prepare(sel, earth)
			if err != nil {
				log.Fatal(err)
			}
			fmt.Printf("\n### %s — %s\n", id, sel.Name)
			for _, f := range filters {
				w, _ := knn.WeightsFor(f, names)
				ms, _ := knn.FindMostSimilar(target, pool, w, 3)
				rob, _ := knn.AnalyzeRobustness(target, pool, f, 3, 0.2, 200, 2026)
				var parts []string
				for _, m := range ms {
					parts = append(parts, fmt.Sprintf("%s %.3f (cov %.2f)", short(m.Name), m.Similarity, m.Coverage))
				}
				label := f
				if label == "" {
					label = "(parejo)"
				}
				// Contribution by var
				var top1 knn.Candidate
				for _, c := range pool {
					if c.ID == ms[0].RegionID {
						top1 = c
					}
				}
				type kv struct {
					k string
					v float64
				}
				var cs []kv
				tot := 0.0
				for i := range w {
					a, b := target.Vector[i], top1.Vector[i]
					if math.IsNaN(a) || math.IsNaN(b) || w[i] == 0 {
						continue
					}
					x := w[i] * (a - b) * (a - b)
					cs = append(cs, kv{names[i], x})
					tot += x
				}
				sort.Slice(cs, func(i, j int) bool { return cs[i].v > cs[j].v })
				var why []string
				for _, c := range cs[:3] {
					why = append(why, fmt.Sprintf("%s %.0f%%", c.k, 100*c.v/tot))
				}
				fmt.Printf("  %-9s %s | top1 stable %.2f | d² from top1: %s\n", label, strings.Join(parts, " · "), rob.Top1Stability, strings.Join(why, ", "))
			}
		}
	}
}

func short(s string) string {
	if i := strings.Index(s, " - "); i > 0 {
		return s[:i]
	}
	return s
}
