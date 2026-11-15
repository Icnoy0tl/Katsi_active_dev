#!/usr/bin/env python3
"""Replace estimated Earth values with values from FREE public APIs.

Sources (no keys needed)
  NASA POWER climatology  -> surface_pressure_kpa, wind_typical_ms, wind_gust_ms (proxy),
                             insolation, diffuse_ratio, albedo, dust_aerosols (AOD, optional),
                             diurnal_thermal_range (TS_MAX - TS_MIN, or T2M_RANGE if missing)
  NASA MODIS MOD13Q1      -> vegetation_ndvi (annual mean, ORNL DAAC subset web service)
  SoilGrids v2.0 (ISRIC)  -> grain_size_um (derived from sand/silt/clay, approximate)
  Open Topo Data (public) -> slope, vrm_microrelief (90 m grid of SRTM/ASTER elevations)
                             low_sun_shadows, line_of_sight (250 m grid, 10 km wide)

Usage
  python fetch_earth_apis.py --earth earth.json --out-dir out
  python fetch_earth_apis.py --earth earth.json --out-dir out --apply      # also write earth_updated.json

Outputs (in --out-dir)
  earth_fetched.json   every fetched value with source, method, unit, resolution, confidence
  comparison.csv       your current estimate vs the fetched value, with the % difference
  earth_updated.json   (only with --apply) a COPY of earth.json with fetched values and a
                       "provenance" block per region. earth.json is never modified.

Paste comparison.csv (and any "WARN" lines) back to Claude to review the differences.

What is NOT covered here (no free API): rock abundance, thermal inertia, soil moisture
as m3/m3, depth to bedrock, salinity, dielectric constant. See the guide.

Needs: pip install numpy requests
"""
import argparse
import copy
import csv
import json
import math
import os
import sys
import time

import numpy as np
import requests

from terrain import summarize

POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
MODIS_URL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"
SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
TOPO_URL = "https://api.opentopodata.org/v1/{dataset}"

SESSION = requests.Session()           # replaced by a fake in the tests
SLEEP = 1.1                            # polite pause between calls (seconds)
TOPO_CHUNK = 100                       # locations per request

EARTH_RADIUS_M = 6371000.0
FIELD_GROUP = {
    "slope": "coreVariables", "insolation": "coreVariables", "dust_aerosols": "coreVariables",
    "diurnal_thermal_range": "coreVariables", "low_sun_shadows": "coreVariables",
    "line_of_sight": "coreVariables", "vegetation_ndvi": "auditVariables",
    "vrm_microrelief": "auditVariables", "grain_size_um": "auditVariables", "albedo": "auditVariables",
    "diffuse_ratio": "auditVariables", "surface_pressure_kpa": "auditVariables",
    "wind_typical_ms": "auditVariables", "wind_gust_ms": "auditVariables",
}


# ------------------------------------------------------------------ http helper
def get_json(url, params=None, retries=4, timeout=60, headers=None):
    delay = 2.0
    last = None
    for _ in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout, headers=headers)
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code in (400, 404, 422):     # a request error: retrying will not help
                break
        except requests.RequestException as e:
            last = str(e)
        time.sleep(delay)
        delay *= 2
    raise RuntimeError(last or "unknown error")


# ------------------------------------------------------------------ NASA POWER
def fetch_power(lat, lon):
    """Return {PARAM: annual climatology value or None}."""
    base = {"community": "RE", "longitude": f"{lon:.4f}", "latitude": f"{lat:.4f}", "format": "JSON"}
    core = ["PS", "WS10M", "ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DIFF", "ALLSKY_SRF_ALB"]
    optional = ["WS10M_MAX", "AOD_55", "TS_MAX", "TS_MIN", "T2M_RANGE"]
    out = {}

    def ask(params):
        data = get_json(POWER_URL, dict(base, parameters=",".join(params)))
        block = data["properties"]["parameter"]
        for p in params:
            v = block.get(p, {}).get("ANN")
            out[p] = None if v is None or v <= -998 else float(v)

    try:
        ask(core)
    except Exception as e:                      # e.g. one unknown parameter: ask one by one
        print(f"  WARN POWER core request failed ({e}); retrying one parameter at a time")
        for p in core:
            try:
                time.sleep(SLEEP); ask([p])
            except Exception as e2:
                out[p] = None
                print(f"  WARN POWER {p}: {e2}")
    for p in optional:
        try:
            time.sleep(SLEEP); ask([p])
        except Exception as e:
            out[p] = None
            print(f"  WARN POWER {p}: {e}")
    return out


