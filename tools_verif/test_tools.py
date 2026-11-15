"""Offline tests for terrain.py, raster_tools.py and fetch_earth_apis.py.

No network: the HTTP layer is replaced by a fake that mimics the documented
response shapes. Run:  python test_tools.py
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
import rasterio
from rasterio.transform import from_origin

import fetch_earth_apis as fe
from terrain import horn_slope_aspect, line_of_sight_pct, low_sun_shadow_pct, shadow_mask, summarize, vrm

fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


# ---------------------------------------------------------------- terrain.py
def plane(n, cell, deg, azimuth_deg=0.0):
    yy, xx = np.indices((n, n)) * cell
    a = math.radians(azimuth_deg)
    return math.tan(math.radians(deg)) * (xx * math.cos(a) + yy * math.sin(a))


for deg in (1, 5, 15, 30):
    for az in (0, 45, 90, 200):
        s = summarize(plane(21, 90.0, deg, az), 90.0)
        check(abs(s["slope_mean_deg"] - deg) < 0.01, f"plane {deg} deg az {az}: slope {s['slope_mean_deg']:.3f}")
        check(s["vrm_mean"] < 1e-9, f"plane {deg} deg az {az}: VRM ~ 0 ({s['vrm_mean']:.2e})")

rng = np.random.default_rng(1)
rough = rng.normal(0, 8.0, (21, 21))
smooth = rng.normal(0, 0.2, (21, 21))
check(summarize(rough, 90)["vrm_mean"] > summarize(smooth, 90)["vrm_mean"] * 20, "VRM rises with roughness")
check(summarize(rough, 90)["slope_mean_deg"] > summarize(smooth, 90)["slope_mean_deg"], "slope rises with roughness")

# ---------------------------------------------------------------- raster_tools.py (CLI end to end)
HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()


def run_cli(*args):
    r = subprocess.run([sys.executable, os.path.join(HERE, "raster_tools.py"), *args],
                       capture_output=True, text=True, cwd=HERE)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return json.loads(r.stdout)


def write_tif(path, arr, crs, transform):
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
                       dtype="float32", crs=crs, transform=transform, nodata=-9999.0) as dst:
        dst.write(arr.astype("float32"), 1)


# (a) Mars sphere, projected in metres, longitudes 0..360 (east positive)
R_MARS = 3396190.0
crs_m = f"+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=180 +x_0=0 +y_0=0 +R={R_MARS} +units=m +no_defs"
n, cell = 400, 100.0
x0, y_top = -20000.0, 20000.0
yy, xx = np.indices((n, n))
x_m = x0 + xx * cell
plane_m = math.tan(math.radians(4.0)) * x_m
p1 = os.path.join(tmp, "mars_dem.tif")
write_tif(p1, plane_m, crs_m, from_origin(x0, y_top, cell, cell))
# lon_0=180: x=0 is lon 180; ask using 0..360 and -180..180 forms of the same point
r360 = run_cli("slope", "--raster", p1, "--lat", "0.05", "--lon", "180.05", "--radius-km", "3")
check(abs(r360["slope_mean_deg"] - 4.0) < 0.05, f"Mars projected DEM slope = {r360['slope_mean_deg']:.3f} (expected 4.0)")
rneg = run_cli("slope", "--raster", p1, "--lat", "0.05", "--lon", "-179.95", "--radius-km", "3")
check(abs(rneg["slope_mean_deg"] - 4.0) < 0.05, "longitude given as -179.95 works the same as 180.05")

# (b) Moon, geographic CRS (degrees), custom sphere
R_MOON = 1737400.0
crs_g = f"+proj=longlat +R={R_MOON} +no_defs"
dlt = 0.005                                    # deg  ~ 151 m at the equator
ng = 300
west, north = 10.0, 1.0
lat_g = north - (np.arange(ng) + 0.5) * dlt
lon_g = west + (np.arange(ng) + 0.5) * dlt
LON, LAT = np.meshgrid(lon_g, lat_g)
east_m = np.radians(LON - west) * R_MOON * np.cos(np.radians(LAT))
dem_g = math.tan(math.radians(3.0)) * east_m
p2 = os.path.join(tmp, "moon_dem.tif")
write_tif(p2, dem_g, crs_g, from_origin(west, north, dlt, dlt))
rg = run_cli("slope", "--raster", p2, "--lat", "0.25", "--lon", "10.75", "--radius-km", "5")
check(abs(rg["slope_mean_deg"] - 3.0) < 0.1, f"Moon geographic DEM slope = {rg['slope_mean_deg']:.3f} (expected 3.0)")
check(rg["vrm_mean"] < 1e-3, f"Moon plane VRM ~ 0 ({rg['vrm_mean']:.2e})")

# (c) zonal statistics on a categorical-looking map (value 7 inside a patch, 1 outside)
val = np.ones((n, n))
val[150:250, 150:250] = 7.0                    # the central 10 km x 10 km patch
p3 = os.path.join(tmp, "rock.tif")
write_tif(p3, val, crs_m, from_origin(x0, y_top, cell, cell))
rz = run_cli("zonal", "--raster", p3, "--lat", "0.0", "--lon", "180.0", "--radius-km", "3")
check(abs(rz["mean"] - 7.0) < 1e-6, f"zonal mean inside patch = {rz['mean']}")
rz2 = run_cli("zonal", "--raster", p3, "--lat", "0.0", "--lon", "180.0", "--radius-km", "9")
check(1.0 < rz2["mean"] < 7.0, f"zonal mean straddling the patch edge is between ({rz2['mean']:.2f})")
try:
    run_cli("zonal", "--raster", p3, "--lat", "60.0", "--lon", "180.0", "--radius-km", "3")
    check(False, "point outside the raster must fail")
except RuntimeError as e:
    check("outside the raster" in str(e), "point outside the raster gives a clear error")

# ---------------------------------------------------------------- horizon metrics (terrain.py)
nh, ch = 121, 100.0                            # 12 km grid of 100 m cells
yy, xx = np.indices((nh, nh))
east_up = math.tan(math.radians(10.0)) * xx * ch      # rises toward the east at 10 deg
mid = (60, 60)
sm = shadow_mask(east_up, ch, 5.0, 90.0, 3000.0)
check(sm[40:80, 20:80].all(), "shadow: slope of 10 deg facing away from a 5 deg sun is all shadowed")
check(not shadow_mask(east_up, ch, 15.0, 90.0, 3000.0)[40:80, 20:80].any(), "shadow: same slope under a 15 deg sun has no shadow")
check(not shadow_mask(east_up, ch, 5.0, 270.0, 3000.0)[40:80, 40:100].any(), "shadow: sun from the west lights the whole slope")
flat = np.zeros((nh, nh))
check(low_sun_shadow_pct(flat, ch, mid, 2500.0) == 0.0, "shadow: flat ground has 0 % shadow")
check(abs(line_of_sight_pct(flat, ch, mid, 5000.0, 2.0, None) - 100.0) < 1e-9, "line of sight: flat ground, no curvature, 100 %")
R_MOON_T = 1737400.0
d_h = math.sqrt(2 * R_MOON_T * 2.0)            # horizon of a 2 m mast on the Moon, ~2.64 km
exp = 100.0 * (d_h / 5000.0) ** 2
los_moon = line_of_sight_pct(flat, ch, mid, 5000.0, 2.0, R_MOON_T)
check(abs(los_moon - exp) < 3.0, f"line of sight: flat Moon sphere {los_moon:.1f} % (expected ~{exp:.1f} %, horizon {d_h:.0f} m)")
bump = flat.copy(); bump[55:66, 70:73] = 50.0  # a 50 m wall 1-1.3 km east of the site
los_b = line_of_sight_pct(bump, ch, mid, 5000.0, 2.0, None)
check(los_b < 99.0, f"line of sight: a wall hides the ground behind it ({los_b:.1f} %)")
for tilt in (5.0, 20.0):                       # a straight slope never hides itself
    for az in (0.0, 37.0, 90.0):
        a_ = math.radians(az)
        pl = math.tan(math.radians(tilt)) * ch * (xx * math.sin(a_) - yy * math.cos(a_))
        lp = line_of_sight_pct(pl, ch, mid, 5000.0, 2.0, None)
        check(lp > 99.0, f"line of sight: straight {tilt:.0f} deg slope (azimuth {az:.0f}) fully visible ({lp:.1f} %)")

# ---------------------------------------------------------------- latitude correction and horizon CLI
# (d) Mars equirectangular projection in metres, at 60 N: true east-west cell = 100 m x cos(60)
lat0 = 60.0
y_top2 = math.radians(lat0 + 0.2) * R_MARS

yy2, xx2 = np.indices((n, n))
x_proj = x0 + xx2 * cell
y_proj = y_top2 - yy2 * cell
lat_cells = np.degrees(y_proj / R_MARS)
dem_hl = math.tan(math.radians(4.0)) * x_proj * np.cos(np.radians(lat_cells))
p4 = os.path.join(tmp, "mars_dem_60N.tif")
write_tif(p4, dem_hl, crs_m, from_origin(x0, y_top2, cell, cell))
lat_c = math.degrees((y_top2 - 200 * cell) / R_MARS)
rhl = run_cli("slope", "--raster", p4, "--lat", f"{lat_c:.5f}", "--lon", "180.0", "--radius-km", "3")
check(abs(rhl["slope_mean_deg"] - 4.0) < 0.15, f"equirectangular DEM at 60 N: slope {rhl['slope_mean_deg']:.3f} (expected 4.0; latitude-corrected)")

# (e) Moon geographic DEM at 60 S, plane tilted 3 deg in true ground distance
north2 = -59.0
lat_g2 = north2 - (np.arange(ng) + 0.5) * dlt
LON2, LAT2 = np.meshgrid(lon_g, lat_g2)
dem_g2 = math.tan(math.radians(3.0)) * np.radians(LON2 - west) * R_MOON * np.cos(np.radians(LAT2))
p5 = os.path.join(tmp, "moon_dem_60S.tif")
write_tif(p5, dem_g2, crs_g, from_origin(west, north2, dlt, dlt))
rg2 = run_cli("slope", "--raster", p5, "--lat", "-59.75", "--lon", "10.75", "--radius-km", "5")
check(abs(rg2["slope_mean_deg"] - 3.0) < 0.15, f"geographic DEM at 60 S: slope {rg2['slope_mean_deg']:.3f} (expected 3.0)")

# (f) horizon CLI on a flat Moon DEM: curvature taken from the file's CRS
p6 = os.path.join(tmp, "moon_flat.tif")
write_tif(p6, np.zeros((ng, ng)), crs_g, from_origin(west, north, dlt, dlt))
rh = run_cli("horizon", "--raster", p6, "--lat", "0.25", "--lon", "10.75", "--radius-km", "5")
check(abs(rh["body_radius_m"] - R_MOON) < 1, "horizon CLI: body radius read from the raster CRS")
check(rh["low_sun_shadows_pct"] == 0.0, "horizon CLI: flat ground has no shadow")
check(abs(rh["line_of_sight_pct"] - exp) < 4.0, f"horizon CLI: flat Moon line of sight {rh['line_of_sight_pct']:.1f} % (expected ~{exp:.1f} %)")
rh2 = run_cli("horizon", "--raster", p6, "--lat", "0.25", "--lon", "10.75", "--radius-km", "5", "--no-curvature")
check(abs(rh2["line_of_sight_pct"] - 100.0) < 1e-9, "horizon CLI: --no-curvature on flat ground gives 100 %")

# ---------------------------------------------------------------- fetch_earth_apis.py with a fake HTTP layer
TILT = 5.0


class FakeResp:
    def __init__(self, data, code=200):
        self._d, self.status_code, self.text = data, code, json.dumps(data)

    def json(self):
        return self._d


class FakeSession:
    def __init__(self):
        self.calls = []

    def get(self, url, params=None, timeout=None, headers=None):
        self.calls.append((url, params, headers))
        if "modis.ornl" in url:
            s0, s1 = int(params["startDate"][5:]), int(params["endDate"][5:])
            year = params["startDate"][1:5]
            doys = [d for d in range(1, 366, 16) if s0 <= d <= s1]
            # 9 pixels per date: six valid (NDVI 0.20 or 0.30) and three fill values
            sub = [{"band": "250m_16_days_NDVI", "modis_date": f"A{year}{d:03d}",
                    "data": [2000, 3000, 2000, 3000, 2000, 3000, -3000, -3000, -3000]} for d in doys]
            return FakeResp({"band": "250m_16_days_NDVI", "subset": sub})
        if "power.larc" in url:
            names = params["parameters"].split(",")
            vals = {"PS": 90.1, "WS10M": 4.2, "WS10M_MAX": 9.0, "ALLSKY_SFC_SW_DWN": 6.48,
                    "ALLSKY_SFC_SW_DIFF": 1.30, "ALLSKY_SRF_ALB": 0.31, "AOD_55": -999,
                    "TS_MAX": 38.5, "TS_MIN": 6.0, "T2M_RANGE": 17.0}
            return FakeResp({"properties": {"parameter": {k: {"ANN": vals[k]} for k in names}}})
        if "rest.isric" in url:
            d = dict(params)
            layers = [{"name": nme, "unit_measure": {"d_factor": 10},
                       "depths": [{"label": "0-5cm", "values": {"mean": raw}}]}
                      for nme, raw in (("sand", 800), ("silt", 100), ("clay", 100))]
            return FakeResp({"properties": {"layers": layers}})
        if "opentopodata" in url:
            if "aster30m" in url:
                return FakeResp({"status": "OK", "results": [{"elevation": None} for _ in params["locations"].split("|")]})
            res = []
            for item in params["locations"].split("|"):
                la, lo = map(float, item.split(","))
                east = math.radians(lo - (-70.0)) * 6371000.0 * math.cos(math.radians(la))
                res.append({"elevation": 2000.0 + math.tan(math.radians(TILT)) * east})
            return FakeResp({"status": "OK", "results": res})
        return FakeResp({}, 404)


fake = FakeSession()
fe.SESSION = fake
fe.SLEEP = 0
earth = {"regions": [{"regionId": "EARTH-001", "name": "Test site", "coordinates": {"latitude": -24.1, "longitude": -70.0},
                      "coreVariables": {"slope": 3.0, "insolation": 270, "dust_aerosols": 0.05},
                      "auditVariables": {"surface_pressure_kpa": 90.0, "wind_typical_ms": 4, "wind_gust_ms": 15,
                                         "diffuse_ratio": 0.2, "albedo": 0.28, "grain_size_um": 300, "vrm_microrelief": 0.003}}]}
ep = os.path.join(tmp, "earth.json")
json.dump(earth, open(ep, "w"))
before = open(ep).read()
out = os.path.join(tmp, "out")
fe.main(["--earth", ep, "--out-dir", out, "--apply"])
f = json.load(open(os.path.join(out, "earth_fetched.json")))["EARTH-001"]
check(abs(f["surface_pressure_kpa"]["value"] - 90.1) < 1e-9, "POWER: pressure parsed")
check(abs(f["insolation"]["value"] - 6.48 * 1000 / 24) < 1e-9, f"POWER: insolation {f['insolation']['value']:.1f} W/m2 = kWh/m2/day x 1000/24")
check(abs(f["diffuse_ratio"]["value"] - 1.30 / 6.48) < 1e-9, "POWER: diffuse ratio = DIFF/DWN")
check("dust_aerosols" not in f, "POWER: -999 fill value is treated as missing")
check(abs(f["slope"]["value"] - TILT) < 0.05, f"Topo: slope {f['slope']['value']:.3f} (expected {TILT}); aster30m nodata fell back to srtm30m")
check(f["vrm_microrelief"]["value"] < 1e-3, f"Topo: VRM of a plane ~ 0 ({f['vrm_microrelief']['value']:.2e})")
gm = math.exp(0.8 * math.log(1.025) + 0.1 * math.log(0.026) + 0.1 * math.log(0.001)) * 1000
check(abs(f["grain_size_um"]["value"] - gm) < 1e-6, f"SoilGrids: grain size {f['grain_size_um']['value']:.1f} um (expected {gm:.1f})")
check(abs(f["diurnal_thermal_range"]["value"] - 32.5) < 1e-9, "POWER: diurnal range = TS_MAX - TS_MIN (surface, preferred over air)")
check(abs(f["vegetation_ndvi"]["value"] - 0.25) < 1e-9, f"MODIS: NDVI {f['vegetation_ndvi']['value']:.3f} = mean of valid pixels x 0.0001, fill -3000 dropped")
modis_calls = [c for c in fake.calls if "modis.ornl" in c[0]]
check(len(modis_calls) == 3, f"MODIS: 23 composites asked in {len(modis_calls)} calls")
check(all((c[2] or {}).get("Accept") == "application/json" for c in modis_calls), "MODIS: Accept: application/json header sent")
spans = [len([d for d in range(1, 366, 16) if int(c[1]["startDate"][5:]) <= d <= int(c[1]["endDate"][5:])]) for c in modis_calls]
check(max(spans) <= 10, f"MODIS: never more than 10 dates per call ({spans})")
check(0.0 <= f["low_sun_shadows"]["value"] <= 100.0 and 0.0 <= f["line_of_sight"]["value"] <= 100.0,
      f"Topo horizon: shadows {f['low_sun_shadows']['value']:.1f} %, line of sight {f['line_of_sight']['value']:.1f} %")
check(f["low_sun_shadows"]["value"] < 50.0, "Topo horizon: a 5 deg plane under a 5 deg sun is mostly not shadowed")
topo_calls = [c for c in fake.calls if "opentopodata" in c[0]]
check(max(len(c[1]["locations"].split("|")) for c in topo_calls) <= 100, "Topo: never more than 100 locations per request")
check(open(ep).read() == before, "earth.json is not modified")
upd = json.load(open(os.path.join(out, "earth_updated.json")))["regions"][0]
check(abs(upd["coreVariables"]["slope"] - TILT) < 0.05 and "slope" in upd["provenance"], "earth_updated.json has new slope + provenance")
rows = list(__import__("csv").reader(open(os.path.join(out, "comparison.csv"))))
check(rows[0][:4] == ["regionId", "variable", "current_estimate", "fetched"] and len(rows) > 5, "comparison.csv written")

print("\nFAILURES:", len(fails))
sys.exit(1 if fails else 0)
