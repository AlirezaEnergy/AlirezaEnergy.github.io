"use strict";

/* =========================================================================
   Physics — direct port of solar.py / geometry.py / rays.py / viz.py
   ========================================================================= */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// --- solar.py -------------------------------------------------------------

function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin((360 / 365) * (284 + dayOfYear) * DEG2RAD);
}

function equationOfTime(dayOfYear) {
  const B = (360 / 365) * (dayOfYear - 81) * DEG2RAD;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

function hourAngle(longitude, timezoneOffset, dayOfYear, timeOfDay) {
  const standardMeridian = timezoneOffset * 15;
  const eot = equationOfTime(dayOfYear);
  const timeCorrection = 4 * (longitude - standardMeridian) + eot;
  const solarTime = timeOfDay + timeCorrection / 60;
  return (solarTime - 12) * 15;
}

function solarAltitude(latitude, declination, hourAngleDeg) {
  const lat = latitude * DEG2RAD;
  const dec = declination * DEG2RAD;
  const h = hourAngleDeg * DEG2RAD;
  let sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  sinAlt = Math.max(-1, Math.min(1, sinAlt));
  return Math.asin(sinAlt) * RAD2DEG;
}

function solarAzimuth(latitude, declination, hourAngleDeg, altitudeDeg) {
  const lat = latitude * DEG2RAD;
  const dec = declination * DEG2RAD;
  const alt = altitudeDeg * DEG2RAD;
  let cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat));
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let az = Math.acos(cosAz) * RAD2DEG;
  if (hourAngleDeg > 0) az = 360 - az;
  return az;
}

function getSolarPosition(latitude, longitude, timezoneOffset, dayOfYear, timeOfDay) {
  const dec = solarDeclination(dayOfYear);
  const h = hourAngle(longitude, timezoneOffset, dayOfYear, timeOfDay);
  const alt = solarAltitude(latitude, dec, h);
  const az = solarAzimuth(latitude, dec, h, alt);
  return { alt, az };
}

// Closed-form sunrise / solar-noon / sunset local clock time (inverse of hourAngle).
function hourAngleToLocalTime(hDeg, longitude, timezoneOffset, dayOfYear) {
  const standardMeridian = timezoneOffset * 15;
  const eot = equationOfTime(dayOfYear);
  const timeCorrection = 4 * (longitude - standardMeridian) + eot;
  const solarTime = hDeg / 15 + 12;
  return solarTime - timeCorrection / 60;
}

function computeSunTimes(latitude, longitude, timezoneOffset, dayOfYear) {
  const dec = solarDeclination(dayOfYear);
  const lat = latitude * DEG2RAD;
  const decR = dec * DEG2RAD;
  let cosH0 = -Math.tan(lat) * Math.tan(decR);
  cosH0 = Math.max(-1, Math.min(1, cosH0));
  const H0 = Math.acos(cosH0) * RAD2DEG;
  return {
    sunrise: hourAngleToLocalTime(-H0, longitude, timezoneOffset, dayOfYear),
    noon: hourAngleToLocalTime(0, longitude, timezoneOffset, dayOfYear),
    sunset: hourAngleToLocalTime(H0, longitude, timezoneOffset, dayOfYear),
  };
}

// The sun's altitude/azimuth at its daily peak (hour angle = 0, i.e. true
// solar noon) -- independent of longitude/timezone, since those only shift
// which *local clock time* corresponds to solar noon, not the sun's actual
// position at that moment.
function peakSolarPosition(latitude, dayOfYear) {
  const dec = solarDeclination(dayOfYear);
  const alt = solarAltitude(latitude, dec, 0);
  const az = solarAzimuth(latitude, dec, 0, alt);
  return { alt, az };
}

// Day-of-year of the four solar-calendar markers, found directly from this
// app's own declination formula (solstices = its extrema, equinoxes = its
// zero-crossings) rather than externally-sourced "official" dates -- so
// they're exactly consistent with everything else this app computes.
const SOLAR_CALENDAR_DAYS = (function computeSolarCalendarDays() {
  let springEquinox = null, fallEquinox = null;
  let summerSolstice = 1, winterSolstice = 1;
  let maxDec = solarDeclination(1), minDec = solarDeclination(1);
  let prevDec = maxDec;
  for (let d = 2; d <= 365; d++) {
    const dec = solarDeclination(d);
    if (dec > maxDec) { maxDec = dec; summerSolstice = d; }
    if (dec < minDec) { minDec = dec; winterSolstice = d; }
    if (springEquinox === null && prevDec < 0 && dec >= 0) springEquinox = d;
    if (fallEquinox === null && prevDec >= 0 && dec < 0) fallEquinox = d;
    prevDec = dec;
  }
  return { springEquinox, summerSolstice, fallEquinox, winterSolstice };
})();

// --- geometry.py ------------------------------------------------------------

function windowEdges(room, win) {
  const xRight = room.length - win.fromRight;
  const xLeft = xRight - win.width;
  const zBottom = win.fromFloor;
  const zTop = zBottom + win.height;
  return { xLeft, xRight, zBottom, zTop };
}

// Returns the shade panel's own extent (xLeft/xRight may differ from the
// window's, since the shade can be wider or narrower than the window — it
// is centered on the window's horizontal center either way). The shade's
// inner (attached) edge sits at zMount = window's zTop + shade.gap -- 0 gap
// means flush with the window top; a positive gap mounts it that much
// higher up the wall.
function shadeOuterEdge(room, win, shade) {
  const { xLeft: winXl, xRight: winXr, zTop } = windowEdges(room, win);
  const centerX = (winXl + winXr) / 2;
  const xLeft = centerX - shade.width / 2;
  const xRight = centerX + shade.width / 2;
  const zMount = zTop + shade.gap;
  const a = shade.angle * DEG2RAD;
  const yTip = -shade.length * Math.sin(a);
  const zTip = zMount - shade.length * Math.cos(a);
  return { xLeft, xRight, yTip, zTip, zMount };
}

// --- rays.py ------------------------------------------------------------

function sunDirection(altitudeDeg, azimuthDeg) {
  const alt = altitudeDeg * DEG2RAD;
  const az = azimuthDeg * DEG2RAD;
  return [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
}

function isWindowSunlit(altitudeDeg, azimuthDeg) {
  if (altitudeDeg <= 0) return false;
  const [, sy] = sunDirection(altitudeDeg, azimuthDeg);
  return sy < 0;
}

// --- viz.py: compute_maps (vectorized lit-map) --------------------------

function linspaceCenters(lo, hi, n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = lo + ((i + 0.5) / n) * (hi - lo);
  return out;
}

// Builds the per-cell lit test shared by every surface (floor/north/east/west):
// traces a backward ray from a room point toward the sun, checks whether it
// exits through the window, and if so whether the shade panel blocks it.
// Returns null if the window isn't sunlit at all (caller should treat as all-dark).
function makeLitTester(room, win, shade, altitudeDeg, azimuthDeg) {
  if (!isWindowSunlit(altitudeDeg, azimuthDeg)) return null;

  const [dx, dy, dz] = sunDirection(altitudeDeg, azimuthDeg);
  const { xLeft: xl, xRight: xr, zBottom: zb, zTop: zt } = windowEdges(room, win);
  const { xLeft: sxl, xRight: sxr, yTip, zTip, zMount } = shadeOuterEdge(room, win, shade);

  const shDy = yTip;
  const shDz = zTip - zMount;
  const shDen = -shDz * dy + shDy * dz;
  const shLs2 = shDy * shDy + shDz * shDz;
  const shadeDegenerate = Math.abs(shDen) < 1e-9 || shLs2 < 1e-12;

  return function lit(cx, cy, cz) {
    const t = -cy / dy;
    if (t <= 1e-9) return 0;
    const wx = cx + t * dx;
    const wz = cz + t * dz;
    if (!(wx >= xl && wx <= xr && wz >= zb && wz <= zt)) return 0;
    if (shadeDegenerate) return 1;
    const tSh = (shDy * (zMount - wz)) / shDen;
    const ix = wx + tSh * dx;
    const iy = tSh * dy;
    const iz = wz + tSh * dz;
    const u = (iy * shDy + (iz - zMount) * shDz) / shLs2;
    const shaded = tSh > 1e-9 && ix >= sxl && ix <= sxr && u >= 0 && u <= 1;
    return shaded ? 0 : 1;
  };
}

function computeMaps(room, win, shade, altitudeDeg, azimuthDeg, n) {
  // The ceiling is excluded: direct sunlight through a south-facing window
  // always travels downward into the room, so it can never be physically lit.
  const names = ["floor", "north", "east", "west"];
  const maps = {};
  const pcts = {};

  const lit = makeLitTester(room, win, shade, altitudeDeg, azimuthDeg);
  if (!lit) {
    for (const s of names) {
      maps[s] = new Float32Array(n * n);
      pcts[s] = 0;
    }
    return { maps, pcts };
  }

  const Lx = room.length, Ly = room.width, Lz = room.height;
  const xs = linspaceCenters(0, Lx, n);
  const ys = linspaceCenters(0, Ly, n);
  const zs = linspaceCenters(0, Lz, n);
  const ysN = ys.slice().reverse(); // row 0 = north (top of image)
  const zsT = zs.slice().reverse(); // row 0 = high z / ceiling height (top of image)

  function fill(rowsFn) {
    const arr = new Float32Array(n * n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = rowsFn(i, j);
        arr[i * n + j] = v;
        sum += v;
      }
    }
    return { arr, pct: (100 * sum) / (n * n) };
  }

  let r;
  r = fill((i, j) => lit(xs[j], ysN[i], 0));            maps.floor = r.arr;   pcts.floor = r.pct;
  r = fill((i, j) => lit(xs[j], Ly, zsT[i]));            maps.north = r.arr;   pcts.north = r.pct;
  r = fill((i, j) => lit(Lx, ys[j], zsT[i]));            maps.east = r.arr;    pcts.east = r.pct;
  r = fill((i, j) => lit(0, ys[j], zsT[i]));             maps.west = r.arr;    pcts.west = r.pct;

  return { maps, pcts };
}

// Lean variant of computeMaps for batch use (e.g. the CSV report): returns
// only the percentages, without allocating a Float32Array per surface.
function computeSurfacePcts(room, win, shade, altitudeDeg, azimuthDeg, n) {
  const lit = makeLitTester(room, win, shade, altitudeDeg, azimuthDeg);
  if (!lit) return { floor: 0, north: 0, east: 0, west: 0 };

  const Lx = room.length, Ly = room.width, Lz = room.height;
  const xs = linspaceCenters(0, Lx, n);
  const ys = linspaceCenters(0, Ly, n);
  const zs = linspaceCenters(0, Lz, n);
  const ysN = ys.slice().reverse();
  const zsT = zs.slice().reverse();

  function pctOf(rowsFn) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) sum += rowsFn(i, j);
    }
    return (100 * sum) / (n * n);
  }

  return {
    floor: pctOf((i, j) => lit(xs[j], ysN[i], 0)),
    north: pctOf((i, j) => lit(xs[j], Ly, zsT[i])),
    east:  pctOf((i, j) => lit(Lx, ys[j], zsT[i])),
    west:  pctOf((i, j) => lit(0, ys[j], zsT[i])),
  };
}