def power_to_variables(p):
    v = {}
    src = "NASA POWER climatology (annual mean), power.larc.nasa.gov"
    if p.get("PS") is not None:
        v["surface_pressure_kpa"] = (p["PS"], "kPa", src + ", parameter PS", "derived", "~0.5 deg grid")
    if p.get("WS10M") is not None:
        v["wind_typical_ms"] = (p["WS10M"], "m/s", src + ", parameter WS10M (10 m, annual mean)", "derived", "~0.5 deg grid")
    if p.get("WS10M_MAX") is not None:
        v["wind_gust_ms"] = (p["WS10M_MAX"], "m/s", src + ", parameter WS10M_MAX (PROXY: maximum of the climatology, not a true gust)", "derived", "~0.5 deg grid")
    if p.get("ALLSKY_SFC_SW_DWN") is not None:
        v["insolation"] = (p["ALLSKY_SFC_SW_DWN"] * 1000.0 / 24.0, "W/m2",
                           src + ", ALLSKY_SFC_SW_DWN (kWh/m2/day) x 1000/24 = mean W/m2", "derived", "~0.5 deg grid")
        if p.get("ALLSKY_SFC_SW_DIFF") is not None and p["ALLSKY_SFC_SW_DWN"] > 0:
            v["diffuse_ratio"] = (p["ALLSKY_SFC_SW_DIFF"] / p["ALLSKY_SFC_SW_DWN"], "ratio",
                                  src + ", ALLSKY_SFC_SW_DIFF / ALLSKY_SFC_SW_DWN", "derived", "~0.5 deg grid")
    if p.get("ALLSKY_SRF_ALB") is not None:
        v["albedo"] = (p["ALLSKY_SRF_ALB"], "ratio", src + ", ALLSKY_SRF_ALB", "derived", "~0.5 deg grid")
    if p.get("AOD_55") is not None:
        v["dust_aerosols"] = (p["AOD_55"], "optical depth", src + ", AOD_55 (all aerosols, not dust only)", "derived", "~0.5 deg grid")
    # Moon and Mars values are SURFACE temperature ranges, so the skin temperature is preferred.
    if p.get("TS_MAX") is not None and p.get("TS_MIN") is not None:
        v["diurnal_thermal_range"] = (p["TS_MAX"] - p["TS_MIN"], "K",
                                      src + ", TS_MAX - TS_MIN (earth skin temperature, mean daily max minus mean daily min)",
                                      "derived", "~0.5 deg grid")
    elif p.get("T2M_RANGE") is not None:
        v["diurnal_thermal_range"] = (p["T2M_RANGE"], "K",
                                      src + ", T2M_RANGE (AIR at 2 m, not surface: usually smaller than the surface range)",
                                      "derived", "~0.5 deg grid")
        print("  WARN TS_MAX/TS_MIN not returned: diurnal_thermal_range uses AIR temperature (T2M_RANGE)")
    return v


# ------------------------------------------------------------------ NASA MODIS NDVI (ORNL DAAC)
NDVI_BAND = "250m_16_days_NDVI"
NDVI_FILL = -3000
NDVI_SCALE = 0.0001                     # MOD13Q1 NDVI is stored x 10000


