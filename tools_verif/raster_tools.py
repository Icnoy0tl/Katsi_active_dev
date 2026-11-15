#!/usr/bin/env python3
"""Site statistics from ANY planetary GeoTIFF (Moon, Mars or Earth).

Three commands:

  slope   : the raster is a DEM (elevations in metres). Prints slope and VRM
            around a point.
  horizon : the raster is a DEM. Prints low_sun_shadows (% of ground shadowed by
            terrain at a low sun) and line_of_sight (% of ground visible from a
            2 m mast at the site), with the curvature of the body included.
  zonal   : the raster is any other map (rock abundance, thermal inertia,
            albedo, ...). Prints mean / median / min / max inside a circle.

Examples
  python raster_tools.py slope   --raster LDEM_118.tif --lat -85.3 --lon 31.0 --radius-km 5
  python raster_tools.py horizon --raster LDEM_118.tif --lat -85.3 --lon 31.0 --radius-km 5
  python raster_tools.py zonal   --raster rock_abundance.tif --lat -85.3 --lon 31.0 --radius-km 5

Longitude may be given as -180..180 or 0..360; the tool tries both.
The body radius is read from the file's own coordinate system, so the same
command works for the Moon, Mars and Earth. Distances are true ground distances:
for equirectangular maps (LOLA 118 m, MOLA 463 m) the east-west cell size is
corrected for latitude with the projection's own scale factors.

Needs: pip install numpy rasterio pyproj
"""
import argparse
import json
import math

import numpy as np
import rasterio
from pyproj import CRS, Proj, Transformer
from rasterio.windows import Window

from terrain import line_of_sight_pct, low_sun_shadow_pct, summarize


def _lonlat_to_xy(src, lat, lon):
    crs = CRS.from_user_input(src.crs.to_wkt())
    geod = crs.geodetic_crs
    tr = Transformer.from_crs(geod, crs, always_xy=True)
    b = src.bounds
    for lo in (lon, lon + 360.0, lon - 360.0):
        try:
            x, y = tr.transform(lo, lat)
        except Exception:
            continue
        if math.isfinite(x) and math.isfinite(y) and b.left <= x <= b.right and b.bottom <= y <= b.top:
            return x, y, crs, lo
    raise SystemExit(
        f"The point lat={lat}, lon={lon} is outside the raster bounds {tuple(b)}. "
        "Check the coordinates and the file's coverage.")


def _cell_metres(src, crs, lat, lon):
    """True ground size of one cell in metres (east-west, north-south) at (lat, lon)."""
    px, py = abs(src.transform.a), abs(src.transform.e)
    if crs.is_geographic:
        radius = crs.ellipsoid.semi_major_metre
        dy = math.radians(py) * radius
        dx = math.radians(px) * radius * max(math.cos(math.radians(lat)), 1e-6)
        return dx, dy
    try:
        f = Proj(crs).get_factors(lon, lat)
        k, h = f.parallel_scale, f.meridional_scale
        if math.isfinite(k) and math.isfinite(h) and k > 0 and h > 0:
            return px / k, py / h
    except Exception:
        pass
    return px, py


def body_radius(crs):
    try:
        return crs.ellipsoid.semi_major_metre
    except Exception:
        return None


def _window(src, x, y, radius_m, dx, dy):
    row, col = src.index(x, y)
    nr = int(math.ceil(radius_m / dy)) + 2
    nc = int(math.ceil(radius_m / dx)) + 2
    r0, c0 = max(row - nr, 0), max(col - nc, 0)
    r1, c1 = min(row + nr + 1, src.height), min(col + nc + 1, src.width)
    win = Window(c0, r0, c1 - c0, r1 - r0)
    data = src.read(1, window=win, masked=True).astype(float)
    data = data.filled(np.nan)
    return data, (row - r0, col - c0)


def _square(z, centre, dx, dy):
    """Nearest-neighbour resample to square cells (the coarser of dx, dy) so that
    Horn's method and the horizon search are valid. Returns z, centre, cell."""
    rc, cc = centre
    if abs(dx - dy) / max(dx, dy) <= 0.05:
        return z, (rc, cc), (dx + dy) / 2.0
    if dx < dy:                                    # columns are finer: keep every (dy/dx)-th column
        step = dy / dx
        cols = np.clip(np.round(np.arange(0, z.shape[1], step)).astype(int), 0, z.shape[1] - 1)
        return z[:, cols], (rc, int(np.argmin(np.abs(cols - cc)))), dy
    step = dx / dy                                 # rows are finer
    rows = np.clip(np.round(np.arange(0, z.shape[0], step)).astype(int), 0, z.shape[0] - 1)
    return z[rows, :], (int(np.argmin(np.abs(rows - rc))), cc), dx


