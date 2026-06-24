# SunRayControl

An interactive browser tool for visualizing direct sunlight inside a room — how much reaches each surface (floor, walls) and how an external overhang changes that, by season and time of day.

Built around a geometric model: a south-facing window in a box-shaped room, illuminated by an analytically-computed sun position (no external solar data or network access required).

**[Live demo →](https://alirezaenergy.github.io/tools/sunraycontrol/index.html)**

---

## Features

**Live heatmap panels** — Floor, North/East/West walls, and the South wall update in real time, showing the lit/unlit pattern and percentage for each surface, plus the window's own "% unblocked by shade".

**Shade controls** — Adjust length, width, and tilt angle. A *Find minimum length* button sizes the shade via summer-solstice trigonometry: the shortest overhang that fully blocks the window at the hottest part of the year.

**Date / Time** — Animate through a full day or a full year, jump to sunrise/solar noon/sunset, or snap to the solstices and equinoxes.

**3D room view** — An interactive WebGL model of the room (orbit / zoom / pan), textured with the exact same lit/unlit data as the 2D panels. Updates live while an animation plays.

**Year overview** — A 365-day calendar grid showing lit % for every day of the year, colored by surface, at each day's solar noon or any fixed clock hour.

**Exposure heatmap** — Per-cell % of sampled daylight moments that were directly lit over a chosen date range (a day, a month, a season, or the full year), shown on the floor and wall panels.

**CSV report** — Sweeps a date/time range at a chosen frequency and exports per-surface lit % for every timestamp, with the full configuration in the file header.

**Save / Share** — Encodes every setting into a URL for sharing, or saves named presets in browser local storage.

---

## Settings

All settings are accessed via the gear icon (top right):

| Group | Parameters |
|---|---|
| Location | Latitude, longitude, UTC offset |
| Room | East–West length, South–North width, height, floor above ground |
| Window | Width, height, distance from east wall, distance from floor |
| Shade | Mounting gap above window frame |
| Animation | Seconds per full cycle |
| Grid resolution | Cells per side for wall/floor and window heatmaps |

---

## The model

- **Coordinate system**: X = west→east, Y = south→north, Z = floor→ceiling. Origin is the room's bottom-south-west interior corner.
- **Window orientation**: always south-facing. The tool is designed for the Northern Hemisphere, where south-facing windows receive the most direct solar gain.
- **Sun position**: computed analytically from latitude, longitude, timezone, date, and time using the Cooper declination equation and standard solar-geometry formulas — no external data needed.
- **Shading**: for each grid cell on a surface, a reverse ray is traced toward the sun, checked against the window opening, and tested against the shade panel (ray–plane intersection). No reflections are modeled.
- **The ceiling is excluded**: direct sunlight through a south-facing window always travels downward, so it can never be physically lit regardless of geometry.
- **No external obstructions**: neighboring buildings, terrain, or trees are not modeled.

---

## Running locally

No build step required. Open `index.html` directly in a browser. Chrome or Edge is recommended for WebGL support (3D view).

---

## Disclaimer

This tool is provided for **educational and illustrative purposes only**. Results are based on a simplified geometric model and idealized sun-position formulas. They do not account for diffuse radiation, cloud cover, external obstructions, reflections, or other real-world factors that affect actual solar gain.

**Do not use this tool as the sole basis for engineering, architectural, or construction decisions.** Always consult a qualified professional and appropriate simulation software (e.g. EnergyPlus, IDA ICE, DesignBuilder) for design work.

---

## License

MIT License — see [LICENSE](LICENSE).

## Terms of Use

See [TERMS.md](TERMS.md).
