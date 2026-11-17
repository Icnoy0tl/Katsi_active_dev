# Katsi

**Mission-specific Earth analogs for Moon and Mars surface tests**
NASA Space Apps Challenge 2026 · Local event: Puebla, Mexico · Team **Hackanenes**
Challenge: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*

> A terrestrial site is an analog only for a specific engineering test, and every analog fails somewhere. Katsi ranks Earth sites against a lunar or Martian target **for one test at a time** and reports where each analogy breaks and in which direction.

---

## Why

Teams test hardware at Earth analog sites before flying it, but a site's own conditions shape the results (Watson & Blaisdell, 2000), and no place on Earth reproduces the Moon or Mars completely (Preston & Dartnell, 2014). Documented cases show the risk:

| Failure class | Case | What the Earth test missed |
| --- | --- | --- |
| Mobility | Spirit (2009) | Extrication tests ran under Earth gravity; Earth gravity makes test soil stiffer, so traction is overestimated (JPL, 2009; Hu et al., 2025). |
| Ground interaction | InSight HP³ (2019–2021) | Soil cohesion of 4–25 kPa versus ≤ 1 kPa assumed in testing (Spohn et al., 2022). |
| Navigation | HAKUTO-R M1 (2023) | A 3 km crater rim made the software reject a valid altitude reading (ispace, 2023). |
| Environmental survival | Opportunity (2018), Apollo | Global dust storm; abrasive lunar dust (JPL, 2019; Gaier, 2005). |

## What it does

Pick a Moon or Mars region and a mission. Katsi returns:

- the **three closest Earth sites** out of 15 analog sites;
- a **per-variable breakdown**: how compatible each variable is and how much of the distance it explains;
- a **robustness analysis**: whether the ranking survives ±20 % changes to the mission profile;
- an **extrapolation report**: the target conditions that no Earth site reproduces.

| Mission | `filter` | What it weighs |
| --- | --- | --- |
| Mobility | `mobility` | Slope, rocks, soil mechanics |
| Navigation | `perception` | Line of sight, visual texture, low-sun shadows, illumination |
| Environmental survival | `environmental_survival` | Thermal cycle, energy, pressure, wind |
| Free | *(empty)* | Every variable weighs the same |

### Results on the current catalog (90 target–mission runs)

- For **25 of 30** targets, the best Earth analog changes with the mission; for 16, each mission picks a different site.
- The best analog survives **94.9 %** of profile perturbations on average.
- All **15 lunar targets** are dominated by extrapolation under environmental survival: more than half of what that mission needs does not exist on Earth.

## How it works

Each region is a vector of 26 dimensions (25 variables in 7 categories: terrain geometry, soil mechanics, volatiles, thermal, energy, atmosphere, navigation).

**Mission weights.** Each variable $j$ has a type $\mu_{jc}$ over the categories, and each mission a demand profile $\tilde d_c$. The weights are the unique allocation closest to $\mu$ (minimum Kullback–Leibler divergence) that gives each category exactly its demand:

$$
w_j=\sum_c \frac{\mu_{jc}\,\tilde d_c}{n_c},\qquad n_c=\sum_j \mu_{jc},\qquad \sum_j w_j = 1 .
$$

**Normalization and projection.** Columns are min–max normalized with the Earth catalog only, and the target is clamped to the Earth range first, so conditions no Earth site can match do not dominate the ranking. They are reported separately instead.

**Distance with missing data** (Gower, 1971), with $O$ the dimensions observed in both regions:

$$
d(a,b)=\sqrt{\frac{W}{W_O}\sum_{i\in O} w_i(\hat a_i-\hat b_i)^2},\qquad \text{coverage}=\frac{W_O}{W},\qquad \text{similarity}=1-\frac{d}{\sqrt W}.
$$

**Extrapolation.** A variable is flagged when the target lies more than 10 % of the Earth range outside it; the result is *dominated* when flagged variables carry at least half of the mission weight.