// --- rays.py / main.py: "window samples unblocked" — the window's own
// lit/shaded pattern, sampled directly on its plane (no room projection needed).
// Returns null if the window isn't sunlit at all.
function makeWindowLitTester(room, win, shade, altitudeDeg, azimuthDeg) {
  if (!isWindowSunlit(altitudeDeg, azimuthDeg)) return null;

  const [dx, dy, dz] = sunDirection(altitudeDeg, azimuthDeg);
  const { xLeft: sxl, xRight: sxr, yTip, zTip, zMount } = shadeOuterEdge(room, win, shade);

  const shDy = yTip;
  const shDz = zTip - zMount;
  const shDen = -shDz * dy + shDy * dz;
  const shLs2 = shDy * shDy + shDz * shDz;
  const shadeDegenerate = Math.abs(shDen) < 1e-9 || shLs2 < 1e-12;

  return function lit(wx, wz) {
    if (shadeDegenerate) return 1;
    const tSh = (shDy * (zMount - wz)) / shDen;
    const ix = wx + tSh * dx;
    const iy = tSh * dy;
    const iz = wz + tSh * dz;
    const u = (iy * shDy + (iz - zMount) * shDz) / shLs2;
    const shaded = tSh > 1e-9 && ix >= sxl && ix <= sxr && u >= 0 && u <= 1;
    return shaded ? 0 : 1;
  };
}

function computeWindowMap(room, win, shade, altitudeDeg, azimuthDeg, n) {
  const lit = makeWindowLitTester(room, win, shade, altitudeDeg, azimuthDeg);
  if (!lit) return { map: new Float32Array(n * n), pct: 0 };

  const { xLeft: xl, xRight: xr, zBottom: zb, zTop: zt } = windowEdges(room, win);
  const xs = linspaceCenters(xl, xr, n);
  const zs = linspaceCenters(zb, zt, n);
  const zsT = zs.slice().reverse(); // row 0 = top of window (top of image)

  const arr = new Float32Array(n * n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = lit(xs[j], zsT[i]);
      arr[i * n + j] = v;
      sum += v;
    }
  }
  return { map: arr, pct: (100 * sum) / (n * n) };
}

// Lean variant of computeWindowMap for batch use (e.g. the CSV report):
// returns only the unblocked percentage, without allocating a Float32Array.
function computeWindowPct(room, win, shade, altitudeDeg, azimuthDeg, n) {
  const lit = makeWindowLitTester(room, win, shade, altitudeDeg, azimuthDeg);
  if (!lit) return 0;

  const { xLeft: xl, xRight: xr, zBottom: zb, zTop: zt } = windowEdges(room, win);
  const xs = linspaceCenters(xl, xr, n);
  const zs = linspaceCenters(zb, zt, n);
  const zsT = zs.slice().reverse();

  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sum += lit(xs[j], zsT[i]);
  }
  return (100 * sum) / (n * n);
}

// --- Minimum shade length finder (closed-form overhang sizing) ----------
//
// Classic passive-solar design target: size the shade so its shadow reaches
// exactly the bottom of the window at summer-solstice noon -- the hottest
// part of the year. A shorter shade lets solstice sun in; a longer one
// needlessly blocks more of the milder shoulder seasons for no extra
// solstice benefit. At true solar noon the sun is exactly due south
// (azimuth = 180 deg), so the shadow position depends only on height -- a
// 2D trigonometry problem in the room's Y-Z cross-section, independent of
// window/shade width.
//
// Derivation: a ray from the sun grazing the shade's outer tip (y_tip,
// z_tip) continues to the window plane (y=0) at height
//   z = z_top - L*cos(theta) - L*sin(theta)*tan(alt)
// Setting z = z_bottom (window height H = z_top - z_bottom fully shaded):
//   L = H / (cos(theta) + sin(theta)*tan(alt))
// (At theta=90deg this reduces to the textbook horizontal-overhang formula
// L = H / tan(alt).)
//
// Note: theta=0deg is a singularity, not just a formula edge case -- at
// exactly 0deg the shade has zero outward reach (sin(0)=0) and lies flush
// against the wall, so it blocks nothing at *any* length even though the
// formula's limit as theta->0+ evaluates to L=H. Callers must reject
// theta<=0 explicitly; the formula alone can't detect this.

function findMinimumShadeLength({ latitude, win, angle, shadeWidth, gap }) {
  if (shadeWidth < win.width - 1e-9) {
    return { found: false, reason: "narrow", windowWidth: win.width };
  }

  // The shade is mounted gap meters above the window's top edge, so the
  // vertical span it must cover to fully shade the window is the window
  // height PLUS that gap, not just the window height on its own.
  const effectiveHeight = win.height + gap;

  if (angle <= 0) {
    // Special case: at 0 degrees the shade has zero outward reach and lies
    // exactly in the window's own plane (see makeWindowLitTester/lit()) --
    // an external overhang's shadow formula doesn't apply, since there is no
    // overhang, just a flush cover. Logically, a flush cover spanning from
    // the mount height down to the window's bottom covers it by direct
    // overlap, so the answer here is simply that span, not a trig result.
    return { found: true, length: effectiveHeight, flush: true };
  }

  const { alt } = peakSolarPosition(latitude, SOLAR_CALENDAR_DAYS.summerSolstice);
  if (alt <= 0) {
    return { found: false, reason: "no-sun" };
  }

  const theta = angle * DEG2RAD;
  const altRad = alt * DEG2RAD;
  const denom = Math.cos(theta) + Math.sin(theta) * Math.tan(altRad);
  if (!(denom > 1e-9)) {
    return { found: false, reason: "no-solution", alt };
  }

  return { found: true, length: effectiveHeight / denom, alt };
}

/* =========================================================================
   Date <-> day-of-year (fixed non-leap reference year so 1..365 stays valid)
   ========================================================================= */

const REF_YEAR = 2025;

