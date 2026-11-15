package knn

// Model: the set of dimensions the KNN compares and the variable types (Mu)
// the weights are computed from.
//
// Default is the built-in model (26 dimensions, 25 Mu variables). NewModel adds
// user-defined variables on top of it (--own-regions): each one is a new Mu row
// (its type over the 7 categories) and a new dimension read from
// region.customVariables[name]. Nothing else changes: F2′, the projection to the
// terrestrial range, coverage and the breakdown work the same for any number of
// dimensions, so the built-in path and the custom path share all the code.
//
// Adding a variable to category c raises n_c, so the weight the mission gives c
// is shared among more variables (F2′: w_j = Σ_c μ_jc d̃_c / n_c). If the Earth
// catalog has no values for it, the dimension is missing for every candidate and
// coverage drops instead of the distance being invented.

import (
	"errors"
	"fmt"
	"regexp"

	"spaceapps/jsonParser"
)

// CustomVariable: a user-defined variable and its type (memberships sum to 1).
type CustomVariable struct {
	Name        string             `json:"name"`
	Label       string             `json:"label,omitempty"`
	Unit        string             `json:"unit,omitempty"`
	Memberships map[string]float64 `json:"memberships"`
}

// FeatureInfo describes one dimension for the frontend (GET /api/catalog).
type FeatureInfo struct {
	Name        string             `json:"name"`
	Group       string             `json:"group"` // core | audit | custom
	Variable    string             `json:"variable"`
	Share       float64            `json:"share"`
	Label       string             `json:"label,omitempty"`
	Unit        string             `json:"unit,omitempty"`
	Memberships map[string]float64 `json:"memberships"`
}

type Model struct {
	categories []string
	mu         map[string]map[string]float64
	features   []feature
	custom     map[string]CustomVariable
}

// Default: built-in model. Panics at start-up if the feature table and Mu disagree.
var Default = func() *Model {
	m, err := NewModel(nil)
	if err != nil {
		panic("knn: " + err.Error())
	}
	return m
}()

var customNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,47}$`)

// MaxCustomVariables bounds the size of a user model.
const MaxCustomVariables = 50

// NewModel: built-in variables plus the given custom ones (nil = built-in only).
func NewModel(custom []CustomVariable) (*Model, error) {
	if len(custom) > MaxCustomVariables {
		return nil, fmt.Errorf("variables: %d defined, max %d", len(custom), MaxCustomVariables)
	}
	m := &Model{
		categories: append([]string(nil), Categories...),
		mu:         make(map[string]map[string]float64, len(Mu)+len(custom)),
		features:   append([]feature(nil), features...),
		custom:     make(map[string]CustomVariable, len(custom)),
	}
	for v, row := range Mu {
		m.mu[v] = copyMap(row)
	}
	builtinDims := make(map[string]bool, len(features))
	for _, f := range features {
		builtinDims[f.Name] = true
	}
	okCat := make(map[string]bool, len(Categories))
	for _, c := range Categories {
		okCat[c] = true
	}
	for i, cv := range custom {
		path := fmt.Sprintf("variables[%d]", i)
		if !customNameRe.MatchString(cv.Name) {
			return nil, fmt.Errorf("%s.name %q: use lowercase letters, digits and _ (max 48), starting with a letter", path, cv.Name)
		}
		if _, seen := m.custom[cv.Name]; seen {
			return nil, fmt.Errorf("%s.name %q: defined twice", path, cv.Name)
		}
		if _, builtin := m.mu[cv.Name]; builtin || builtinDims[cv.Name] {
			return nil, fmt.Errorf("%s.name %q: collides with a built-in variable", path, cv.Name)
		}
		if err := validateVector(cv.Memberships, okCat, path+".memberships", true); err != nil {
			return nil, err
		}
		name := cv.Name
		m.mu[name] = copyMap(cv.Memberships)
		m.custom[name] = cv
		m.features = append(m.features, feature{
			Name: name, Group: "custom", MuVar: name, Share: 1,
			Get: func(r *jsonParser.Region) *float64 { return r.CustomVariables[name] },
		})
	}
	if err := m.validateFeatureMapping(); err != nil {
		return nil, err
	}
	return m, nil
}

func copyMap(in map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// IsCustomVariable reports whether name is a user-defined variable of this model.
func (m *Model) IsCustomVariable(name string) bool {
	_, ok := m.custom[name]
	return ok
}

// CustomVariables returns the user-defined variables, in definition (vector) order.
func (m *Model) CustomVariables() []CustomVariable {
	out := make([]CustomVariable, 0, len(m.custom))
	for _, f := range m.features {
		if f.Group == "custom" {
			out = append(out, m.custom[f.Name])
		}
	}
	return out
}

// Features describes every dimension of the model, in vector order.
func (m *Model) Features() []FeatureInfo {
	out := make([]FeatureInfo, len(m.features))
	for i, f := range m.features {
		fi := FeatureInfo{Name: f.Name, Group: f.Group, Variable: f.MuVar, Share: f.Share, Memberships: copyMap(m.mu[f.MuVar])}
		if cv, ok := m.custom[f.MuVar]; ok {
			fi.Label, fi.Unit = cv.Label, cv.Unit
		}
		out[i] = fi
	}
	return out
}

// Report: F1/F2′ diagnostics of a demand profile over this model's variables.
func (m *Model) Report(profile map[string]float64) (WeightReport, error) {
	return ComputeWeights(profile, m.mu, m.categories)
}

// Weights: per-dimension weight vector (FeatureNames order) for a demand profile.
// A nil profile means "no mission": every variable weighs the same.
func (m *Model) Weights(profile map[string]float64) (Vector, error) {
	if profile == nil {
		return m.expand(m.uniformPerVar(), m.FeatureNames())
	}
	rep, err := m.Report(profile)
	if err != nil {
		return nil, err
	}
	return m.expand(reportPerVar(rep), m.FeatureNames())
}

// ValidateProfile checks a mission demand profile without computing anything.
func ValidateProfile(profile map[string]float64) error {
	ok := make(map[string]bool, len(Categories))
	for _, c := range Categories {
		ok[c] = true
	}
	if profile == nil {
		return errors.New("demand: missing")
	}
	return validateVector(profile, ok, "demand", false)
}