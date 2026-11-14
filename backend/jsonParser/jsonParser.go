package jsonParser

import (
	"encoding/json"
	"fmt"
)

type Planeta struct {
	Nombre      string  `json:"pl_name"`
	Masa        float64 `json:"pl_bmasse"`
	Radio       float64 `json:"pl_rade"`
	Temperatura float64 `json:"pl_eqt"`
}

func Parser(datosCrudos []byte) ([]Planeta, error) {
	var listaPlanetas []Planeta

	err := json.Unmarshal(datosCrudos, &listaPlanetas)
	if err != nil {
		return nil, fmt.Errorf("error al parsear JSON de planetas: %w", err)
	}

	return listaPlanetas, nil
}