function dayOfYearToDateStr(doy) {
  const d = new Date(Date.UTC(REF_YEAR, 0, 1));
  d.setUTCDate(d.getUTCDate() + (doy - 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${REF_YEAR}-${mm}-${dd}`;
}

function dateStrToDayOfYear(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = Date.UTC(REF_YEAR, 0, 1);
  const cur = Date.UTC(REF_YEAR, m - 1, d);
  return Math.round((cur - start) / 86400000) + 1;
}

function decimalHoursToTimeStr(h) {
  h = Math.max(0, Math.min(24, h));
  let totalMin = Math.round(h * 60);
  if (totalMin >= 24 * 60) totalMin = 24 * 60 - 1;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function timeStrToDecimalHours(timeStr) {
  const [hh, mm] = timeStr.split(":").map(Number);
  return hh + mm / 60;
}

// Wraps a pair of HH/MM <input type="number"> elements behind the same
// {value, addEventListener} shape as a native <input type="time">, so the
// rest of the code can treat it identically. Used instead of the native
// time input because its AM/PM-vs-24h display follows browser/OS locale,
// which isn't reliably forceable to 24-hour from the page.
function makeTime24Input(hhId, mmId) {
  const hh = document.getElementById(hhId);
  const mm = document.getElementById(mmId);
  return {
    get value() {
      if (hh.value === "" || mm.value === "") return "";
      const h = Math.max(0, Math.min(23, parseInt(hh.value, 10) || 0));
      const m = Math.max(0, Math.min(59, parseInt(mm.value, 10) || 0));
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    },
    set value(v) {
      if (!v) { hh.value = ""; mm.value = ""; return; }
      const [h, m] = v.split(":");
      hh.value = parseInt(h, 10);
      mm.value = parseInt(m, 10);
    },
    addEventListener(type, fn) {
      hh.addEventListener(type, fn);
      mm.addEventListener(type, fn);
    },
  };
}

/* =========================================================================
   State
   ========================================================================= */

const DEFAULTS = {
  latitude: 43.65,
  longitude: -79.38,
  timezone_offset: -5.0,
  day_of_year: 172,
  time_of_day: 12.0,
  room_length: 5.0,
  room_width: 4.0,
  room_height: 3.0,
  room_elevation: 0, // m above ground (e.g. 2nd floor) -- recorded only, doesn't affect sun position
  win_width: 1.5,
  win_height: 1.2,
  win_from_right: 1.0,
  win_from_floor: 0.9,
  shade_length: 0.6,
  shade_width: 1.5,
  shade_angle: 90.0,
  shade_gap: 0.0, // m, the shade is mounted this far above the window's top edge
  animation_speed: 12, // seconds for a full simulated 0-24h day cycle
  wall_resolution: 80, // grid cells per side for floor/wall heatmaps
  window_resolution: 60, // grid cells per side for the window heatmap
};

const state = { ...DEFAULTS };

function clampState(s) {
  s.day_of_year = Math.max(1, Math.min(365, Math.round(s.day_of_year)));
  s.time_of_day = Math.max(0, Math.min(24, s.time_of_day));
  s.shade_angle = Math.max(0, Math.min(180, s.shade_angle));
  s.shade_length = Math.max(0, s.shade_length);
  s.shade_width = Math.max(0, s.shade_width);
  s.shade_gap = Math.max(0, s.shade_gap);
  s.room_length = Math.max(0.1, s.room_length);
  s.room_width = Math.max(0.1, s.room_width);
  s.room_height = Math.max(0.1, s.room_height);
  s.room_elevation = Math.max(0, s.room_elevation);
  s.win_width = Math.max(0.01, s.win_width);
  s.win_height = Math.max(0.01, s.win_height);
  s.animation_speed = Math.max(1, s.animation_speed);
  s.win_from_right = Math.max(0, s.win_from_right);
  s.win_from_floor = Math.max(0, s.win_from_floor);
  s.wall_resolution = Math.max(4, Math.round(s.wall_resolution));
  s.window_resolution = Math.max(4, Math.round(s.window_resolution));
  return s;
}

/* =========================================================================
   Canvas helpers
   ========================================================================= */

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w: canvas.clientWidth, h: canvas.clientHeight, dpr };
}

// Largest centered rect with the given aspect ratio that fits inside `outer`.
function fitRect(outer, aspectW, aspectH) {
  const outerAspect = outer.w / outer.h;
  const targetAspect = aspectW / aspectH;
  let w, h;
  if (targetAspect > outerAspect) {
    w = outer.w;
    h = w / targetAspect;
  } else {
    h = outer.h;
    w = h * targetAspect;
  }
  return { x: outer.x + (outer.w - w) / 2, y: outer.y + (outer.h - h) / 2, w, h };
}

// Returns a mapper world(x,y) -> pixel [px,py]; vertical axis is flipped (up = up).
function makeMapper(rect, xMin, xMax, yMin, yMax) {
  const sx = rect.w / (xMax - xMin);
  const sy = rect.h / (yMax - yMin);
  return (wx, wy) => [rect.x + (wx - xMin) * sx, rect.y + rect.h - (wy - yMin) * sy];
}

function lerpColor(t, c0, c1) {
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  return [r, g, b];
}

const DARK_RGB = [13, 13, 26]; // #0d0d1a
const GOLD_RGB = [255, 215, 0]; // #FFD700

// Builds (once) and reuses an offscreen canvas for the n x n heatmap texture.
const heatTextureCache = new Map();
function getHeatTexture(n) {
  if (!heatTextureCache.has(n)) {
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    heatTextureCache.set(n, c);
  }
  return heatTextureCache.get(n);
}

function drawHeatmapPanel(canvas, mapArr, n, rect) {
  const tex = getHeatTexture(n);
  const tctx = tex.getContext("2d");
  const img = tctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const [r, g, b] = lerpColor(mapArr[i], DARK_RGB, GOLD_RGB);
    img.data[i * 4 + 0] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tex, 0, 0, n, n, rect.x, rect.y, rect.w, rect.h);
}

function drawMeterGrid(ctx, rect, xMax, yMax) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  const map = makeMapper(rect, 0, xMax, 0, yMax);
  for (let x = 0; x <= Math.floor(xMax + 1e-9); x++) {
    const [px] = map(x, 0);
    ctx.beginPath();
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.h);
    ctx.stroke();
  }
  for (let y = 0; y <= Math.floor(yMax + 1e-9); y++) {
    const [, py] = map(0, y);
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.w, py);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDashedLine(ctx, p0, p1) {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.stroke();
  ctx.restore();
}

function drawDashedRect(ctx, map, x0, y0, x1, y1) {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.6;
  const [px0, py0] = map(x0, y0);
  const [px1, py1] = map(x1, y1);
  ctx.strokeRect(Math.min(px0, px1), Math.min(py0, py1), Math.abs(px1 - px0), Math.abs(py1 - py0));
  ctx.restore();
}

/* =========================================================================
   Panel definitions + render pipeline
   ========================================================================= */

const PANEL_IDS = ["floor", "north", "east", "west"];
const canvases = {};
for (const id of PANEL_IDS) canvases[id] = document.getElementById(`canvas-${id}`);
const southCanvas = document.getElementById("canvas-south");
const pctEls = {};
for (const id of PANEL_IDS) pctEls[id] = document.getElementById(`pct-${id}`);

function setPanelAspect(id, w, h) {
  const wrap = canvases[id].parentElement;
  wrap.style.aspectRatio = `${w} / ${h}`;
}

function renderSurfacePanels(room, win, maps, pcts, n) {
  const { xLeft: xl, xRight: xr, zBottom: zb, zTop: zt } = windowEdges(room, win);
  const Lx = room.length, Ly = room.width, Lz = room.height;

  const specs = {
    floor: { xMax: Lx, yMax: Ly, aspectW: Lx, aspectH: Ly, overlay: "south-edge" },
    north: { xMax: Lx, yMax: Lz, aspectW: Lx, aspectH: Lz, overlay: "rect" },
    east:  { xMax: Ly, yMax: Lz, aspectW: Ly, aspectH: Lz, overlay: "none" },
    west:  { xMax: Ly, yMax: Lz, aspectW: Ly, aspectH: Lz, overlay: "none" },
  };

  for (const id of PANEL_IDS) {
    const spec = specs[id];
    setPanelAspect(id, spec.aspectW, spec.aspectH);
    const canvas = canvases[id];
    const { w, h } = resizeCanvasToDisplaySize(canvas);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvas.width / w, canvas.height / h);

    const rect = { x: 0, y: 0, w, h };
    drawHeatmapPanel(canvas, maps[id], n, rect);
    drawMeterGrid(ctx, rect, spec.xMax, spec.yMax);

    const map = makeMapper(rect, 0, spec.xMax, 0, spec.yMax);
    if (spec.overlay === "south-edge") {
      // south wall sits at y=0 -> bottom edge of the floor panel
      const p0 = map(xl, 0);
      const p1 = map(xr, 0);
      p0[1] -= 1.5; p1[1] -= 1.5;
      drawDashedLine(ctx, p0, p1);
    } else if (spec.overlay === "rect") {
      drawDashedRect(ctx, map, xl, zb, xr, zt);
    }

    ctx.restore();
    pctEls[id].textContent = `${pcts[id].toFixed(1)}%`;
  }
}

function renderSouthWall(room, win, shade, v, windowMap, windowN) {
  const { xLeft: xl, xRight: xr, zBottom: zb, zTop: zt } = windowEdges(room, win);
  const { xLeft: sxl, xRight: sxr, yTip, zTip, zMount } = shadeOuterEdge(room, win, shade);
  const Lx = room.length, Lz = room.height;

  const { w, h } = resizeCanvasToDisplaySize(southCanvas);
  const ctx = southCanvas.getContext("2d");
  ctx.clearRect(0, 0, southCanvas.width, southCanvas.height);
  ctx.save();
  ctx.scale(southCanvas.width / w, southCanvas.height / h);

  // Layout: main front view on the left ~58%, profile inset on the right ~40%.
  const pad = 8;
  const mainOuter = { x: pad, y: pad, w: w * 0.56 - pad, h: h - 2 * pad };
  const insetOuter = { x: w * 0.58, y: h * 0.40, w: w * 0.40, h: h * 0.56 };

  // --- Main front view (XZ) ---
  const mainRect = fitRect(mainOuter, Lx, Lz);
  ctx.fillStyle = "#2c2c3e";
  ctx.fillRect(mainOuter.x, mainOuter.y, mainOuter.w, mainOuter.h);

  const mapMain = makeMapper(mainRect, 0, Lx, 0, Lz);
  ctx.fillStyle = "#4a4a5e";
  ctx.fillRect(mainRect.x, mainRect.y, mainRect.w, mainRect.h);

  // Window: rendered as its own lit/shaded heatmap (not a solid rectangle),
  // showing exactly which part of the opening the shade currently blocks.
  {
    const [px0, py0] = mapMain(xl, zb);
    const [px1, py1] = mapMain(xr, zt);
    const winRect = {
      x: Math.min(px0, px1), y: Math.min(py0, py1),
      w: Math.abs(px1 - px0), h: Math.abs(py1 - py0),
    };
    drawHeatmapPanel(southCanvas, windowMap, windowN, winRect);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(winRect.x + 0.5, winRect.y + 0.5, winRect.w - 1, winRect.h - 1);
  }

  // Shade footprint, projected onto this elevation (depth/Y is collapsed): it
  // spans from the attachment edge (zMount -- the window top plus any gap)
  // to the tip height (zTip), so tilting the shade down (angle < 90) visibly
  // overlaps the window, tilting it up (angle > 90) visibly overlaps the
  // wall above, and a gap > 0 leaves a visible strip of wall below it.
  {
    const [fx0, fy0] = mapMain(sxl, zMount);
    const [fx1, fy1] = mapMain(sxr, zTip);
    const fx = Math.min(fx0, fx1);
    const fy = Math.min(fy0, fy1);
    const fw = Math.abs(fx1 - fx0);
    const fh = Math.max(Math.abs(fy1 - fy0), 3); // stays visible even when flat (angle = 90)

    ctx.fillStyle = "rgba(255, 119, 0, 0.55)";
    ctx.fillRect(fx, fy, fw, fh);
    ctx.strokeStyle = "#FF7700";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx + 0.5, fy + 0.5, Math.max(fw - 1, 0), Math.max(fh - 1, 0));
  }

  ctx.strokeStyle = "#888899";
  ctx.lineWidth = 1;
  ctx.strokeRect(mainRect.x + 0.5, mainRect.y + 0.5, mainRect.w - 1, mainRect.h - 1);

  ctx.fillStyle = "#aaaaaa";
  ctx.font = "11px -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("front view (from outside)", mainRect.x + 6, mainRect.y + 6);

  // --- Profile inset (YZ cross-section) ---
  const reach = Math.abs(yTip);
  const xMin = -(reach + 0.15), xMax = 0.15;
  const insetRect = fitRect(insetOuter, xMax - xMin, Lz);

  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(insetOuter.x, insetOuter.y, insetOuter.w, insetOuter.h);
  ctx.strokeStyle = "#444455";
  ctx.lineWidth = 1;
  ctx.strokeRect(insetOuter.x + 0.5, insetOuter.y + 0.5, insetOuter.w - 1, insetOuter.h - 1);

  const mapP = makeMapper(insetRect, xMin, xMax, 0, Lz);

  // wall face
  ctx.strokeStyle = "#666677";
  ctx.lineWidth = 1.2;
  {
    const p0 = mapP(0, 0), p1 = mapP(0, Lz);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  }

  // window opening
  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  {
    const p0 = mapP(0, zb), p1 = mapP(0, zt);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  }

  // shade line + arrowhead
  ctx.strokeStyle = "#FF7700";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  {
    const p0 = mapP(0, zMount), p1 = mapP(yTip, zTip);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();

    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const ah = 7;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p1[0] - ah * Math.cos(ang - 0.4), p1[1] - ah * Math.sin(ang - 0.4));
    ctx.lineTo(p1[0] - ah * Math.cos(ang + 0.4), p1[1] - ah * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = "#FF7700";
    ctx.fill();
  }

  // ceiling line
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "#555566";
  ctx.lineWidth = 1;
  {
    const p0 = mapP(xMin, Lz), p1 = mapP(xMax, Lz);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  }
  ctx.restore();

  // shade angle arc + label — angle measured from straight-down at the wall,
  // matching the shade.angle convention (0=down, 90=horizontal, 180=up).
  {
    const arcR = Math.min(reach * 0.45, 0.25);
    const angleRad = v.shade_angle * DEG2RAD;
    const steps = 24;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#FF9900";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * angleRad;
      const ay = -arcR * Math.sin(a);
      const az = zMount - arcR * Math.cos(a);
      const [px, py] = mapP(ay, az);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    const labelA = angleRad / 2;
    const lx = -arcR * 0.6 * Math.sin(labelA);
    const lz = zMount - arcR * 0.6 * Math.cos(labelA);
    const [lpx, lpy] = mapP(lx, lz);
    ctx.fillStyle = "#FF9900";
    ctx.font = "10px -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${v.shade_angle.toFixed(0)}°`, lpx, lpy);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "#aaaaaa";
  ctx.font = "10px -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("shade profile", insetRect.x, insetOuter.y + 2);

  ctx.restore();
}

/* =========================================================================
   Main update / render
   ========================================================================= */

const infoSunEl = document.getElementById("info-sun");
const infoTotalEl = document.getElementById("info-total");
const pctWindowEl = document.getElementById("pct-window");

function flash(el) {
  el.classList.remove("flash");
  el.offsetWidth; // restart animation/transition
  el.classList.add("flash");
}

function render() {
  const v = clampState({ ...state });

  const room = { length: v.room_length, width: v.room_width, height: v.room_height };
  const win = { width: v.win_width, height: v.win_height, fromRight: v.win_from_right, fromFloor: v.win_from_floor };
  const shade = { length: v.shade_length, width: v.shade_width, angle: v.shade_angle, gap: v.shade_gap };

  const { alt, az } = getSolarPosition(v.latitude, v.longitude, v.timezone_offset, v.day_of_year, v.time_of_day);
  const wallN = v.wall_resolution;
  const windowN = v.window_resolution;
  const { maps, pcts } = computeMaps(room, win, shade, alt, az, wallN);
  const { map: windowMap, pct: windowPct } = computeWindowMap(room, win, shade, alt, az, windowN);

  // Exposure mode substitutes the period-aggregate "% of sampled daylight
  // lit" data for the live per-moment lit/unlit pattern on the floor/wall
  // panels (and 3D view) -- the window/south-wall panel always stays live,
  // since exposure mode only covers the four surfaces it was computed for.
  // A resolution mismatch (wall_resolution changed since computing) would
  // make the stored arrays the wrong length, so fall back to live data then.
  const useExposure = exposureModeActive && exposureData && exposureData.wallN === wallN;
  // mapsDisplay is contrast-stretched per surface for visibility -- the %
  // labels and area totals still use the true (unstretched) pcts/maps.
  const displayMaps = useExposure ? exposureData.mapsDisplay : maps;
  const displayPcts = useExposure ? exposureData.pcts : pcts;

  renderSurfacePanels(room, win, displayMaps, displayPcts, wallN);
  renderSouthWall(room, win, shade, v, windowMap, windowN);
  pctWindowEl.textContent = `${windowPct.toFixed(1)}% unblocked`;

  const areas = {
    floor: room.length * room.width,
    north: room.length * room.height,
    east: room.width * room.height,
    west: room.width * room.height,
  };
  const total = Object.values(areas).reduce((a, b) => a + b, 0);
  const lit = PANEL_IDS.reduce((sum, id) => sum + (areas[id] * displayPcts[id]) / 100, 0);
  const overall = total > 0 ? (100 * lit) / total : 0;

  if (useExposure) {
    const rangeText = exposureData.startDoy === exposureData.endDoy
      ? dayOfYearToDateStr(exposureData.startDoy)
      : `${dayOfYearToDateStr(exposureData.startDoy)} – ${dayOfYearToDateStr(exposureData.endDoy)}`;
    infoSunEl.textContent = `exposure heatmap: ${rangeText}`;
  } else {
    infoSunEl.textContent = alt > 0 ? `altitude ${alt.toFixed(1)}°, azimuth ${az.toFixed(1)}°` : "below the horizon";
  }
  infoTotalEl.textContent = `${overall.toFixed(1)}%  (${lit.toFixed(2)} / ${total.toFixed(1)} m²)`;
  flash(infoSunEl);
  flash(infoTotalEl);
  updateExposureToggleStatus();

  // Keep the 3D view in sync if it's currently open (e.g. an animation
  // running while the user has it open) -- reuses the maps/windowMap
  // already computed above rather than recomputing them.
  if (is3DOpen()) {
    window.update3DView({
      room,
      windowEdges: windowEdges(room, win),
      shadeEdges: shadeOuterEdge(room, win, shade),
      maps: displayMaps, wallN,
      windowMap, windowN,
    });
  }
}

function is3DOpen() {
  const overlay = document.getElementById("scene3d-overlay");
  return !!overlay && overlay.classList.contains("open");
}

let rafHandle = null;
function scheduleRender() {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    render();
  });
}