Full derivations, proofs and limitations are in the [technical documentation](./katsi_documentacion.pdf).

## Data and verification

The catalog has 15 Earth, 15 Moon and 15 Mars regions. Initial values are **compiled estimates** drafted with AI assistance; we then checked them against official sources and replaced what we could:

| Tier | Meaning | Values |
| --- | --- | --- |
| A | Official value for that site or landing ellipse | 19 |
| B | Official value for the whole body or terrain class | 121 |
| C | Calculated from an official constant (e.g. solar irradiance) | 9 |
| \* | Not officially confirmed (estimate or assumption) | 955 |

149 of 1,104 values are confirmed (MER, InSight, MSL, Perseverance MEDA, LRO Diviner, NASA NSSDC, NASA Ames). Every value carries its source, or the process that produced it, in `*_fuentes.jsonc`. Values with no reliable source, such as Martian salinity, are left empty, never invented.

Two scripts replace estimates with official data on any machine with internet access: `fetch_earth_apis.py` (NASA POWER, MODIS NDVI, SRTM) and `raster_tools.py` (LOLA, MOLA, Diviner and TES GeoTIFFs: slope, ruggedness, shadows, line of sight with body curvature, zonal means).

## Run it locally

Requirements: Go 1.22+, Python 3 (only to serve the static files), a browser with WebGL.

```bash
git clone https://github.com/lisardowo/Nasa-Space-App.git
cd Nasa-Space-App/backend
go run .                      # API on http://localhost:8080

# second terminal, from the repository root
python3 -m http.server 5500   # open http://localhost:5500
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADDR` | `:8080` | Listen address |
| `DATA_DIR` | `data` | Folder with `earth.json`, `moon.json`, `mars.json` |
| `ALLOWED_ORIGIN` | empty | CORS origin; empty accepts any `localhost` |

Deployment: `render.yaml` creates the Go API and the static site as two Render services and forwards `/api/*` to the API.

## API: built for professional missions, companies, startups and universities

Katsi is an API first; the 3D interface is one of its clients. The same engine that ranks the built-in catalog also accepts **your own regions, your own variables and your own mission types**. The weights for whatever you upload are computed with the same mathematics (Section *How it works*), so a custom analysis is as unbiased and auditable as a built-in one.

### Who it is for

| User | Typical use |
| --- | --- |
| Professional mission teams | Pre-screen analog sites for a specific test campaign, and document in design reviews what each Earth test cannot demonstrate (the extrapolation report). |
| Companies and startups | Rank their own test facilities against a customer's target site, and define product-specific missions (for example, a CubeSat lander's power and thermal test). |
| Universities and student teams | Pick the one field campaign a budget allows, compare their campus test field with established analogs, and add research catalogs of their own sites. |

### Three levels of use

**1. Built-in catalog and missions (no setup).** 15 Earth analogs, 30 Moon and Mars targets, and three missions.

```bash
curl "http://localhost:8080/api/analog?planet=moon&regionId=MOON-001&filter=mobility"
curl "http://localhost:8080/api/regions?planet=mars&filter=environmental_survival"
```

**2. Your own regions and mission profile, per request.** Send a region (any of the 25 variables; missing ones may be omitted or `null`) and a mission, either a built-in name or a demand profile over the seven categories. Nothing is stored.

```bash
curl -X POST http://localhost:8080/api/analog/custom -H "Content-Type: application/json" -d '{
  "characteristics": { "planet": "mars", "regions": [ { "regionId": "USER-MARS-01", "name": "Arcadia plains",
                        "coordinates": { "latitude": 46.2, "longitude": -167.5 },
                        "coreVariables": { "slope": 2.0, "insolation": 110 },
                        "auditVariables": { "surface_pressure_kpa": 0.8 } } ] },
  "mission": { "name": "Ice prospecting rover", "profile": { "VOL": 0.4, "MEC": 0.3, "GEO": 0.2, "NAV": 0.1 } }
}'
```

