"""Terrain metrics shared by the Earth API script and the raster tool.

All functions work on a regular grid of elevations in metres (numpy 2-D array)
with square cells of `cell_m` metres. Nothing here touches the network.
"""
import math

import numpy as np


def horn_slope_aspect(z, cell_m):
    """Slope (degrees) and aspect (radians, downslope direction) with Horn's 3x3 method.

    Returns arrays of the same shape as `z`; the one-cell border is NaN.
    """
    z = np.asarray(z, dtype=float)
    a = z[:-2, :-2]; b = z[:-2, 1:-1]; c = z[:-2, 2:]
    d = z[1:-1, :-2];                 f = z[1:-1, 2:]
    g = z[2:, :-2];  h = z[2:, 1:-1]; i = z[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * cell_m)   # east - west (columns)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * cell_m)   # south - north (rows)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = np.arctan2(dzdy, -dzdx)
    out_s = np.full(z.shape, np.nan); out_a = np.full(z.shape, np.nan)
    out_s[1:-1, 1:-1] = slope
    out_a[1:-1, 1:-1] = aspect
    return out_s, out_a


def vrm(z, cell_m):
    """Vector Ruggedness Measure (Sappington et al. 2007) over a 3x3 window.

    For each interior cell: unit normal vectors of the 9 cells are summed;
    VRM = 1 - |sum| / 9. 0 = perfectly smooth/planar, -> 1 = very rugged.
    Returns an array with a NaN border (two cells in total, as it needs slope first).
    """
    slope, aspect = horn_slope_aspect(z, cell_m)
    sl = np.radians(slope)
    xy = np.sin(sl)
    zz = np.cos(sl)
    xx = xy * np.sin(aspect)
    yy = xy * np.cos(aspect)
    out = np.full(z.shape, np.nan)
    n, m = z.shape
    for r in range(2, n - 2):
        for c in range(2, m - 2):
            # A plain sum: if any of the 9 cells is NaN (nodata, or outside the
            # circle) the result is NaN and the cell is left out of the statistics.
            sx = np.sum(xx[r - 1:r + 2, c - 1:c + 2])
            sy = np.sum(yy[r - 1:r + 2, c - 1:c + 2])
            sz = np.sum(zz[r - 1:r + 2, c - 1:c + 2])
            out[r, c] = 1.0 - np.sqrt(sx * sx + sy * sy + sz * sz) / 9.0
    return out