def fetch_ndvi(lat, lon, year, km=1):
    """Annual mean NDVI from the 23 MOD13Q1 composites of `year` (days 1, 17, ..., 353),
    averaged over a (2*km+1) km box. The service returns at most 10 dates per call."""
    doys = list(range(1, 366, 16))
    vals, n_dates = [], 0
    for k in range(0, len(doys), 10):
        chunk = doys[k:k + 10]
        params = {"latitude": f"{lat:.5f}", "longitude": f"{lon:.5f}", "band": NDVI_BAND,
                  "startDate": f"A{year}{chunk[0]:03d}", "endDate": f"A{year}{chunk[-1]:03d}",
                  "kmAboveBelow": km, "kmLeftRight": km}
        data = get_json(MODIS_URL, params, headers={"Accept": "application/json"})
        scale = float(data.get("scale") or NDVI_SCALE) if isinstance(data, dict) else NDVI_SCALE
        for item in data.get("subset", []):
            if item.get("band") not in (None, NDVI_BAND):
                continue
            raw = [x for x in item.get("data", []) if x is not None and x != NDVI_FILL and -2000 <= x <= 10000]
            if raw:
                n_dates += 1
                vals.extend(raw)
        time.sleep(SLEEP)
    if not vals:
        return None
    return float(np.mean(vals)) * scale, n_dates, len(vals)


def ndvi_to_variables(res, year, km):
    if res is None:
        return {}
    mean, n_dates, n_px = res
    return {"vegetation_ndvi": (mean, "NDVI", f"NASA MODIS MOD13Q1 v061 ({NDVI_BAND}) via ORNL DAAC web service: "
                                f"mean of {n_dates} 16-day composites of {year}, {n_px} valid 250 m pixels in a "
                                f"{2 * km + 1} km box", "derived", "250 m")}


# ------------------------------------------------------------------ SoilGrids
# Mean particle diameter (mm) of each USDA class, as used in Shirazi & Boersma (1984).
CLASS_MM = {"clay": 0.001, "silt": 0.026, "sand": 1.025}


def fetch_soilgrids(lat, lon):
    params = [("lon", f"{lon:.4f}"), ("lat", f"{lat:.4f}"), ("depth", "0-5cm"), ("value", "mean"),
              ("property", "sand"), ("property", "silt"), ("property", "clay")]
    data = get_json(SOILGRIDS_URL, params)
    out = {}
    for layer in data["properties"]["layers"]:
        name = layer["name"]
        d = (layer.get("unit_measure") or {}).get("d_factor") or 10
        try:
            raw = layer["depths"][0]["values"]["mean"]
        except (KeyError, IndexError):
            raw = None
        out[name] = None if raw is None else raw / d      # g/kg -> %
    return out


def soilgrids_to_variables(sg):
    if any(sg.get(k) is None for k in ("sand", "silt", "clay")):
        return {}
    total = sg["sand"] + sg["silt"] + sg["clay"]
    if total <= 0:
        return {}
    f = {k: sg[k] / total for k in ("sand", "silt", "clay")}
    dg_mm = math.exp(sum(f[k] * math.log(CLASS_MM[k]) for k in f))
    return {"grain_size_um": (dg_mm * 1000.0, "um",
                              f"SoilGrids v2.0, 0-5 cm: sand {sg['sand']:.0f}%, silt {sg['silt']:.0f}%, clay {sg['clay']:.0f}% -> geometric mean diameter (Shirazi & Boersma 1984). APPROXIMATE: a texture-class mean, not a measured grain size",
                              "derived", "250 m")}


# ------------------------------------------------------------------ Open Topo Data
def grid_points(lat, lon, half=5, step_m=90.0):
    """(2*half+1)^2 points, north-to-south rows, west-to-east columns."""
    dlat = step_m / 111320.0
    dlon = step_m / (111320.0 * max(math.cos(math.radians(lat)), 1e-6))
    pts = []
    for i in range(-half, half + 1):            # i = +half is NORTH
        for j in range(-half, half + 1):
            pts.append((lat - i * dlat, lon + j * dlon))
    n = 2 * half + 1
    return pts, n