**3. Own-data mode: your variables, regions and missions.** Start the server with `--own-regions` and upload two files. Uploads are validated (every error is reported with its JSON path), kept in memory only, and replaced by the next upload of the same kind.

```bash
go run . --own-regions
curl -X POST http://localhost:8080/api/custom/regions  -H "Content-Type: application/json" --data @regions.json
curl -X POST http://localhost:8080/api/custom/missions -H "Content-Type: application/json" --data @missions.json
curl -X POST http://localhost:8080/api/calculate -H "Content-Type: application/json" \
     -d '{"misiones":{"filter":"cubesat_lander"},"caracteristicas":{"planet":"mars","regionId":"USER-MARS-01"}}'
```

`regions.json` can define **new variables**, each with its type over the seven categories, and regions that use them. Moon and Mars regions become new targets; Earth regions join the analog catalog, so a company's or university's own test field competes with the built-in sites.

```json
{
  "planet": "mars",
  "variables": [ { "name": "radiation_msv_day", "label": "Surface radiation", "unit": "mSv/day",
                   "memberships": { "ENE": 0.7, "TER": 0.3 } } ],
  "regions": [
    { "regionId": "USER-MARS-01", "name": "Arcadia ice-rich plains", "...": "...",
      "customVariables": { "radiation_msv_day": 0.67 } },
    { "planet": "earth", "regionId": "USER-EARTH-01", "name": "Our university test field", "...": "...",
      "customVariables": { "radiation_msv_day": 0.002 } }
  ]
}
```

`missions.json` defines named missions as demand profiles:

```json
{ "missions": [ { "id": "cubesat_lander", "name": "CubeSat lander power and thermal test",
                  "demand": { "ENE": 0.4, "TER": 0.3, "GEO": 0.2, "MEC": 0.1 } } ] }
```

With these two files, the CubeSat mission on the Arcadia target ranks the Qaidam Basin and Dasht-e Lut first, with the university's own field third, and the breakdown includes the new radiation variable with its weight.

### Why custom inputs stay unbiased

- **A new variable does not inflate its category.** Weights follow $w_j=\sum_c \mu_{jc}\tilde d_c/n_c$: adding a variable to category $c$ raises $n_c$, so the category still receives exactly the share $\tilde d_c$ that the mission demands, now split among more variables.
- **Missing data are never invented.** If the Earth catalog has no values for a new variable, it is reported as missing and lowers the coverage instead of adding a made-up distance.
- **Out-of-range values do not dominate.** Targets are projected to the Earth range, and what Earth cannot reproduce is listed in the extrapolation report.
- **Bad inputs fail loudly.** Unknown categories (for example `"GEOO"`), memberships that do not sum to 1, negative or non-finite values, and zero-demand missions are rejected with an explanation, never silently accepted.

### All endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Health check |
| `GET /api/catalog` | Categories, variables (built-in and custom), missions with weight reports, counts per planet, capabilities |
| `GET /api/analog?planet=&regionId=&filter=` | Top-3 Earth analogs with per-variable breakdown, robustness analysis and extrapolation report |
| `GET /api/regions?planet=&filter=` | Terrains of a body ranked by their best Earth analog for a mission |
| `POST /api/analog/custom` | Analogs for regions and a mission sent in the request |
| `POST /api/calculate` | Analogs for any built-in or uploaded region and mission |
| `GET /api/missions`, `GET /api/filters` | Weight reports of each mission: weights, affinities, $N_{\text{ef}}$, $N^*$ |
| `POST /api/custom/regions`, `POST /api/custom/missions` | Upload your regions and variables, or your missions (own-data mode) |
| `GET /api/custom`, `DELETE /api/custom` | See or clear what is loaded (own-data mode) |

Ready-to-use example files are in `frontend/examples/`.

### Statistical weight scripts (Python)

`backend/python` contains an independent reference implementation of the weighting, so anyone can compute and audit the weights for their own mission profile without running the server:

- **`weights_mision.py`** computes, for any profile and set of variable types, the affinity of each variable (dot product and cosine between its type and the mission profile), the Shannon entropy and effective number of variables $N_{\text{ef}}=e^{H(w)}$, and the weights from a numerically stable softmax whose inverse temperature $\beta$ is calibrated by bisection so that $N_{\text{ef}}$ reaches the maximum-entropy target $N^*=n\,e^{H(d)}/C$. Only the standard library is needed.
- **`tests_weights.py`** runs 4,000 random cases plus degenerate and invalid inputs, checks the identity $dH/d\beta=-\beta\,\mathrm{Var}_w(r)$, and verifies the properties of the deployed F2' allocation (weights sum to 1, category fidelity, scale and permutation invariance, empty categories).
- The Go test suite reads `golden_python.json`, produced by the Python code, and fails if the two implementations ever disagree on affinities, $N^*$ or F2' weights.

```python
from weights_mision import factors
report = factors({"ENE": 0.4, "TER": 0.3, "GEO": 0.2, "MEC": 0.1})   # your mission profile
print(report["effective_n"], report["angle_deg"])
for name, v in report["variables"].items():
    print(name, round(v["weight"], 3), round(v["affinity"], 3))
```

```bash
cd backend/python
python3 weights_mision.py    # weight reports of the built-in missions (JSON)
python3 tests_weights.py     # must end with "FAILURES: 0"
```

## Tests

```bash
cd backend
go test ./...                          # distance, weights, breakdown, HTTP contract, real-data snapshot
cd python && python3 tests_weights.py  # property and fuzz tests of the weight model
```

## Project structure

```
backend/
  main.go, regions.go, custom.go   HTTP server and endpoints
  jsonParser/                      sanitizing catalog reader
  knn/                             weights, normalization, distance, breakdown, robustness
  data/                            earth.json, moon.json, mars.json
  python/                          reference implementation and tests of the weight model
frontend/js/                       Three.js scene, panels, API client
index.html
```

## Use of AI

We used Claude (Anthropic) to help write and review the Go backend, develop the weighting mathematics and its tests, organize the region catalogs, draft the initial data values as estimates, verify them against published sources, write the data-extraction tools, and draft the documentation. The AI is not the source of any confirmed value: those come from the publications cited in the catalog. The team reviewed and ran all code and is responsible for the content. Details and prompts are in Section 10 of the documentation...

## References (selection)

- Gaier, J. R. (2005). *The effects of lunar dust on EVA systems during the Apollo missions*. NASA/TM-2005-213610.
- Golombek, M. P., et al. (2005). Assessment of Mars Exploration Rover landing site predictions. *Nature*, 436, 44–48.
- Golombek, M., et al. (2017). Selection of the InSight landing site. *Space Science Reviews*, 211, 5–95.
- Gower, J. C. (1971). A general coefficient of similarity and some of its properties. *Biometrics*, 27(4), 857–871.
- Hayne, P. O., et al. (2017). Global regolith thermophysical properties of the Moon from the Diviner Lunar Radiometer Experiment. *JGR Planets*, 122, 2371–2400.
- Hu, W., et al. (2025). A study demonstrating that using gravitational offset to prepare extraterrestrial mobility missions is misleading. *Journal of Field Robotics*. https://doi.org/10.1002/rob.22597
- ispace (2023, May 26). *Results of the HAKUTO-R Mission 1 lunar landing*. https://ispace-inc.com/news-en/?p=4691
- Preston, L. J., & Dartnell, L. R. (2014). Planetary habitability: Lessons learned from terrestrial analogues. *International Journal of Astrobiology*, 13(1), 81–98.
- Spohn, T., et al. (2022). The InSight-HP³ mole on Mars: Lessons learned. *Advances in Space Research*, 69(8), 3140–3163.
- Watson, J. K., & Blaisdell, G. L. (2000). *Salient characteristics for terrestrial analog engineering test sites*. NTRS 20000105009.

The full reference list (46 sources) is in the documentation.