/* =========================================================================
   UI binding
   ========================================================================= */

function updateSliderFill(input) {
  const min = parseFloat(input.min), max = parseFloat(input.max), val = parseFloat(input.value);
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--fill", `${pct}%`);
}

function bindNumericField(param) {
  const field = document.querySelector(`.field[data-param="${param}"]`);
  if (!field) return;
  const slider = field.querySelector(".slider");
  const number = field.querySelector(".number");

  const apply = (val) => {
    state[param] = val;
    slider.value = val;
    number.value = val;
    updateSliderFill(slider);
    scheduleRender();
  };

  slider.addEventListener("input", () => apply(parseFloat(slider.value)));
  number.addEventListener("input", () => {
    const val = parseFloat(number.value);
    if (!Number.isNaN(val)) apply(val);
  });

  // expose setter for reset()
  field._apply = apply;
}

// "Settings" — set once in the modal (location, room, window, animation speed, grid resolution).
const SETTINGS_PARAMS = [
  "latitude", "longitude", "timezone_offset",
  "room_length", "room_width", "room_height", "room_elevation",
  "win_width", "win_height", "win_from_right", "win_from_floor", "shade_gap",
  "animation_speed",
  "wall_resolution", "window_resolution",
];
// "Play" — the main, always-visible controls (shade; date/time handled separately below).
const PLAY_PARAMS = ["shade_length", "shade_width", "shade_angle"];
const NUMERIC_PARAMS = SETTINGS_PARAMS.concat(PLAY_PARAMS);

for (const p of NUMERIC_PARAMS) bindNumericField(p);

// --- Date field ---
const dateInput = document.getElementById("date-input");
const daySlider = document.getElementById("day-slider");
dateInput.min = `${REF_YEAR}-01-01`;
dateInput.max = `${REF_YEAR}-12-31`;

function applyDayOfYear(doy) {
  state.day_of_year = doy;
  daySlider.value = doy;
  dateInput.value = dayOfYearToDateStr(doy);
  updateSliderFill(daySlider);
  scheduleRender();
}

dateInput.addEventListener("input", () => {
  if (!dateInput.value) return;
  stopAllAnimations();
  applyDayOfYear(dateStrToDayOfYear(dateInput.value));
});
daySlider.addEventListener("input", () => {
  stopAllAnimations();
  applyDayOfYear(parseInt(daySlider.value, 10));
});

// --- Time field ---
const timeInput = makeTime24Input("time-input-hh", "time-input-mm");
const timeSlider = document.getElementById("time-slider");
const timeDecimalLabel = document.getElementById("time-decimal-label");

function applyTimeOfDay(hours) {
  state.time_of_day = hours;
  timeSlider.value = hours;
  timeInput.value = decimalHoursToTimeStr(hours);
  timeDecimalLabel.textContent = `(${hours.toFixed(2)}h)`;
  updateSliderFill(timeSlider);
  scheduleRender();
}

timeInput.addEventListener("input", () => {
  if (!timeInput.value) return;
  stopAllAnimations();
  applyTimeOfDay(timeStrToDecimalHours(timeInput.value));
});
timeSlider.addEventListener("input", () => {
  stopAllAnimations();
  applyTimeOfDay(parseFloat(timeSlider.value));
});

// --- Time presets (sunrise / solar noon / sunset on the current date) ---
document.querySelectorAll(".preset-btn:not(.date-preset-btn)").forEach((btn) => {
  btn.addEventListener("click", () => {
    stopAllAnimations();
    const times = computeSunTimes(state.latitude, state.longitude, state.timezone_offset, state.day_of_year);
    let hours = times[btn.dataset.preset];
    hours = Math.max(0, Math.min(24, hours));
    applyTimeOfDay(Math.round(hours * 100) / 100);
  });
});

// --- Date presets (the four solar-calendar markers) ---
const DATE_PRESET_KEYS = {
  "spring-equinox": "springEquinox",
  "summer-solstice": "summerSolstice",
  "fall-equinox": "fallEquinox",
  "winter-solstice": "winterSolstice",
};
document.querySelectorAll(".date-preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    stopAllAnimations();
    const key = DATE_PRESET_KEYS[btn.dataset.preset];
    applyDayOfYear(SOLAR_CALENDAR_DAYS[key]);
  });
});

// --- Animate: continuously sweep a value through a wrapping [min, max) cycle.
// Both animators share the same "seconds per full cycle" speed and are mutually
// exclusive (starting one stops the other) so only one axis animates at a time.
const animators = [];

function stopAllAnimations(except) {
  for (const a of animators) if (a !== except) a.stop();
}

function createCycleAnimator({ getValue, setValue, min, max, displayTransform = (v) => v, button, icon, label, playLabel, stopLabel }) {
  const anim = { playing: false, rafHandle: null, lastTimestamp: null, value: null };

  function step(now) {
    if (!anim.playing) return;
    if (anim.lastTimestamp === null) {
      anim.lastTimestamp = now;
      anim.value = getValue();
    }
    const dtSeconds = (now - anim.lastTimestamp) / 1000;
    anim.lastTimestamp = now;

    const range = max - min;
    const unitsPerSecond = range / Math.max(1, state.animation_speed);
    let next = anim.value + dtSeconds * unitsPerSecond;
    next = (((next - min) % range) + range) % range + min;
    anim.value = next;
    setValue(displayTransform(next));

    anim.rafHandle = requestAnimationFrame(step);
  }

  anim.start = function start() {
    if (anim.playing) return;
    stopAllAnimations(anim);
    anim.playing = true;
    anim.lastTimestamp = null;
    button.classList.add("playing");
    button.setAttribute("aria-pressed", "true");
    icon.textContent = "⏸";
    label.textContent = stopLabel;
    anim.rafHandle = requestAnimationFrame(step);
  };

  anim.stop = function stop() {
    if (!anim.playing) return;
    anim.playing = false;
    if (anim.rafHandle !== null) cancelAnimationFrame(anim.rafHandle);
    anim.rafHandle = null;
    button.classList.remove("playing");
    button.setAttribute("aria-pressed", "false");
    icon.textContent = "▶";
    label.textContent = playLabel;
  };

  button.addEventListener("click", () => {
    if (anim.playing) anim.stop();
    else anim.start();
  });

  animators.push(anim);
  return anim;
}

const timeAnimator = createCycleAnimator({
  getValue: () => state.time_of_day,
  setValue: applyTimeOfDay,
  min: 0,
  max: 24,
  button: document.getElementById("btn-animate-time"),
  icon: document.getElementById("animate-time-icon"),
  label: document.getElementById("animate-time-label"),
  playLabel: "Animate time",
  stopLabel: "Stop",
});