def fetch_elevations(pts, dataset):
    out = []
    for k in range(0, len(pts), TOPO_CHUNK):
        chunk = pts[k:k + TOPO_CHUNK]
        loc = "|".join(f"{la:.6f},{lo:.6f}" for la, lo in chunk)
        data = get_json(TOPO_URL.format(dataset=dataset), {"locations": loc, "interpolation": "bilinear"})
        if data.get("status") != "OK":
            raise RuntimeError(f"{dataset}: {data.get('error')}")
        out.extend([r["elevation"] for r in data["results"]])
        time.sleep(SLEEP)
    return out


def fetch_horizon(lat, lon, datasets, half=20, step_m=250.0):
    """low_sun_shadows and line_of_sight from a (2*half+1)^2 grid (default 41 x 41 at
    250 m = 10 km wide), the same definitions as raster_tools.py horizon."""
    from terrain import line_of_sight_pct, low_sun_shadow_pct
    pts, n = grid_points(lat, lon, half, step_m)
    radius_m = half * step_m
    for ds in datasets:
        try:
            z = fetch_elevations(pts, ds)
        except Exception as e:
            print(f"  WARN horizon dataset {ds}: {e}")
            continue
        if any(v is None for v in z):
            print(f"  WARN {ds}: nodata in the horizon grid, trying the next dataset")
            continue
        z = np.array(z, dtype=float).reshape(n, n)
        c = (half, half)
        sh = low_sun_shadow_pct(z, step_m, c, radius_m / 2.0, 5.0, 8, EARTH_RADIUS_M)
        los = line_of_sight_pct(z, step_m, c, radius_m, 2.0, EARTH_RADIUS_M)
        res = f"{step_m:.0f} m grid, {2 * radius_m / 1000:.0f} km wide ({ds})"
        out = {}
        if sh is not None:
            out["low_sun_shadows"] = (sh, "%", f"Open Topo Data {ds}: % of ground within {radius_m / 2000:.1f} km shadowed by terrain, sun at 5 deg, mean of 8 azimuths, Earth curvature included, {res}", "derived", res)
        if los is not None:
            out["line_of_sight"] = (los, "%", f"Open Topo Data {ds}: % of ground within {radius_m / 1000:.0f} km visible from a 2 m mast at the site, Earth curvature included, {res}", "derived", res)
        return out
    return {}


def fetch_terrain(lat, lon, datasets, half=5, step_m=90.0):
    pts, n = grid_points(lat, lon, half, step_m)
    for ds in datasets:
        try:
            z = fetch_elevations(pts, ds)
        except Exception as e:
            print(f"  WARN elevation dataset {ds}: {e}")
            continue
        if any(v is None for v in z):
            print(f"  WARN {ds}: nodata/outside coverage at this site, trying the next dataset")
            continue
        z = np.array(z, dtype=float).reshape(n, n)
        s = summarize(z, step_m)
        if s is None:
            continue
        window_km = (n - 1) * step_m / 1000.0
        res = f"{step_m:.0f} m sampling over a {window_km:.1f} km window ({ds})"
        return {
            "slope": (s["slope_mean_deg"], "deg", f"Open Topo Data {ds}: mean Horn slope, {res}", "derived", res),
            "vrm_microrelief": (s["vrm_mean"], "index 0-1", f"Open Topo Data {ds}: mean Vector Ruggedness Measure (Sappington 2007), {res}", "derived", res),
        }
    return {}


