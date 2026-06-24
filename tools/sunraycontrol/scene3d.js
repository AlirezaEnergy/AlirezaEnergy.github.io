"use strict";

/* =========================================================================
   3D room view — a self-contained renderer with zero physics knowledge.
   It only knows how to draw a room/window/shade given already-computed
   lit/unlit heatmap data (the exact same Float32Arrays driving the 2D
   panels in app.js), so the 3D view can never drift out of sync with them.

   Coordinate mapping (this app's room space -> three.js space):
     our X (west->east)   -> three X, recentred so the room spans [-Lx/2, Lx/2]
     our Z (floor->ceil)  -> three Y (up)
     our Y (south->north) -> three Z, recentred so the room spans [-Ly/2, Ly/2]
   ========================================================================= */

(function () {
  // Walls' "unlit" end matches WALL_COLOR below (the south wall's solid
  // frame), so all four walls look consistent. The floor stays darker than
  // the walls, so it still reads as the floor rather than another wall.
  const WALL_DARK_RGB = [74, 74, 94]; // #4a4a5e
  const FLOOR_DARK_RGB = [13, 13, 26]; // #0d0d1a
  const SKY_RGB = [135, 206, 235]; // #87CEEB -- window's "unlit" end, so it reads as glass/sky, not wall
  const GOLD_RGB = [255, 215, 0]; // #FFD700
  const WALL_COLOR = 0x4a4a5e;
  const SHADE_COLOR = 0xff7700;
  const BACKGROUND_COLOR = 0xe8eaf0; // light, distinct from both the dark "unlit" heatmap color and the wall gray
  const EDGE_COLOR = 0xffffff; // white contrasts against both the dark "unlit" color and the lit gold

  let renderer = null, scene = null, camera = null, controls = null;
  let canvas = null, canvasWrap = null;
  let rafHandle = null;
  let roomGroup = null;

  function lerpColor(t, c0, c1) {
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
    ];
  }

  // Builds a CanvasTexture from a lit/unlit heatmap, lerping from darkRgb
  // (0 = unlit) to gold (1 = lit).
  function heatmapTexture(mapArr, n, darkRgb) {
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const [r, g, b] = lerpColor(mapArr[i], darkRgb, GOLD_RGB);
      img.data[i * 4 + 0] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    // Disable the default vertical flip so UV v maps directly and linearly
    // onto canvas row index (v=0 -> row 0, v=1 -> last row) -- this lets the
    // quad-builders below assign UVs by reasoning about canvas rows/columns
    // directly, with no separate flip bookkeeping.
    tex.flipY = false;
    return tex;
  }

  // Builds a flat quad mesh from 4 explicit world-space corners (in order:
  // the corner at uv(0,0), uv(1,0), uv(1,1), uv(0,1)) -- avoids any rotation
  // math, since every surface's orientation is instead derived directly from
  // this app's own already-validated 2D row/column conventions.
  function makeQuad(corners, color, texture) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      positions[i * 3 + 0] = corners[i][0];
      positions[i * 3 + 1] = corners[i][1];
      positions[i * 3 + 2] = corners[i][2];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const material = texture
      ? new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    return new THREE.Mesh(geometry, material);
  }

  function ensureInit() {
    if (renderer) return;
    canvasWrap = document.getElementById("scene3d-canvas-wrap");
    canvas = document.getElementById("scene3d-canvas");

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);

    camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 100;

    new ResizeObserver(resizeRenderer).observe(canvasWrap);
  }

  function resizeRenderer() {
    if (!renderer) return;
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function disposeRoomGroup() {
    if (!roomGroup) return;
    roomGroup.traverse((obj) => {
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
      if (obj.geometry) obj.geometry.dispose();
    });
    scene.remove(roomGroup);
    roomGroup = null;
  }

  function buildRoom(data, resetCamera) {
    disposeRoomGroup();
    roomGroup = new THREE.Group();

    const { room, windowEdges, shadeEdges, maps, wallN, windowMap, windowN } = data;
    const Lx = room.length, Ly = room.width, Lz = room.height;
    const cx = Lx / 2, cz = Ly / 2; // recentring offsets (our X, our Y)

    const to = (x, y, z) => [x - cx, z, y - cz];

    // Floor: row 0 = north, row n-1 = south; col 0 = west, col n-1 = east.
    roomGroup.add(makeQuad(
      [to(0, Ly, 0), to(Lx, Ly, 0), to(Lx, 0, 0), to(0, 0, 0)],
      null, heatmapTexture(maps.floor, wallN, FLOOR_DARK_RGB)
    ));

    // North wall (y = Ly): row 0 = ceiling height, row n-1 = floor; col 0 = west, col n-1 = east.
    roomGroup.add(makeQuad(
      [to(0, Ly, Lz), to(Lx, Ly, Lz), to(Lx, Ly, 0), to(0, Ly, 0)],
      null, heatmapTexture(maps.north, wallN, WALL_DARK_RGB)
    ));

    // East wall (x = Lx): row 0 = ceiling height; col 0 = south, col n-1 = north.
    roomGroup.add(makeQuad(
      [to(Lx, 0, Lz), to(Lx, Ly, Lz), to(Lx, Ly, 0), to(Lx, 0, 0)],
      null, heatmapTexture(maps.east, wallN, WALL_DARK_RGB)
    ));

    // West wall (x = 0): row 0 = ceiling height; col 0 = south, col n-1 = north.
    roomGroup.add(makeQuad(
      [to(0, 0, Lz), to(0, Ly, Lz), to(0, Ly, 0), to(0, 0, 0)],
      null, heatmapTexture(maps.west, wallN, WALL_DARK_RGB)
    ));

    // South wall (y = 0): four non-overlapping segments framing the window
    // opening (top/bottom/left/right) -- a true geometric cutout, so the
    // window pane below sits in the same plane with no z-fighting risk
    // (unlike a solid backing plane with a separately-offset window pane).
    const { xLeft: xl, xRight: xr, zBottom: zb, zTop: zt } = windowEdges;
    const southSegs = [
      [0, zt, Lx, Lz], // above the window
      [0, 0, Lx, zb],  // below the window
      [0, zb, xl, zt], // left of the window
      [xr, zb, Lx, zt], // right of the window
    ];
    for (const [x0, z0, x1, z1] of southSegs) {
      if (x1 - x0 <= 1e-6 || z1 - z0 <= 1e-6) continue; // skip if the window spans the full wall
      roomGroup.add(makeQuad(
        [[x0 - cx, z1, -cz], [x1 - cx, z1, -cz], [x1 - cx, z0, -cz], [x0 - cx, z0, -cz]],
        WALL_COLOR, null
      ));
    }

    // Window pane: row 0 = top of window; col 0 = west (xLeft) side. Sits
    // exactly in the south wall's plane -- the cutout above means there's
    // no overlapping geometry behind it to fight with.
    roomGroup.add(makeQuad(
      [
        [xl - cx, zt, -cz], [xr - cx, zt, -cz],
        [xr - cx, zb, -cz], [xl - cx, zb, -cz],
      ],
      null, heatmapTexture(windowMap, windowN, SKY_RGB)
    ));

    // Shade: a real tilted panel from its mount edge (inner, on the wall --
    // possibly above the window if shade.gap > 0) to its outer tip -- same
    // length/width/angle/gap math as the south wall's 2D profile view.
    const { xLeft: sxl, xRight: sxr, yTip, zTip, zMount } = shadeEdges;
    roomGroup.add(makeQuad(
      [
        to(sxl, 0, zMount), to(sxr, 0, zMount),
        to(sxr, yTip, zTip), to(sxl, yTip, zTip),
      ],
      SHADE_COLOR, null
    ));

    // Outline the room's outer edges so its shape reads clearly regardless
    // of how dark any individual face's heatmap happens to be.
    const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(Lx, Lz, Ly));
    const edgeLines = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.85 })
    );
    edgeLines.position.set(0, Lz / 2, 0);
    roomGroup.add(edgeLines);

    // Ground grid beneath the room, for scale/orientation against the
    // background -- otherwise the room can feel like it's floating in a
    // featureless void.
    const gridSize = Math.max(Lx, Ly) * 2.5;
    const grid = new THREE.GridHelper(gridSize, 20, 0xb0b4c0, 0xd4d7de);
    grid.position.y = -0.001;
    roomGroup.add(grid);

    scene.add(roomGroup);

    // Default camera: outside/above the open-top room, 3/4 angle looking in.
    // Only set on the initial open -- a live update (e.g. while an
    // animation is running) must not snap the user's current orbit/zoom
    // back to the default view every time the data refreshes.
    if (resetCamera) {
      const dist = Math.max(Lx, Ly, Lz);
      camera.position.set(dist * 0.9, Lz + dist * 0.9, dist * 0.9);
      controls.target.set(0, Lz * 0.35, 0);
      camera.near = dist * 0.01;
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.update();
    }
  }

  function renderLoop() {
    rafHandle = requestAnimationFrame(renderLoop);
    controls.update();
    renderer.render(scene, camera);
  }

  window.open3DView = function (data) {
    ensureInit();
    buildRoom(data, true);
    document.getElementById("scene3d-overlay").classList.add("open");
    document.body.style.overflow = "hidden";
    resizeRenderer();
    if (rafHandle === null) renderLoop();
  };

  // Rebuilds the room from fresh data without touching the camera or the
  // open/closed state -- used to keep the 3D view in sync with the live 2D
  // panels (e.g. while the date/time animation is running) when it's open.
  window.update3DView = function (data) {
    if (!renderer) return; // never opened yet -- nothing to update
    buildRoom(data, false);
  };

  window.close3DView = function () {
    document.getElementById("scene3d-overlay").classList.remove("open");
    document.body.style.overflow = "";
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  };
})();