const dateAnimator = createCycleAnimator({
  getValue: () => state.day_of_year,
  setValue: applyDayOfYear,
  min: 1,
  max: 366, // day_of_year is 1-365; wrapping range [1, 366) floors back to exactly 1-365
  displayTransform: Math.floor,
  button: document.getElementById("btn-animate-date"),
  icon: document.getElementById("animate-date-icon"),
  label: document.getElementById("animate-date-label"),
  playLabel: "Animate dates",
  stopLabel: "Stop",
});

function applyParams(values, params) {
  for (const p of params) {
    const field = document.querySelector(`.field[data-param="${p}"]`);
    if (field && field._apply) field._apply(values[p]);
    else state[p] = values[p];
  }
  scheduleRender();
}

// Applies a full saved/shared configuration (every DEFAULTS key, including
// day_of_year/time_of_day which aren't part of NUMERIC_PARAMS since their
// fields are special-cased HH:MM/date widgets, not plain number inputs).
function applyConfig(config) {
  applyParams(config, NUMERIC_PARAMS);
  if (config.day_of_year !== undefined) applyDayOfYear(config.day_of_year);
  if (config.time_of_day !== undefined) applyTimeOfDay(config.time_of_day);
}

function captureCurrentConfig() {
  const v = clampState({ ...state });
  const config = {};
  for (const key of Object.keys(DEFAULTS)) config[key] = v[key];
  return config;
}

/* =========================================================================
   Shareable links + saved presets
   ========================================================================= */

function encodeShareQuery(config) {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] !== undefined) params.set(key, config[key]);
  }
  return params.toString();
}

function decodeShareQuery(search) {
  const params = new URLSearchParams(search);
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!params.has(key)) continue;
    const val = parseFloat(params.get(key));
    if (!Number.isNaN(val)) result[key] = val;
  }
  return result;
}

function buildShareUrl() {
  const qs = encodeShareQuery(captureCurrentConfig());
  return `${location.origin}${location.pathname}?${qs}`;
}

const PRESETS_KEY = "sunraycontrol_presets";

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePresetsToStorage(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

// --- Reset (scoped: settings modal vs. the main shade/time playground) ---
document.getElementById("btn-reset-settings").addEventListener("click", () => {
  applyParams(DEFAULTS, SETTINGS_PARAMS);
});
document.getElementById("btn-reset-play").addEventListener("click", () => {
  stopAllAnimations();
  applyParams(DEFAULTS, PLAY_PARAMS);
  applyDayOfYear(DEFAULTS.day_of_year);
  applyTimeOfDay(DEFAULTS.time_of_day);
});

// --- Minimum shade length finder ---
const btnOptimizeLength = document.getElementById("btn-optimize-length");
const optimizerStatusEl = document.getElementById("optimizer-status");

function setOptimizerStatus(text, kind) {
  optimizerStatusEl.textContent = text;
  optimizerStatusEl.classList.remove("error", "success");
  if (kind) optimizerStatusEl.classList.add(kind);
}

btnOptimizeLength.addEventListener("click", () => {
  const v = clampState({ ...state });

  if (v.shade_angle > 90) {
    setOptimizerStatus("Set the Angle above to 90° or less first (an angle past 90° tilts upward, away from the window, so it can't be sized this way).", "error");
    return;
  }

  const win = { width: v.win_width, height: v.win_height, fromRight: v.win_from_right, fromFloor: v.win_from_floor };

  const result = findMinimumShadeLength({
    latitude: v.latitude,
    win,
    angle: v.shade_angle,
    shadeWidth: v.shade_width,
    gap: v.shade_gap,
  });

  if (!result.found) {
    if (result.reason === "narrow") {
      setOptimizerStatus(`The shade's Width (${v.shade_width.toFixed(2)} m) is narrower than the window (${result.windowWidth.toFixed(2)} m) — widen the shade to at least the window's width first, or the window's edges can never be fully shaded.`, "error");
    } else if (result.reason === "no-sun") {
      setOptimizerStatus("The sun never rises at this latitude on the summer solstice in this model — can't size a shade for it.", "error");
    } else {
      setOptimizerStatus("No finite length solves this (unexpected) — try a different angle.", "error");
    }
    return;
  }

  const field = document.querySelector('.field[data-param="shade_length"]');
  field._apply(Math.round(result.length * 100) / 100);

  const gapNote = v.shade_gap > 0 ? ` (window height ${v.win_height.toFixed(2)} m + ${v.shade_gap.toFixed(2)} m gap)` : "";
  if (result.flush) {
    setOptimizerStatus(`Minimum length: ${result.length.toFixed(2)} m — spans from the mount height down to the window's bottom${gapNote}. At 0°, the shade is a flush cover rather than an overhang, so this length covers it by direct overlap. Note: the live panels are driven by an external-overhang shadow model and won't show this as shaded at exactly 0° — use a tiny angle like 1° if you want the live preview to match.`, "success");
  } else {
    setOptimizerStatus(`Minimum length: ${result.length.toFixed(2)} m${gapNote} — fully shades the window at summer-solstice noon (peak altitude ${result.alt.toFixed(1)}°) for a ${v.shade_angle.toFixed(0)}° angle.`, "success");
  }
});

// --- 3D room view ---
document.getElementById("btn-open-3d").addEventListener("click", () => {
  if (typeof window.open3DView !== "function") {
    alert("The 3D viewer didn't load (vendor/three.min.js or vendor/OrbitControls.js may be missing).");
    return;
  }

  const v = clampState({ ...state });
  const room = { length: v.room_length, width: v.room_width, height: v.room_height };
  const win = { width: v.win_width, height: v.win_height, fromRight: v.win_from_right, fromFloor: v.win_from_floor };
  const shade = { length: v.shade_length, width: v.shade_width, angle: v.shade_angle, gap: v.shade_gap };
  const { alt, az } = getSolarPosition(v.latitude, v.longitude, v.timezone_offset, v.day_of_year, v.time_of_day);

  const wallN = v.wall_resolution;
  const windowN = v.window_resolution;
  const { maps } = computeMaps(room, win, shade, alt, az, wallN);
  const { map: windowMap } = computeWindowMap(room, win, shade, alt, az, windowN);

  window.open3DView({
    room,
    windowEdges: windowEdges(room, win),
    shadeEdges: shadeOuterEdge(room, win, shade),
    maps, wallN,
    windowMap, windowN,
  });
});

document.getElementById("scene3d-close").addEventListener("click", () => window.close3DView());
document.getElementById("scene3d-overlay").addEventListener("click", (e) => {
  if (e.target.id === "scene3d-overlay") window.close3DView();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("scene3d-overlay").classList.contains("open")) {
    window.close3DView();
  }
});

// --- Settings modal ---
const settingsOverlay = document.getElementById("settings-overlay");
const btnOpenSettings = document.getElementById("btn-open-settings");
const btnSettingsClose = document.getElementById("settings-close");
const btnSettingsDone = document.getElementById("settings-done");

function openSettings() {
  settingsOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
  btnSettingsClose.focus();
}
function closeSettings() {
  settingsOverlay.classList.remove("open");
  document.body.style.overflow = "";
  btnOpenSettings.focus();
}
btnOpenSettings.addEventListener("click", openSettings);
btnSettingsClose.addEventListener("click", closeSettings);
btnSettingsDone.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsOverlay.classList.contains("open")) closeSettings();
});

/* =========================================================================
   CSV report — lit area swept over a date/time range.
   Runs entirely off pure functions (computeSurfacePcts / computeWindowPct),
   never touches the live canvases, render(), or the animators -- so it can't
   fight the live UI for frames, and the live UI never flickers while it runs.
   ========================================================================= */

const reportOverlay = document.getElementById("report-overlay");
const btnOpenReport = document.getElementById("btn-open-report");
const btnReportClose = document.getElementById("report-close");
const reportStartDate = document.getElementById("report-start-date");
const reportStartTime = makeTime24Input("report-start-time-hh", "report-start-time-mm");
const reportEndDate = document.getElementById("report-end-date");
const reportEndTime = makeTime24Input("report-end-time-hh", "report-end-time-mm");
const reportFrequencySelect = document.getElementById("report-frequency");
const btnReportGenerate = document.getElementById("btn-report-generate");
const btnReportDownload = document.getElementById("btn-report-download");
const reportStatusEl = document.getElementById("report-status");
const reportProgressWrap = document.getElementById("report-progress-wrap");
const reportProgressEl = document.getElementById("report-progress");

reportStartDate.min = reportEndDate.min = `${REF_YEAR}-01-01`;
reportStartDate.max = reportEndDate.max = `${REF_YEAR}-12-31`;

function openReport() {
  stopAllAnimations();
  if (!reportStartDate.value) {
    reportStartDate.value = dayOfYearToDateStr(state.day_of_year);
    reportEndDate.value = dayOfYearToDateStr(state.day_of_year);
    reportStartTime.value = "06:00";
    reportEndTime.value = "18:00";
  }
  reportOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
  btnReportClose.focus();
}
function closeReport() {
  reportOverlay.classList.remove("open");
  document.body.style.overflow = "";
  btnOpenReport.focus();
}
btnOpenReport.addEventListener("click", openReport);
btnReportClose.addEventListener("click", closeReport);
reportOverlay.addEventListener("click", (e) => {
  if (e.target === reportOverlay) closeReport();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reportOverlay.classList.contains("open")) closeReport();
});

let reportCsvBlobUrl = null;
let reportFilename = "sunraycontrol_report.csv";

function setReportStatus(text) {
  reportStatusEl.textContent = text;
}

