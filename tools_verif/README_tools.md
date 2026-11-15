# Data tools

Put the 4 `.py` files in ONE folder. Needs Python 3.9+.

    pip install numpy rasterio pyproj requests

## 0. Check the tools work (no internet needed)

    python test_tools.py          # must end with "FAILURES: 0"

## 1. Earth values from free APIs (needs internet)

    python fetch_earth_apis.py --earth earth.json --out-dir out

Look at `out/comparison.csv`. Rows marked CHECK differ from your estimate by more than 50 %.
Paste the CSV and every "WARN" line back to Claude. When you agree with the values:

    python fetch_earth_apis.py --earth earth.json --out-dir out --apply

and use `out/earth_updated.json` (a copy; `earth.json` is never modified).

Same baseline for all three bodies: slope depends on the distance between elevation points.
Moon DEM (LOLA 118 m): `--step-m 118`. Mars DEM (MOLA 463 m): `--step-m 463`.

Now also fetched (no key needed):
- `diurnal_thermal_range` from NASA POWER (surface skin TS_MAX - TS_MIN; falls back to air T2M_RANGE with a WARN)
- `vegetation_ndvi` from NASA MODIS MOD13Q1 (ORNL DAAC web service, 2023 by default: `--ndvi-year`)
- `low_sun_shadows` and `line_of_sight` from a 41 x 41 elevation grid at 250 m (`--no-horizon` to skip)

Run time: about 3-5 minutes per site (the services ask for ~1 call per second).
Test it on one site first:

    python fetch_earth_apis.py --earth earth_regions_actualizado.json --out-dir out --only EARTH-001

## 2. Moon / Mars / Earth values from a downloaded map (GeoTIFF)

Slope and ruggedness from a DEM (elevation map):

    python raster_tools.py slope --raster DEM.tif --lat -85.3 --lon 31.0 --radius-km 5

Shadows at a low sun and line of sight from a 2 m mast (same DEM; curvature of the body included):

    python raster_tools.py horizon --raster DEM.tif --lat -85.3 --lon 31.0 --radius-km 5

Definitions (identical for the three bodies): `low_sun_shadows` = % of ground within 2.5 km
shadowed by terrain with the sun at 5 deg, mean of 8 azimuths; `line_of_sight` = % of ground
within 5 km visible from 2 m above the site. On the Moon a 2 m mast sees only ~2.6 km of flat
ground, so line of sight is low there by physics, not by error.

Average of any other map (rock abundance, thermal inertia, albedo...):

    python raster_tools.py zonal --raster MAP.tif --lat -85.3 --lon 31.0 --radius-km 5

Longitude can be -180..180 or 0..360. The body radius comes from the file itself.
Read the units in the data set's own documentation before copying the number.
