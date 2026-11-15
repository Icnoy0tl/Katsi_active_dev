package custom

import (
	"os"
	"strings"
	"testing"
)

var builtin = map[string]map[string]bool{
	"mars":  {"MARS-001": true},
	"moon":  {"MOON-001": true},
	"earth": {"EARTH-001": true},
}

const okRegion = `{"regionId":"R1","name":"Uno","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}}`

func mustFail(t *testing.T, err error, path, msg string) {
	t.Helper()
	ve, ok := IsValidation(err)
	if !ok {
		t.Fatalf("expected validation error at %s, got %v", path, err)
	}
	for _, fe := range ve.Errors {
		if fe.Path == path && strings.Contains(fe.Message, msg) {
			return
		}
	}
	t.Fatalf("no error at %s containing %q; got %v", path, msg, ve.Errors)
}

func TestExampleRegionsFile(t *testing.T) {
	f, err := os.Open("../examples/custom_regions.example.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	set, err := ParseRegions(f, builtin)
	if err != nil {
		t.Fatal(err)
	}
	if len(set.ByPlanet["mars"]) != 1 || len(set.ByPlanet["earth"]) != 1 {
		t.Fatalf("by planet: %v", set.ByPlanet)
	}
	if !set.Model.IsCustomVariable("magnetic_susceptibility") {
		t.Fatal("custom variable missing from model")
	}
	if len(set.Warnings) != 0 {
		t.Fatalf("unexpected warnings %v", set.Warnings)
	}
	// Null stays nil (no data), it does not become 0.
	if set.ByPlanet["mars"][0].AuditVariables.SalinityWtPct != nil {
		t.Fatal("null salinity became a value")
	}
}

func TestExampleMissionsFile(t *testing.T) {
	f, err := os.Open("../examples/custom_missions.example.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	ms, err := ParseMissions(f)
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 2 || ms["sonda_penetradora"].Name == "" {
		t.Fatalf("missions: %v", ms)
	}
}

func TestRegionsRejected(t *testing.T) {
	cases := []struct {
		name, body, path, msg string
	}{
		{"typo field", `{"planet":"mars","regions":[{"regionId":"R1","name":"x","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slpoe":3}}]}`, "$", "unknown field"},
		{"two values", `{"planet":"mars","regions":[` + okRegion + `]} {}`, "$", "more than one value"},
		{"no planet", `{"regions":[` + okRegion + `]}`, "regions[0].planet", "missing"},
		{"bad planet", `{"planet":"venus","regions":[` + okRegion + `]}`, "planet", "must be one of"},
		{"builtin id", `{"planet":"mars","regions":[{"regionId":"MARS-001","name":"x","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}}]}`, "regions[0].regionId", "already exists"},
		{"repeated id", `{"planet":"mars","regions":[` + okRegion + `,` + okRegion + `]}`, "regions[1].regionId", "repeated"},
		{"bad id", `{"planet":"mars","regions":[{"regionId":"../x","name":"x","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}}]}`, "regions[0].regionId", "letters"},
		{"no coords", `{"planet":"mars","regions":[{"regionId":"R1","name":"x","coreVariables":{"slope":3}}]}`, "regions[0].coordinates", "required"},
		{"lat range", `{"planet":"mars","regions":[{"regionId":"R1","name":"x","coordinates":{"latitude":91,"longitude":2},"coreVariables":{"slope":3}}]}`, "regions[0].coordinates.latitude", "[-90, 90]"},
		{"no name", `{"planet":"mars","regions":[{"regionId":"R1","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}}]}`, "regions[0].name", "required"},
		{"all null", `{"planet":"mars","regions":[{"regionId":"R1","name":"x","coordinates":{"latitude":1,"longitude":2}}]}`, "regions[0]", "every variable is null"},
		{"undeclared var", `{"planet":"mars","regions":[{"regionId":"R1","name":"x","coordinates":{"latitude":1,"longitude":2},"customVariables":{"foo":1}}]}`, "regions[0].customVariables.foo", "not defined"},
		{"memberships sum", `{"planet":"mars","variables":[{"name":"foo","memberships":{"GEO":0.5}}],"regions":[` + okRegion + `]}`, "variables", "must be 1"},
		{"unknown category", `{"planet":"mars","variables":[{"name":"foo","memberships":{"GEOO":1}}],"regions":[` + okRegion + `]}`, "variables", "unknown"},
		{"builtin var name", `{"planet":"mars","variables":[{"name":"slope","memberships":{"GEO":1}}],"regions":[` + okRegion + `]}`, "variables", "built-in"},
		{"bad var name", `{"planet":"mars","variables":[{"name":"Mi Var","memberships":{"GEO":1}}],"regions":[` + okRegion + `]}`, "variables", "lowercase"},
		{"repeated var", `{"planet":"mars","variables":[{"name":"foo","memberships":{"GEO":1}},{"name":"foo","memberships":{"GEO":1}}],"regions":[` + okRegion + `]}`, "variables", "twice"},
		{"empty", `{"planet":"mars","regions":[]}`, "regions", "no regions"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseRegions(strings.NewReader(c.body), builtin)
			mustFail(t, err, c.path, c.msg)
		})
	}
}

func TestRegionsCollectsEveryError(t *testing.T) {
	body := `{"planet":"mars","regions":[{"regionId":"MARS-001","coordinates":{"latitude":95,"longitude":2},"coreVariables":{"slope":3}}]}`
	_, err := ParseRegions(strings.NewReader(body), builtin)
	ve, _ := IsValidation(err)
	if ve == nil || len(ve.Errors) < 3 {
		t.Fatalf("want ≥3 errors (id, name, latitude), got %v", err)
	}
}

func TestSamePlanetScopeForIDs(t *testing.T) {
	// The same ID on two different planets is fine.
	body := `{"regions":[
		{"planet":"mars","regionId":"R1","name":"a","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}},
		{"planet":"earth","regionId":"R1","name":"b","coordinates":{"latitude":1,"longitude":2},"coreVariables":{"slope":3}}]}`
	if _, err := ParseRegions(strings.NewReader(body), builtin); err != nil {
		t.Fatal(err)
	}
}

func TestWarningWithoutEarthValues(t *testing.T) {
	body := `{"planet":"mars","variables":[{"name":"foo","memberships":{"GEO":1}},{"name":"bar","memberships":{"NAV":1}}],
		"regions":[{"regionId":"R1","name":"x","coordinates":{"latitude":1,"longitude":2},"customVariables":{"foo":1}}]}`
	set, err := ParseRegions(strings.NewReader(body), builtin)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(set.Warnings, "|")
	if !strings.Contains(joined, `"foo" has no values in Earth`) || !strings.Contains(joined, `"bar" has no values in any`) {
		t.Fatalf("warnings: %v", set.Warnings)
	}
}

func TestMissionsRejected(t *testing.T) {
	cases := []struct {
		name, body, path, msg string
	}{
		{"builtin id", `{"missions":[{"id":"mobility","name":"x","demand":{"GEO":1}}]}`, "missions[0].id", "built-in"},
		{"bad id", `{"missions":[{"id":"Mi Mision","name":"x","demand":{"GEO":1}}]}`, "missions[0].id", "lowercase"},
		{"repeated", `{"missions":[{"id":"a","name":"x","demand":{"GEO":1}},{"id":"a","name":"y","demand":{"GEO":1}}]}`, "missions[1].id", "repeated"},
		{"no name", `{"missions":[{"id":"a","demand":{"GEO":1}}]}`, "missions[0].name", "required"},
		{"bad category", `{"missions":[{"id":"a","name":"x","demand":{"GEOO":1}}]}`, "missions[0].demand", "unknown"},
		{"negative", `{"missions":[{"id":"a","name":"x","demand":{"GEO":-1,"MEC":2}}]}`, "missions[0].demand", ">= 0"},
		{"zero sum", `{"missions":[{"id":"a","name":"x","demand":{"GEO":0}}]}`, "missions[0].demand", "sum 0"},
		{"no demand", `{"missions":[{"id":"a","name":"x"}]}`, "missions[0].demand", "missing"},
		{"typo field", `{"missions":[{"id":"a","name":"x","demmand":{"GEO":1}}]}`, "$", "unknown field"},
		{"empty", `{"missions":[]}`, "missions", "no missions"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseMissions(strings.NewReader(c.body))
			mustFail(t, err, c.path, c.msg)
		})
	}
}

func TestDemandNeedNotSumToOne(t *testing.T) {
	ms, err := ParseMissions(strings.NewReader(`{"missions":[{"id":"a","name":"x","demand":{"GEO":3,"MEC":1}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if ms["a"].Demand["GEO"] != 3 {
		t.Fatal("demand altered on parse (it is normalized later, in ComputeWeights)")
	}
}