btnReportGenerate.addEventListener("click", () => {
  stopAllAnimations(); // a live animation must never run alongside the report's own loop

  if (!reportStartDate.value || !reportStartTime.value || !reportEndDate.value || !reportEndTime.value) {
    setReportStatus("Please fill in all date/time fields.");
    return;
  }

  const startDOY = dateStrToDayOfYear(reportStartDate.value);
  const endDOY = dateStrToDayOfYear(reportEndDate.value);
  const startHour = timeStrToDecimalHours(reportStartTime.value);
  const endHour = timeStrToDecimalHours(reportEndTime.value);
  const startTotalMin = startDOY * 1440 + startHour * 60;
  const endTotalMin = endDOY * 1440 + endHour * 60;

  if (endTotalMin <= startTotalMin) {
    setReportStatus("End must be after start.");
    return;
  }

  const freqMin = parseInt(reportFrequencySelect.value, 10);

  const timestamps = [];
  for (let m = startTotalMin; m < endTotalMin; m += freqMin) timestamps.push(m);
  if (timestamps[timestamps.length - 1] !== endTotalMin) timestamps.push(endTotalMin); // always include the exact end boundary

  // Snapshot the current configuration -- the report sweeps date/time only and
  // never mutates live state, so this stays valid even if the room/shade/etc.
  // were being adjusted right before opening this dialog.
  const v = clampState({ ...state });
  const room = { length: v.room_length, width: v.room_width, height: v.room_height };
  const win = { width: v.win_width, height: v.win_height, fromRight: v.win_from_right, fromFloor: v.win_from_floor };
  const shade = { length: v.shade_length, width: v.shade_width, angle: v.shade_angle, gap: v.shade_gap };
  const wallN = v.wall_resolution;
  const windowN = v.window_resolution;

  const areas = {
    floor: room.length * room.width,
    north: room.length * room.height,
    east: room.width * room.height,
    west: room.width * room.height,
  };
  const totalArea = Object.values(areas).reduce((a, b) => a + b, 0);

  btnReportGenerate.disabled = true;
  btnReportDownload.disabled = true;
  if (reportCsvBlobUrl) {
    URL.revokeObjectURL(reportCsvBlobUrl);
    reportCsvBlobUrl = null;
  }
  reportProgressWrap.hidden = false;
  reportProgressEl.value = 0;
  setReportStatus(`Calculating... 0 / ${timestamps.length}`);

  const dataRows = [];
  const BATCH_SIZE = 25; // small enough to keep yielding control every frame

  let idx = 0;
  function processBatch() {
    const batchEnd = Math.min(idx + BATCH_SIZE, timestamps.length);
    for (; idx < batchEnd; idx++) {
      const totalMin = timestamps[idx];
      const doy = Math.floor(totalMin / 1440);
      const hour = (totalMin - doy * 1440) / 60;

      const { alt, az } = getSolarPosition(v.latitude, v.longitude, v.timezone_offset, doy, hour);
      const pcts = computeSurfacePcts(room, win, shade, alt, az, wallN);
      const windowPct = computeWindowPct(room, win, shade, alt, az, windowN);
      const lit = Object.keys(areas).reduce((sum, s) => sum + (areas[s] * pcts[s]) / 100, 0);
      const overall = totalArea > 0 ? (100 * lit) / totalArea : 0;

      dataRows.push([
        dayOfYearToDateStr(doy),
        decimalHoursToTimeStr(hour),
        alt.toFixed(2),
        az.toFixed(2),
        pcts.floor.toFixed(2),
        pcts.north.toFixed(2),
        pcts.east.toFixed(2),
        pcts.west.toFixed(2),
        windowPct.toFixed(2),
        overall.toFixed(2),
      ]);
    }

    const donePct = (100 * idx) / timestamps.length;
    reportProgressEl.value = donePct;
    setReportStatus(`Calculating... ${idx} / ${timestamps.length} (${donePct.toFixed(0)}%)`);

    if (idx < timestamps.length) {
      requestAnimationFrame(processBatch);
    } else {
      finishReport(dataRows, { v, wallN, windowN, freqMin, timestamps });
    }
  }
  requestAnimationFrame(processBatch);
});

function finishReport(dataRows, { v, wallN, windowN, freqMin, timestamps }) {
  const configLines = [
    `# SunRayControl CSV report`,
    `# Generated: ${new Date().toString()}`,
    `# Latitude (deg N): ${v.latitude}`,
    `# Longitude (deg E): ${v.longitude}`,
    `# Timezone (UTC+): ${v.timezone_offset}`,
    `# Room (m): length=${v.room_length}, width=${v.room_width}, height=${v.room_height}, elevation above ground=${v.room_elevation}`,
    `# Window (m): width=${v.win_width}, height=${v.win_height}, dist_from_right=${v.win_from_right}, dist_from_floor=${v.win_from_floor}`,
    `# Shade: length=${v.shade_length} m, width=${v.shade_width} m, angle=${v.shade_angle} deg, gap above window=${v.shade_gap} m`,
    `# Wall/floor grid resolution: ${wallN} cells/side`,
    `# Window grid resolution: ${windowN} cells/side`,
    `# Date/time range: ${reportStartDate.value} ${reportStartTime.value} to ${reportEndDate.value} ${reportEndTime.value}, every ${freqMin} min`,
    `# Rows: ${timestamps.length}`,
    `#`,
  ];
  const header = [
    "Date", "Time", "Sun Altitude (deg)", "Sun Azimuth (deg)",
    "Floor %", "North Wall %", "East Wall %", "West Wall %",
    "Window Unblocked %", "Total Lit %",
  ];

  const csv = configLines.concat([header.join(",")], dataRows.map((r) => r.join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  reportCsvBlobUrl = URL.createObjectURL(blob);
  reportFilename = `sunraycontrol_report_${reportStartDate.value}_to_${reportEndDate.value}.csv`;

  setReportStatus(`Done — ${timestamps.length} rows ready.`);
  btnReportGenerate.disabled = false;
  btnReportDownload.disabled = false;
}

btnReportDownload.addEventListener("click", () => {
  if (!reportCsvBlobUrl) return;
  const a = document.createElement("a");
  a.href = reportCsvBlobUrl;
  a.download = reportFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// --- Year overview: one cell per day of year, colored by the chosen
// surface's lit % at solar noon -- complements the optimizer (which only
// checks the single worst-case summer-solstice day) by showing the full
// annual picture at a glance.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // REF_YEAR (2025) is not a leap year
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEAR_MARKER_DAYS = new Set(Object.values(SOLAR_CALENDAR_DAYS));
const YEAR_DARK_RGB = [0, 0, 0]; // pure black for 0%, unlike the 2D panels' near-black DARK_RGB

function dayOfYearToMonthDay(doy) {
  const d = new Date(Date.UTC(REF_YEAR, 0, 1));
  d.setUTCDate(d.getUTCDate() + (doy - 1));
  return { month: d.getUTCMonth(), day: d.getUTCDate() };
}

// Day-of-year [start, end] (inclusive) of the calendar month containing doy.
function monthRangeForDoy(doy) {
  const { month } = dayOfYearToMonthDay(doy);
  let start = 1;
  for (let m = 0; m < month; m++) start += DAYS_IN_MONTH[m];
  return [start, start + DAYS_IN_MONTH[month] - 1];
}

// Meteorological seasons (Northern-hemisphere calendar convention, matching
// this app's existing "Summer/Winter solstice" button labels elsewhere).
// Winter wraps the year boundary (Dec-Jan-Feb), so its range is returned as
// [335, 59] -- start > end signals a wraparound range to expandDoyRange.
const SEASON_MONTHS = { spring: [2, 3, 4], summer: [5, 6, 7], fall: [8, 9, 10], winter: [11, 0, 1] };
function seasonRangeForDoy(doy) {
  const { month } = dayOfYearToMonthDay(doy);
  const seasonName = Object.keys(SEASON_MONTHS).find((s) => SEASON_MONTHS[s].includes(month));
  const months = SEASON_MONTHS[seasonName];
  if (seasonName === "winter") {
    const [decStart] = monthRangeForDoy(335); // Dec 1
    const febEnd = DAYS_IN_MONTH[0] + DAYS_IN_MONTH[1]; // Jan 31 + Feb 28 = day 59
    return [decStart, febEnd];
  }
  let start = 1;
  for (let m = 0; m < months[0]; m++) start += DAYS_IN_MONTH[m];
  let end = start - 1;
  for (const m of months) end += DAYS_IN_MONTH[m];
  return [start, end];
}

// Expands a [startDoy, endDoy] range (inclusive) into a plain list of day
// numbers. startDoy > endDoy means the range wraps across the year boundary
// (e.g. a Dec-Feb winter), so it's split into [start..365] + [1..end].
function expandDoyRange(startDoy, endDoy) {
  const days = [];
  if (startDoy <= endDoy) {
    for (let d = startDoy; d <= endDoy; d++) days.push(d);
  } else {
    for (let d = startDoy; d <= 365; d++) days.push(d);
    for (let d = 1; d <= endDoy; d++) days.push(d);
  }
  return days;
}

// Contrast-stretches a per-cell array to fill the full dark->gold range,
// per surface independently. Exposure fractions are usually small and don't
// vary much in absolute terms (e.g. a wall might range 0%-5% all year), so
// rendering them with the same raw 0-1 lerp used for the live (always
// binary 0/1) view would look uniformly dim -- this rescales each surface's
// own min..max to 0..1 so its internal pattern is always clearly visible,
// matching the same fix already applied to the Year overview calendar.
function contrastStretchMap(arr) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < lo) lo = arr[i];
    if (arr[i] > hi) hi = arr[i];
  }
  const range = hi - lo;
  const out = new Float32Array(arr.length);
  if (range > 1e-9) {
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - lo) / range;
  } else {
    out.set(arr); // every cell equal -- nothing to stretch, show the true (uniformly dim) value
  }
  return { arr: out, lo, hi };
}

// --- Exposure heatmap: for each cell on the floor/north/east/west surfaces,
// what fraction of sampled daylight moments across a date range was it
// directly lit? Complements the live per-moment view and the Year overview's
// per-day aggregate by showing *where* on each surface the sun reaches most
// over a whole day/month/season/year, not just how much.
//
// Samples are taken only between each day's own sunrise and sunset (not a
// fixed 0-24h clock range), so the result reads as "% of daylight exposed"
// rather than being diluted by night hours during which no cell anywhere
// could ever be lit. The 365-day/many-samples case is too slow to do
// synchronously, so this runs as a requestAnimationFrame chunk loop budgeted
// to roughly one frame each, reporting progress via callback rather than
// blocking the UI thread (same pattern as the CSV report generator).
function computeExposureMaps({ startDoy, endDoy, samplesPerDay, latitude, longitude, timezoneOffset, room, win, shade, wallN, onProgress, onDone }) {
  const days = expandDoyRange(startDoy, endDoy);

  const Lx = room.length, Ly = room.width, Lz = room.height;
  const xs = linspaceCenters(0, Lx, wallN);
  const ys = linspaceCenters(0, Ly, wallN);
  const zs = linspaceCenters(0, Lz, wallN);
  const ysN = ys.slice().reverse();
  const zsT = zs.slice().reverse();

  const sums = {
    floor: new Float64Array(wallN * wallN),
    north: new Float64Array(wallN * wallN),
    east: new Float64Array(wallN * wallN),
    west: new Float64Array(wallN * wallN),
  };
  let totalSamples = 0;

  function accumulate(sumArr, rowsFn) {
    let k = 0;
    for (let i = 0; i < wallN; i++) {
      for (let j = 0; j < wallN; j++, k++) sumArr[k] += rowsFn(i, j);
    }
  }

  let dayIdx = 0;
  const FRAME_BUDGET_MS = 18;

  function processChunk() {
    const chunkStart = performance.now();
    while (dayIdx < days.length && performance.now() - chunkStart < FRAME_BUDGET_MS) {
      const doy = days[dayIdx];
      const times = computeSunTimes(latitude, longitude, timezoneOffset, doy);
      for (let s = 0; s < samplesPerDay; s++) {
        const frac = (s + 0.5) / samplesPerDay;
        const hour = times.sunrise + frac * (times.sunset - times.sunrise);
        const { alt, az } = getSolarPosition(latitude, longitude, timezoneOffset, doy, hour);
        totalSamples++;
        const lit = makeLitTester(room, win, shade, alt, az);
        if (!lit) continue; // sun below horizon (degenerate sunrise===sunset case) -- contributes 0 everywhere
        accumulate(sums.floor, (i, j) => lit(xs[j], ysN[i], 0));
        accumulate(sums.north, (i, j) => lit(xs[j], Ly, zsT[i]));
        accumulate(sums.east, (i, j) => lit(Lx, ys[j], zsT[i]));
        accumulate(sums.west, (i, j) => lit(0, ys[j], zsT[i]));
      }
      dayIdx++;
    }

    onProgress(dayIdx, days.length);

    if (dayIdx < days.length) {
      requestAnimationFrame(processChunk);
    } else {
      const maps = {};
      const pcts = {};
      for (const surf of Object.keys(sums)) {
        const arr = new Float32Array(wallN * wallN);
        let total = 0;
        if (totalSamples > 0) {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = sums[surf][i] / totalSamples;
            total += arr[i];
          }
        }
        maps[surf] = arr;
        pcts[surf] = (100 * total) / (wallN * wallN);
      }
      onDone({ maps, pcts, totalSamples, dayCount: days.length });
    }
  }
  requestAnimationFrame(processChunk);
}