def _mask_circle(z, rc, cc, radius_m, cell):
    yy, xx = np.indices(z.shape)
    d = np.hypot((yy - rc) * cell, (xx - cc) * cell)
    z = z.copy()
    z[d > radius_m] = np.nan
    return z


def _read_dem(a, extra_m=0.0):
    with rasterio.open(a.raster) as src:
        x, y, crs, lon = _lonlat_to_xy(src, a.lat, a.lon)
        dx, dy = _cell_metres(src, crs, a.lat, lon)
        z, centre = _window(src, x, y, a.radius_km * 1000.0 + extra_m, dx, dy)
    z, centre, cell = _square(z, centre, dx, dy)
    return z, centre, cell, crs


def cmd_slope(a):
    z, (rc, cc), cell, _ = _read_dem(a)
    out = summarize(_mask_circle(z, rc, cc, a.radius_km * 1000.0, cell), cell)
    if out is None:
        raise SystemExit("No valid elevation cells in the window.")
    out.update({"raster": a.raster, "lat": a.lat, "lon": a.lon, "radius_km": a.radius_km})
    print(json.dumps(out, indent=2))


def cmd_horizon(a):
    radius_m = a.radius_km * 1000.0
    z, centre, cell, crs = _read_dem(a)
    # A fine polar DEM (5-20 m) gives millions of cells; thin it so the run stays under
    # a minute and the scale stays comparable with LOLA 118 m / MOLA 463 m / Earth 250 m.
    side = max(z.shape)
    if side > a.max_side:
        s = int(math.ceil(side / a.max_side))
        z, centre, cell = z[::s, ::s], (centre[0] // s, centre[1] // s), cell * s
    R = None if a.no_curvature else body_radius(crs)
    shadow_r = radius_m / 2.0                      # shadows inside R/2, horizon searched another R/2
    out = {
        "low_sun_shadows_pct": low_sun_shadow_pct(z, cell, centre, shadow_r, a.sun_elev, a.azimuths, R),
        "line_of_sight_pct": line_of_sight_pct(z, cell, centre, radius_m, a.observer_m, R),
        "sun_elevation_deg": a.sun_elev, "azimuths": a.azimuths, "shadow_radius_km": shadow_r / 1000.0,
        "observer_height_m": a.observer_m, "los_radius_km": a.radius_km,
        "body_radius_m": R, "cell_m": cell,
        "raster": a.raster, "lat": a.lat, "lon": a.lon,
    }
    if out["low_sun_shadows_pct"] is None or out["line_of_sight_pct"] is None:
        raise SystemExit("No valid elevation cells in the window (or nodata at the site itself).")
    print(json.dumps(out, indent=2))


def cmd_zonal(a):
    with rasterio.open(a.raster) as src:
        x, y, crs, lon = _lonlat_to_xy(src, a.lat, a.lon)
        dx, dy = _cell_metres(src, crs, a.lat, lon)
        data, (rc, cc) = _window(src, x, y, a.radius_km * 1000.0, dx, dy)
        scale = src.scales[0] if src.scales else 1.0
        offset = src.offsets[0] if src.offsets else 0.0
    yy, xx = np.indices(data.shape)
    d = np.hypot((yy - rc) * dy, (xx - cc) * dx)
    vals = data[(d <= a.radius_km * 1000.0) & np.isfinite(data)] * scale + offset
    if a.nodata is not None:
        vals = vals[vals != a.nodata]
    if vals.size == 0:
        raise SystemExit("No valid cells inside the circle (nodata only?).")
    print(json.dumps({
        "raster": a.raster, "lat": a.lat, "lon": a.lon, "radius_km": a.radius_km,
        "mean": float(vals.mean()), "median": float(np.median(vals)),
        "min": float(vals.min()), "max": float(vals.max()), "n_cells": int(vals.size),
    }, indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn in (("slope", cmd_slope), ("horizon", cmd_horizon), ("zonal", cmd_zonal)):
        s = sub.add_parser(name)
        s.add_argument("--raster", required=True)
        s.add_argument("--lat", type=float, required=True)
        s.add_argument("--lon", type=float, required=True)
        s.add_argument("--radius-km", type=float, default=5.0)
        if name == "zonal":
            s.add_argument("--nodata", type=float, default=None, help="extra value to ignore")
        if name == "horizon":
            s.add_argument("--sun-elev", type=float, default=5.0, help="sun elevation in degrees (default 5)")
            s.add_argument("--azimuths", type=int, default=8, help="number of sun azimuths averaged (default 8)")
            s.add_argument("--observer-m", type=float, default=2.0, help="mast height for line of sight (default 2 m)")
            s.add_argument("--no-curvature", action="store_true", help="ignore the curvature of the body")
            s.add_argument("--max-side", type=int, default=201,
                           help="thin the DEM window to at most this many cells per side (default 201)")
        s.set_defaults(fn=fn)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