def _shift(z, dr, dc):
    """z shifted so out[r, c] = z[r + dr, c + dc]; NaN where that falls outside."""
    n, m = z.shape
    out = np.full(z.shape, np.nan)
    r0, r1 = max(0, -dr), min(n, n - dr)
    c0, c1 = max(0, -dc), min(m, m - dc)
    if r0 < r1 and c0 < c1:
        out[r0:r1, c0:c1] = z[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
    return out


def shadow_mask(z, cell_m, sun_elev_deg, sun_az_deg, max_dist_m, body_radius_m=None):
    """True where the cell is in shadow for a sun at (elevation, azimuth).

    Azimuth is clockwise from north (row 0 is north). The horizon toward the sun is
    searched up to `max_dist_m`. With `body_radius_m` the terrain ahead is lowered by
    d^2 / (2R) for the curvature of the body.
    """
    z = np.asarray(z, dtype=float)
    tan_e = math.tan(math.radians(sun_elev_deg))
    a = math.radians(sun_az_deg)
    ur, uc = -math.cos(a), math.sin(a)            # unit step toward the sun, in cells
    shadow = np.zeros(z.shape, dtype=bool)
    seen = set()
    for k in range(1, int(max_dist_m / cell_m) + 1):
        dr, dc = int(round(k * ur)), int(round(k * uc))
        if (dr, dc) in seen:
            continue
        seen.add((dr, dc))
        d = math.hypot(dr, dc) * cell_m
        ahead = _shift(z, dr, dc)
        if body_radius_m:
            ahead = ahead - d * d / (2.0 * body_radius_m)
        with np.errstate(invalid="ignore"):
            shadow |= (ahead - z) > tan_e * d
    return shadow


def low_sun_shadow_pct(z, cell_m, centre, radius_m, sun_elev_deg=5.0, n_az=8, body_radius_m=None):
    """Percent of the cells within `radius_m` of `centre` that are shadowed by terrain,
    averaged over `n_az` evenly spaced sun azimuths. The horizon is searched up to
    `radius_m` beyond each cell, so the grid must extend 2 * radius_m from the centre."""
    rc, cc = centre
    yy, xx = np.indices(z.shape)
    inside = (np.hypot(yy - rc, xx - cc) * cell_m <= radius_m) & np.isfinite(z)
    if not inside.any():
        return None
    pct = [100.0 * shadow_mask(z, cell_m, sun_elev_deg, 360.0 * i / n_az, radius_m, body_radius_m)[inside].mean()
           for i in range(n_az)]
    return float(np.mean(pct))


def line_of_sight_pct(z, cell_m, centre, radius_m, observer_h_m=2.0, body_radius_m=None, max_targets=40000):
    """Percent of ground cells within `radius_m` visible from an observer standing
    `observer_h_m` above the centre cell. Curvature of the body is included when
    `body_radius_m` is given (on the Moon the horizon of a 2 m mast is only ~2.6 km)."""
    z = np.asarray(z, dtype=float)
    rc, cc = centre
    z0 = z[rc, cc]
    if not math.isfinite(z0):
        return None
    yy, xx = np.indices(z.shape)
    dist = np.hypot(yy - rc, xx - cc) * cell_m
    tgt = np.argwhere((dist <= radius_m) & (dist > 0) & np.isfinite(z))
    if len(tgt) == 0:
        return None
    if len(tgt) > max_targets:                     # keep the run time bounded on fine DEMs
        tgt = tgt[:: int(math.ceil(len(tgt) / max_targets))]
    drop = (lambda d: d * d / (2.0 * body_radius_m)) if body_radius_m else (lambda d: 0.0 * d)
    eye = z0 + observer_h_m
    visible = 0
    n, m = z.shape
    for tr, tc in tgt:
        D = dist[tr, tc]
        ns = max(int(2 * D / cell_m), 1)           # a sample every half cell
        f = np.arange(1, ns) / ns                  # intermediate points, endpoints excluded
        if f.size:
            # bilinear interpolation at the exact point on the ray: nearest-cell sampling
            # puts the ground up to half a cell off the ray, which on a slope reads as a
            # false obstacle several metres high
            r = rc + f * (tr - rc)
            c = cc + f * (tc - cc)
            r0 = np.clip(np.floor(r).astype(int), 0, n - 2)
            c0 = np.clip(np.floor(c).astype(int), 0, m - 2)
            wr, wc = r - r0, c - c0
            ground = (z[r0, c0] * (1 - wr) * (1 - wc) + z[r0 + 1, c0] * wr * (1 - wc)
                      + z[r0, c0 + 1] * (1 - wr) * wc + z[r0 + 1, c0 + 1] * wr * wc)
            ground = ground - drop(f * D)
            line = eye + f * (z[tr, tc] - drop(D) - eye)
            with np.errstate(invalid="ignore"):
                if np.any(ground > line + 1e-6):   # NaN never blocks
                    continue
        visible += 1
    return 100.0 * visible / len(tgt)


def summarize(z, cell_m):
    """Mean/median/p90 slope (deg) and mean VRM for a DEM window."""
    s, _ = horn_slope_aspect(z, cell_m)
    v = vrm(z, cell_m)
    s = s[np.isfinite(s)]
    v = v[np.isfinite(v)]
    if s.size == 0:
        return None
    return {
        "slope_mean_deg": float(np.mean(s)),
        "slope_median_deg": float(np.median(s)),
        "slope_p90_deg": float(np.percentile(s, 90)),
        "vrm_mean": float(np.mean(v)) if v.size else None,
        "n_cells": int(s.size),
        "cell_m": float(cell_m),
    }