// fixedHour: null => each day's own solar noon (sun's peak altitude that
// day, via peakSolarPosition); a decimal-hours number => the same fixed
// clock time on every day (via getSolarPosition), so the user can compare
// e.g. "9am in January vs 9am in July" instead of only ever seeing noon.
function computeYearOverviewData(fixedHour) {
  const v = clampState({ ...state });
  const room = { length: v.room_length, width: v.room_width, height: v.room_height };
  const win = { width: v.win_width, height: v.win_height, fromRight: v.win_from_right, fromFloor: v.win_from_floor };
  const shade = { length: v.shade_length, width: v.shade_width, angle: v.shade_angle, gap: v.shade_gap };
  const wallN = v.wall_resolution;
  const windowN = v.window_resolution;

  const areas = {
    floor: room.length * room.width,
    north: room.length * room.height,
    east: room.width * room.height,
    west: room.width * room.height,
  };
  const totalArea = Object.values(areas).reduce((a, b) => a + b, 0);

  const data = new Array(365);
  for (let doy = 1; doy <= 365; doy++) {
    const { alt, az } = fixedHour === null
      ? peakSolarPosition(v.latitude, doy)
      : getSolarPosition(v.latitude, v.longitude, v.timezone_offset, doy, fixedHour);
    const pcts = computeSurfacePcts(room, win, shade, alt, az, wallN);
    const windowPct = computeWindowPct(room, win, shade, alt, az, windowN);
    const lit = Object.keys(areas).reduce((sum, s) => sum + (areas[s] * pcts[s]) / 100, 0);
    const total = totalArea > 0 ? (100 * lit) / totalArea : 0;
    data[doy - 1] = { floor: pcts.floor, north: pcts.north, east: pcts.east, west: pcts.west, window: windowPct, total };
  }
  return data;
}

const yearGridEl = document.getElementById("year-grid");
const yearMetricSelect = document.getElementById("year-metric-select");
let yearOverviewData = null;

function renderYearGrid() {
  if (!yearOverviewData) return;
  const metric = yearMetricSelect.value;
  yearGridEl.innerHTML = "";

  // Color-scale to this metric's own min/max across the year, not a fixed
  // 0-100% scale -- floor/wall % for a given room often only ranges over a
  // few percent all year (unlike Window Unblocked %, which swings across
  // the full 0-100%), so a fixed scale would squeeze all of that variation
  // into a sliver near the dark end and hide the seasonal pattern entirely.
  let lo = Infinity, hi = -Infinity;
  for (const day of yearOverviewData) {
    const v = day[metric];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo;

  const scaleNoteEl = document.getElementById("year-scale-note");
  scaleNoteEl.textContent = range > 1e-9
    ? `Colors scaled to this metric's own range this year: darkest = ${lo.toFixed(1)}%, brightest = ${hi.toFixed(1)}%.`
    : `Every day has the same value this year (${lo.toFixed(1)}%).`;

  let doy = 1;
  for (let m = 0; m < 12; m++) {
    const row = document.createElement("div");
    row.className = "year-row";

    const label = document.createElement("span");
    label.className = "year-month-label";
    label.textContent = MONTH_NAMES[m];
    row.appendChild(label);

    for (let d = 1; d <= 31; d++) {
      if (d > DAYS_IN_MONTH[m]) {
        const empty = document.createElement("span");
        empty.className = "year-cell-empty";
        row.appendChild(empty);
        continue;
      }
      const value = yearOverviewData[doy - 1][metric];
      // When every day has (near-)identical values, there's no per-day range to
      // scale against -- fall back to the absolute 0-100% scale instead of an
      // arbitrary midpoint, so e.g. an all-0% metric correctly renders solid
      // black rather than a misleading mid-gradient olive color.
      const t = range > 1e-9 ? (value - lo) / range : lo / 100;
      const cell = document.createElement("span");
      cell.className = "year-cell";
      if (YEAR_MARKER_DAYS.has(doy)) cell.classList.add("year-cell-marker");
      const [r, g, b] = lerpColor(Math.max(0, Math.min(1, t)), YEAR_DARK_RGB, GOLD_RGB);
      cell.style.background = `rgb(${r},${g},${b})`;
      cell.title = `${dayOfYearToDateStr(doy)}  —  ${value.toFixed(1)}%`;
      row.appendChild(cell);
      doy++;
    }

    yearGridEl.appendChild(row);
  }
}

const yearOverlay = document.getElementById("year-overlay");
const btnOpenYear = document.getElementById("btn-open-year");
const btnYearClose = document.getElementById("year-close");
const yearUseSolarNoon = document.getElementById("year-use-solar-noon");
const yearTimeRow = document.getElementById("year-time-row");
const yearTimeInput = makeTime24Input("year-time-hh", "year-time-mm");
const yearTimeSlider = document.getElementById("year-time-slider");

function currentYearFixedHour() {
  return yearUseSolarNoon.checked ? null : parseFloat(yearTimeSlider.value);
}

function recomputeYearOverview() {
  yearOverviewData = computeYearOverviewData(currentYearFixedHour());
  renderYearGrid();
}

function setYearSolarNoonMode(useNoon) {
  yearUseSolarNoon.checked = useNoon;
  yearTimeRow.classList.toggle("disabled", useNoon);
  for (const el of [document.getElementById("year-time-hh"), document.getElementById("year-time-mm"), yearTimeSlider]) {
    el.disabled = useNoon;
  }
  if (useNoon) yearHourAnimator.stop();
  recomputeYearOverview();
}

// The full 365-day recompute is heavy (each day re-runs the same per-cell
// occlusion test as a live render) -- fine for one-off changes, but calling
// it on every requestAnimationFrame while animating would visibly stutter.
// Animation drives the slider position every frame for smooth motion, but
// throttles the actual recompute+rerender to a fixed interval.
const YEAR_ANIM_RECOMPUTE_INTERVAL_MS = 120;
let yearLastAnimRecomputeAt = 0;

function applyYearTime(hours, { throttled = false } = {}) {
  yearTimeSlider.value = hours;
  yearTimeInput.value = decimalHoursToTimeStr(hours);
  updateSliderFill(yearTimeSlider);
  if (yearUseSolarNoon.checked) return;
  if (throttled) {
    const now = performance.now();
    if (now - yearLastAnimRecomputeAt < YEAR_ANIM_RECOMPUTE_INTERVAL_MS) return;
    yearLastAnimRecomputeAt = now;
  }
  recomputeYearOverview();
}

yearUseSolarNoon.addEventListener("change", () => setYearSolarNoonMode(yearUseSolarNoon.checked));
yearTimeInput.addEventListener("input", () => {
  if (!yearTimeInput.value) return;
  yearHourAnimator.stop();
  applyYearTime(timeStrToDecimalHours(yearTimeInput.value));
});
yearTimeSlider.addEventListener("input", () => {
  yearHourAnimator.stop();
  applyYearTime(parseFloat(yearTimeSlider.value));
});

const yearHourAnimator = createCycleAnimator({
  getValue: () => parseFloat(yearTimeSlider.value),
  setValue: (hours) => applyYearTime(hours, { throttled: true }),
  min: 0,
  max: 24,
  button: document.getElementById("btn-animate-year-hour"),
  icon: document.getElementById("animate-year-hour-icon"),
  label: document.getElementById("animate-year-hour-label"),
  playLabel: "Animate hours",
  stopLabel: "Stop",
});
const yearHourAnimatorStartDefault = yearHourAnimator.start;
yearHourAnimator.start = function () {
  if (yearUseSolarNoon.checked) setYearSolarNoonMode(false);
  yearHourAnimatorStartDefault();
};

let yearTimeInitialized = false;
function openYearOverview() {
  if (!yearTimeInitialized) {
    yearTimeInitialized = true;
    applyYearTime(state.time_of_day);
  }
  recomputeYearOverview();
  yearOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
  btnYearClose.focus();
}
function closeYearOverview() {
  yearHourAnimator.stop();
  yearOverlay.classList.remove("open");
  document.body.style.overflow = "";
  btnOpenYear.focus();
}
btnOpenYear.addEventListener("click", openYearOverview);
btnYearClose.addEventListener("click", closeYearOverview);
yearOverlay.addEventListener("click", (e) => {
  if (e.target === yearOverlay) closeYearOverview();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && yearOverlay.classList.contains("open")) closeYearOverview();
});
yearMetricSelect.addEventListener("change", renderYearGrid);

// --- Exposure heatmap: per-cell % of sampled daylight moments lit over a
// chosen date range, shown on the floor/wall panels (and 3D view) in place
// of the live sun position when the toggle checkbox is checked.
let exposureData = null; // { maps, pcts, wallN, configKey, startDoy, endDoy, samplesPerDay, totalSamples, dayCount }
let exposureModeActive = false;

// Only the geometry/location parameters affect exposure results -- date/time/
// animation speed don't, since the whole point of exposure mode is to show a
// period-aggregate that doesn't change as you scrub the live Date/Time.
function exposureRelevantStateKey(v) {
  return JSON.stringify([
    v.latitude, v.longitude, v.timezone_offset,
    v.room_length, v.room_width, v.room_height,
    v.win_width, v.win_height, v.win_from_right, v.win_from_floor,
    v.shade_length, v.shade_width, v.shade_angle, v.shade_gap,
    v.wall_resolution,
  ]);
}

