package jsonParser

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

const testdata = "../knn/testdata"

func newParser(t *testing.T, dir string) *Parser {
	t.Helper()
	p, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestNewRejectsMissingDir(t *testing.T) {
	if _, err := New(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Error("a missing data directory must be an error")
	}
}

func TestSanitizePlanet(t *testing.T) {
	for raw, want := range map[string]string{"mars": "mars", " MOON ": "moon"} {
		if got, err := SanitizePlanet(raw); err != nil || got != want {
			t.Errorf("SanitizePlanet(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"", "earth", "venus", "../mars", "mars/"} {
		if _, err := SanitizePlanet(raw); !errors.Is(err, ErrInvalidPlanet) {
			t.Errorf("SanitizePlanet(%q): want ErrInvalidPlanet, got %v", raw, err)
		}
	}
}

func TestSanitizeRegionID(t *testing.T) {
	if got, err := SanitizeRegionID(" MARS-001 "); err != nil || got != "MARS-001" {
		t.Errorf("SanitizeRegionID: %q, %v", got, err)
	}
	for _, raw := range []string{"", "../../earth", "a/b", "MARS 001"} {
		if _, err := SanitizeRegionID(raw); !errors.Is(err, ErrInvalidRegionID) {
			t.Errorf("SanitizeRegionID(%q): want ErrInvalidRegionID, got %v", raw, err)
		}
	}
}

func TestGetRegion(t *testing.T) {
	p := newParser(t, testdata)
	info, err := p.GetRegion("MARS", "MARS-001")
	if err != nil {
		t.Fatal(err)
	}
	if info.Planet != "mars" || len(info.Regions) != 1 || info.Regions[0].RegionId != "MARS-001" {
		t.Fatalf("unexpected result: %+v", info)
	}
	if _, err := p.GetRegion("mars", "MOON-001"); !errors.Is(err, ErrRegionNotFound) {
		t.Errorf("region from another planet: want ErrRegionNotFound, got %v", err)
	}
	if _, err := p.GetRegion("venus", "MARS-001"); !errors.Is(err, ErrInvalidPlanet) {
		t.Errorf("want ErrInvalidPlanet, got %v", err)
	}
	if _, err := p.GetRegion("mars", "../x"); !errors.Is(err, ErrInvalidRegionID) {
		t.Errorf("want ErrInvalidRegionID, got %v", err)
	}
}

// null in the JSON stays nil (no data), while 0 is a real value.
func TestNullIsNil(t *testing.T) {
	p := newParser(t, testdata)
	regs, err := p.GetRegions("mars")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range regs {
		if r.AuditVariables.SalinityWtPct != nil {
			t.Errorf("%s: null salinity_wt_pct must be nil", r.RegionId)
		}
		if v := r.AuditVariables.VegetationNdvi; v == nil || *v != 0 {
			t.Errorf("%s: vegetation_ndvi 0.0 must be a non-nil 0", r.RegionId)
		}
	}
}

func TestGetRegionsAndEarth(t *testing.T) {
	p := newParser(t, testdata)
	for _, planet := range []string{"earth", "mars", "moon", " Earth "} {
		regs, err := p.GetRegions(planet)
		if err != nil || len(regs) == 0 {
			t.Errorf("GetRegions(%q): %d regions, %v", planet, len(regs), err)
		}
	}
	if _, err := p.GetRegions("venus"); !errors.Is(err, ErrInvalidPlanet) {
		t.Errorf("want ErrInvalidPlanet, got %v", err)
	}
	earth, err := p.GetEarthRegions()
	if err != nil || len(earth) == 0 {
		t.Fatalf("GetEarthRegions: %d, %v", len(earth), err)
	}
}

func TestBadFiles(t *testing.T) {
	dir := t.TempDir()
	p := newParser(t, dir)
	if _, err := p.GetEarthRegions(); err == nil {
		t.Error("missing earth.json must be an error")
	}
	if err := os.WriteFile(filepath.Join(dir, "earth.json"), []byte(`{"regions": [`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := p.GetEarthRegions(); err == nil {
		t.Error("malformed earth.json must be an error")
	}
	if err := os.WriteFile(filepath.Join(dir, "earth.json"), []byte(`{"regions": []}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := p.GetEarthRegions(); err == nil {
		t.Error("earth.json without regions must be an error")
	}
}