# ------------------------------------------------------------------ main flow
def build_row(region, datasets, half, step_m, ndvi_year=2023, horizon=True, ndvi=True):
    lat, lon = region["coordinates"]["latitude"], region["coordinates"]["longitude"]
    got = {}
    try:
        got.update(power_to_variables(fetch_power(lat, lon)))
    except Exception as e:
        print(f"  WARN POWER failed for {region['regionId']}: {e}")
    time.sleep(SLEEP)
    try:
        got.update(soilgrids_to_variables(fetch_soilgrids(lat, lon)))
    except Exception as e:
        print(f"  WARN SoilGrids failed for {region['regionId']}: {e}")
    time.sleep(SLEEP)
    try:
        got.update(fetch_terrain(lat, lon, datasets, half, step_m))
    except Exception as e:
        print(f"  WARN terrain failed for {region['regionId']}: {e}")
    if horizon:
        try:
            got.update(fetch_horizon(lat, lon, ["srtm90m", "aster30m"]))
        except Exception as e:
            print(f"  WARN horizon failed for {region['regionId']}: {e}")
    if ndvi:
        try:
            got.update(ndvi_to_variables(fetch_ndvi(lat, lon, ndvi_year), ndvi_year, 1))
        except Exception as e:
            print(f"  WARN MODIS NDVI failed for {region['regionId']}: {e}")
    return got


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--earth", required=True)
    ap.add_argument("--out-dir", default="out")
    ap.add_argument("--apply", action="store_true", help="also write earth_updated.json")
    ap.add_argument("--datasets", default="aster30m,srtm30m,srtm90m", help="Open Topo Data datasets, tried in order")
    ap.add_argument("--half", type=int, default=5, help="grid half-size (5 -> 11x11 points)")
    ap.add_argument("--step-m", type=float, default=90.0, help="grid spacing in metres")
    ap.add_argument("--only", default="", help="comma-separated regionIds to run (default: all)")
    ap.add_argument("--ndvi-year", type=int, default=2023, help="year of MODIS composites for NDVI")
    ap.add_argument("--no-ndvi", action="store_true", help="skip MODIS NDVI")
    ap.add_argument("--no-horizon", action="store_true", help="skip shadows / line of sight (saves ~17 elevation calls per site)")
    a = ap.parse_args(argv)

    with open(a.earth, encoding="utf-8") as fh:
        doc = json.load(fh)
    regions = doc["regions"]
    only = {x for x in a.only.split(",") if x}
    os.makedirs(a.out_dir, exist_ok=True)
    datasets = [d for d in a.datasets.split(",") if d]

    fetched, rows = {}, []
    updated = copy.deepcopy(doc)
    for reg, reg_u in zip(regions, updated["regions"]):
        rid = reg["regionId"]
        if only and rid not in only:
            continue
        print(f"{rid}  {reg['name']}")
        got = build_row(reg, datasets, a.half, a.step_m, a.ndvi_year, not a.no_horizon, not a.no_ndvi)
        fetched[rid] = {k: {"value": v[0], "unit": v[1], "source": v[2], "confidence": v[3], "resolution": v[4]}
                        for k, v in got.items() if v[0] is not None and math.isfinite(v[0])}
        prov = reg_u.setdefault("provenance", {})
        for var, rec in fetched[rid].items():
            grp = FIELD_GROUP[var]
            cur = reg.get(grp, {}).get(var)
            val = rec["value"]
            diff = None if cur in (None, 0) else (val - cur) / abs(cur) * 100.0
            rows.append([rid, var, cur, round(val, 4), rec["unit"], "" if diff is None else round(diff, 1),
                         "CHECK" if diff is not None and abs(diff) > 50 else ""])
            if a.apply:
                reg_u[grp][var] = round(val, 4)
                prov[var] = {k: rec[k] for k in ("unit", "source", "confidence", "resolution")}

    with open(os.path.join(a.out_dir, "earth_fetched.json"), "w", encoding="utf-8") as fh:
        json.dump(fetched, fh, indent=2, ensure_ascii=False)
    with open(os.path.join(a.out_dir, "comparison.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["regionId", "variable", "current_estimate", "fetched", "unit", "diff_pct", "flag"])
        w.writerows(rows)
    if a.apply:
        with open(os.path.join(a.out_dir, "earth_updated.json"), "w", encoding="utf-8") as fh:
            json.dump(updated, fh, indent=2, ensure_ascii=False)
    n_check = sum(1 for r in rows if r[-1])
    print(f"\nDone: {len(rows)} values fetched, {n_check} differ from the estimate by more than 50% (CHECK).")
    print(f"Files in {a.out_dir}/: earth_fetched.json, comparison.csv" + (", earth_updated.json" if a.apply else ""))


if __name__ == "__main__":
    main()