const exposureOverlay = document.getElementById("exposure-overlay");
const btnOpenExposure = document.getElementById("btn-open-exposure");
const btnExposureClose = document.getElementById("exposure-close");
const btnExposureDone = document.getElementById("exposure-done");
const exposureStartDate = document.getElementById("exposure-start-date");
const exposureEndDate = document.getElementById("exposure-end-date");
const exposureSamplesPerDay = document.getElementById("exposure-samples-per-day");
const exposureWrapNote = document.getElementById("exposure-wrap-note");
const btnExposureCompute = document.getElementById("btn-exposure-compute");
const exposureProgressWrap = document.getElementById("exposure-progress-wrap");
const exposureProgressEl = document.getElementById("exposure-progress");
const exposureStatusEl = document.getElementById("exposure-status");
const exposureModeToggle = document.getElementById("exposure-mode-toggle");
const exposureToggleStatusEl = document.getElementById("exposure-toggle-status");

exposureStartDate.min = exposureEndDate.min = `${REF_YEAR}-01-01`;
exposureStartDate.max = exposureEndDate.max = `${REF_YEAR}-12-31`;

function setExposureRangeFields(startDoy, endDoy) {
  exposureStartDate.value = dayOfYearToDateStr(startDoy);
  exposureEndDate.value = dayOfYearToDateStr(endDoy);
  exposureWrapNote.textContent = startDoy > endDoy
    ? "This range wraps the year boundary (e.g. a Dec–Feb winter) — the end date shown continues into the following year."
    : "";
}

function openExposure() {
  if (!exposureStartDate.value) {
    setExposureRangeFields(state.day_of_year, state.day_of_year);
  }
  exposureOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
  btnExposureClose.focus();
}
function closeExposure() {
  exposureOverlay.classList.remove("open");
  document.body.style.overflow = "";
  btnOpenExposure.focus();
}
btnOpenExposure.addEventListener("click", openExposure);
btnExposureClose.addEventListener("click", closeExposure);
btnExposureDone.addEventListener("click", closeExposure);
exposureOverlay.addEventListener("click", (e) => {
  if (e.target === exposureOverlay) closeExposure();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && exposureOverlay.classList.contains("open")) closeExposure();
});

document.querySelectorAll(".exposure-preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const doy = state.day_of_year;
    if (btn.dataset.preset === "today") setExposureRangeFields(doy, doy);
    else if (btn.dataset.preset === "month") setExposureRangeFields(...monthRangeForDoy(doy));
    else if (btn.dataset.preset === "season") setExposureRangeFields(...seasonRangeForDoy(doy));
    else if (btn.dataset.preset === "year") setExposureRangeFields(1, 365);
  });
});
[exposureStartDate, exposureEndDate].forEach((el) => {
  el.addEventListener("change", () => { exposureWrapNote.textContent = ""; });
});

function setExposureStatus(text) {
  exposureStatusEl.textContent = text;
}

function updateExposureToggleStatus() {
  if (!exposureData) {
    exposureToggleStatusEl.textContent = "No exposure data computed yet.";
    return;
  }
  const v = clampState({ ...state });
  const stale = exposureData.wallN !== v.wall_resolution || exposureData.configKey !== exposureRelevantStateKey(v);
  const rangeText = exposureData.startDoy === exposureData.endDoy
    ? dayOfYearToDateStr(exposureData.startDoy)
    : `${dayOfYearToDateStr(exposureData.startDoy)} – ${dayOfYearToDateStr(exposureData.endDoy)}`;
  const base = `Computed for ${rangeText} (${exposureData.dayCount} day${exposureData.dayCount === 1 ? "" : "s"}, ${exposureData.samplesPerDay} samples/day). Colors are stretched per surface for visibility — % labels show the true average.`;
  exposureToggleStatusEl.textContent = stale
    ? `${base} Settings changed since then — recompute for accurate results.`
    : base;
}

btnExposureCompute.addEventListener("click", () => {
  if (!exposureStartDate.value || !exposureEndDate.value) {
    setExposureStatus("Please choose a start and end date.");
    return;
  }
  stopAllAnimations();

  const startDoy = dateStrToDayOfYear(exposureStartDate.value);
  const endDoy = dateStrToDayOfYear(exposureEndDate.value);
  const samplesPerDay = parseInt(exposureSamplesPerDay.value, 10);

  const v = clampState({ ...state });
  const room = { length: v.room_length, width: v.room_width, height: v.room_height };
  const win = { width: v.win_width, height: v.win_height, fromRight: v.win_from_right, fromFloor: v.win_from_floor };
  const shade = { length: v.shade_length, width: v.shade_width, angle: v.shade_angle, gap: v.shade_gap };
  const wallN = v.wall_resolution;

  btnExposureCompute.disabled = true;
  exposureProgressWrap.hidden = false;
  exposureProgressEl.value = 0;
  setExposureStatus("Calculating...");

  computeExposureMaps({
    startDoy, endDoy, samplesPerDay,
    latitude: v.latitude, longitude: v.longitude, timezoneOffset: v.timezone_offset,
    room, win, shade, wallN,
    onProgress: (done, total) => {
      const pct = (100 * done) / total;
      exposureProgressEl.value = pct;
      setExposureStatus(`Calculating... day ${done} / ${total} (${pct.toFixed(0)}%)`);
    },
    onDone: ({ maps, pcts, totalSamples, dayCount }) => {
      const mapsDisplay = {};
      const stretchRanges = {};
      for (const surf of Object.keys(maps)) {
        const { arr, lo, hi } = contrastStretchMap(maps[surf]);
        mapsDisplay[surf] = arr;
        stretchRanges[surf] = { lo: lo * 100, hi: hi * 100 };
      }
      exposureData = {
        maps, mapsDisplay, stretchRanges, pcts, wallN, totalSamples, dayCount,
        startDoy, endDoy, samplesPerDay,
        configKey: exposureRelevantStateKey(v),
      };
      btnExposureCompute.disabled = false;
      setExposureStatus(`Done — ${totalSamples} samples across ${dayCount} day${dayCount === 1 ? "" : "s"}.`);
      exposureModeToggle.disabled = false;
      exposureModeToggle.checked = true;
      exposureModeActive = true;
      updateExposureToggleStatus();
      scheduleRender();
    },
  });
});

exposureModeToggle.addEventListener("change", () => {
  exposureModeActive = exposureModeToggle.checked;
  updateExposureToggleStatus();
  scheduleRender();
});

// --- Save / Share modal ---
const shareOverlay = document.getElementById("share-overlay");
const btnOpenShare = document.getElementById("btn-open-share");
const btnShareClose = document.getElementById("share-close");
const btnShareDone = document.getElementById("share-done");
const shareLinkInput = document.getElementById("share-link-input");
const shareLinkStatusEl = document.getElementById("share-link-status");
const presetNameInput = document.getElementById("preset-name-input");
const presetSaveStatusEl = document.getElementById("preset-save-status");
const presetListEl = document.getElementById("preset-list");

function openShare() {
  shareLinkInput.value = buildShareUrl();
  shareLinkStatusEl.textContent = "";
  shareLinkStatusEl.classList.remove("success");
  renderPresetList();
  shareOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
  btnShareClose.focus();
}
function closeShare() {
  shareOverlay.classList.remove("open");
  document.body.style.overflow = "";
  btnOpenShare.focus();
}
btnOpenShare.addEventListener("click", openShare);
btnShareClose.addEventListener("click", closeShare);
btnShareDone.addEventListener("click", closeShare);
shareOverlay.addEventListener("click", (e) => {
  if (e.target === shareOverlay) closeShare();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && shareOverlay.classList.contains("open")) closeShare();
});

document.getElementById("btn-copy-link").addEventListener("click", async () => {
  const url = shareLinkInput.value;
  let copied = false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied) {
    shareLinkInput.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
  }
  shareLinkStatusEl.classList.toggle("success", copied);
  shareLinkStatusEl.textContent = copied
    ? "Copied to clipboard!"
    : "Couldn't auto-copy — the link above is selected, press Ctrl+C (Cmd+C on Mac) to copy it manually.";
});

function renderPresetList() {
  const presets = loadPresets();
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  presetListEl.innerHTML = "";

  if (names.length === 0) {
    const li = document.createElement("li");
    li.className = "preset-empty";
    li.textContent = "No saved presets yet.";
    presetListEl.appendChild(li);
    return;
  }

  for (const name of names) {
    const li = document.createElement("li");

    const nameSpan = document.createElement("span");
    nameSpan.className = "preset-name";
    nameSpan.textContent = name;
    nameSpan.title = name;
    li.appendChild(nameSpan);

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => {
      stopAllAnimations();
      applyConfig(presets[name]);
      presetSaveStatusEl.textContent = `Loaded "${name}".`;
      presetSaveStatusEl.classList.add("success");
      shareLinkInput.value = buildShareUrl();
    });
    li.appendChild(loadBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "preset-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      const current = loadPresets();
      delete current[name];
      savePresetsToStorage(current);
      renderPresetList();
    });
    li.appendChild(deleteBtn);

    presetListEl.appendChild(li);
  }
}

document.getElementById("btn-save-preset").addEventListener("click", () => {
  const name = presetNameInput.value.trim();
  if (!name) {
    presetSaveStatusEl.classList.remove("success");
    presetSaveStatusEl.textContent = "Enter a name for this preset first.";
    return;
  }
  const presets = loadPresets();
  const overwritten = Object.prototype.hasOwnProperty.call(presets, name);
  presets[name] = captureCurrentConfig();
  savePresetsToStorage(presets);
  presetNameInput.value = "";
  presetSaveStatusEl.classList.add("success");
  presetSaveStatusEl.textContent = overwritten ? `Updated "${name}".` : `Saved "${name}".`;
  renderPresetList();
});

// --- How to use modal ---
const helpOverlay = document.getElementById("help-overlay");
const btnOpenHelp = document.getElementById("btn-open-help");
const btnHelpClose = document.getElementById("help-close");
const btnHelpDone = document.getElementById("help-done");

function openHelp() {
  helpOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
  btnHelpClose.focus();
}
function closeHelp() {
  helpOverlay.classList.remove("open");
  document.body.style.overflow = "";
  btnOpenHelp.focus();
}
btnOpenHelp.addEventListener("click", openHelp);
btnHelpClose.addEventListener("click", closeHelp);
btnHelpDone.addEventListener("click", closeHelp);
helpOverlay.addEventListener("click", (e) => {
  if (e.target === helpOverlay) closeHelp();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && helpOverlay.classList.contains("open")) closeHelp();
});

// --- Resize handling ---
const resizeObserver = new ResizeObserver(() => scheduleRender());
resizeObserver.observe(document.getElementById("panels"));

/* =========================================================================
   Init
   ========================================================================= */

const initialValues = { ...DEFAULTS, ...decodeShareQuery(location.search) };
applyConfig(initialValues);
render();
