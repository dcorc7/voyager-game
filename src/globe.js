// Interactive canvas globe: drag to rotate, wheel/pinch to zoom, animated route.
// Uses d3-geo's orthographic projection; no WebGL and no external image textures.

import {
  geoOrthographic,
  geoPath,
  geoGraticule10,
  geoInterpolate,
  geoDistance,
  geoCentroid,
} from "d3-geo";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";

const COLORS = {
  ocean0: "#14405f",
  ocean1: "#07182a",
  land: "#bda775",
  landStroke: "#6d5c38",
  grid: "rgba(255,255,255,0.07)",
  route: "#e9a425",
  routeGlow: "rgba(242,184,75,0.30)",
  start: "#44b35c",
  end: "#ca493b",
  dot: "#fff3d1",
  label: "#fff3d1",
};

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 8;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const angleDiff = (a, b) => ((((b - a) + 180) % 360) + 360) % 360 - 180;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);


// --------------------------------------
// ----------- GLOBE CREATION -----------
// --------------------------------------

export function createGlobe(canvas) {
  const ctx = canvas.getContext("2d");
  const land = feature(landTopo, landTopo.objects.land);
  const graticule = geoGraticule10();
  const projection = geoOrthographic().clipAngle(90).precision(0.5);
  const path = geoPath(projection, ctx);

  let w = 1;
  let h = 1;
  let baseScale = 100;
  let zoom = 1;
  let rotation = [0, -20]; // [lambda, phi]; the view is centred on [-lambda, -phi]

  let points = []; // [{ name, lat, lon }]
  let coords = []; // [[lon, lat]]
  let segLen = [];
  let total = 0;
  let progress = 1; // 0..1 along the route, by distance
  let labels = false;

  // ---------- tiny animation loop ----------
  const anims = new Set();
  let raf = 0;
  let follow = null;
  let tween = null;

  function schedule() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    for (const a of [...anims]) if (!a(now)) anims.delete(a);
    draw();
    if (anims.size) schedule();
  }
  function animate(duration, step, done) {
    const start = performance.now();
    const fn = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      step(t);
      if (t >= 1) {
        if (done) done();
        return false;
      }
      return true;
    };
    anims.add(fn);
    schedule();
    return fn;
  }
  function cancelAnims() {
    anims.clear();
    follow = null;
    tween = null;
  }



  // ------------------------------------
  // ---------- ROUTE GEOMETRY ----------
  // ------------------------------------

  function locate(t) {
    const segs = coords.length - 1;
    const target = t * total;
    let acc = 0;
    for (let i = 0; i < segs; i++) {
      const len = segLen[i];
      if (target <= acc + len || i === segs - 1) {
        return { i, f: clamp((target - acc) / len, 0, 1) };
      }
      acc += len;
    }
    return { i: 0, f: 0 };
  }
  function headPoint(t) {
    if (coords.length < 2) return coords[0] || [0, 0];
    const { i, f } = locate(t);
    return geoInterpolate(coords[i], coords[i + 1])(f);
  }

  function fitTarget() {
    if (!coords.length) return { c: [0, 0], zoom: 1 };
    const c = geoCentroid({ type: "MultiPoint", coordinates: coords });
    let maxD = 0;
    for (const p of coords) maxD = Math.max(maxD, geoDistance(c, p));
    const z = maxD < 1.2 ? clamp(0.82 / Math.max(Math.sin(maxD), 0.05), 1, 3) : 1;
    return { c, zoom: z };
  }

  // ---------- drawing ----------
  function drawRoute() {
    if (coords.length === 0) return;
    const segs = coords.length - 1;
    const { i: hi, f } = segs > 0 ? locate(progress) : { i: 0, f: 1 };

    if (segs > 0) {
      ctx.beginPath();
      for (let i = 0; i <= hi && i < segs; i++) {
        const end = i < hi || f >= 1 ? coords[i + 1] : geoInterpolate(coords[i], coords[i + 1])(f);
        path({ type: "LineString", coordinates: [coords[i], end] });
      }
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = COLORS.routeGlow;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = COLORS.route;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }

    // waypoint dots (only the ones the ship has reached)
    const reached = (j) => j === 0 || j <= hi || (j === hi + 1 && f >= 1) || progress >= 1;
    path.pointRadius(3);
    ctx.beginPath();
    for (let j = 1; j < coords.length - 1; j++) {
      if (reached(j)) path({ type: "Point", coordinates: coords[j] });
    }
    ctx.fillStyle = COLORS.dot;
    ctx.fill();

    path.pointRadius(6);
    ctx.beginPath();
    path({ type: "Point", coordinates: coords[0] });
    ctx.fillStyle = COLORS.start;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (segs > 0 && reached(coords.length - 1)) {
      ctx.beginPath();
      path({ type: "Point", coordinates: coords[coords.length - 1] });
      ctx.fillStyle = COLORS.end;
      ctx.fill();
      ctx.stroke();
    }

    // moving ship marker while the route is animating
    if (progress < 1 && segs > 0) {
      path.pointRadius(5);
      ctx.beginPath();
      path({ type: "Point", coordinates: headPoint(progress) });
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }

  function drawLabels() {
    const center = [-rotation[0], -rotation[1]];
    ctx.font = "13px Georgia, 'Times New Roman', serif";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const drawn = new Set();
    for (const p of points) {
      if (!p.name || drawn.has(p.name)) continue;
      if (geoDistance([p.lon, p.lat], center) > Math.PI / 2 - 0.08) continue;
      const xy = projection([p.lon, p.lat]);
      if (!xy) continue;
      drawn.add(p.name);
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 3;
      ctx.strokeText(p.name, xy[0] + 8, xy[1]);
      ctx.fillStyle = COLORS.label;
      ctx.fillText(p.name, xy[0] + 8, xy[1]);
    }
  }

  function draw() {
    const r = baseScale * zoom;
    projection.translate([w / 2, h / 2]).scale(r).rotate([rotation[0], rotation[1], 0]);
    ctx.clearRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w / 2, h / 2, r * 0.98, w / 2, h / 2, r * 1.12);
    glow.addColorStop(0, "rgba(90,170,255,0.35)");
    glow.addColorStop(1, "rgba(90,170,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const ocean = ctx.createRadialGradient(w / 2 - r * 0.35, h / 2 - r * 0.35, r * 0.1, w / 2, h / 2, r);
    ocean.addColorStop(0, COLORS.ocean0);
    ocean.addColorStop(1, COLORS.ocean1);
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = ocean;
    ctx.fill();

    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.beginPath();
    path(land);
    ctx.fillStyle = COLORS.land;
    ctx.fill();
    ctx.strokeStyle = COLORS.landStroke;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    drawRoute();
    if (labels) drawLabels();

    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }



  // ----------------------------
  // ---------- SIZING ----------
  // ----------------------------

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseScale = Math.min(w, h) / 2 - 6;
    schedule();
  }
  new ResizeObserver(resize).observe(canvas);

  // ---------- camera ----------
  function setZoom(z) {
    zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    schedule();
  }
  function normalizeLambda() {
    rotation[0] = ((((rotation[0] + 180) % 360) + 360) % 360) - 180;
  }
  function tweenTo(lambda, phi, z, ms) {
    if (tween) anims.delete(tween);
    const r0 = rotation.slice();
    const z0 = zoom;
    const dl = angleDiff(r0[0], lambda);
    tween = animate(ms, (t) => {
      const e = ease(t);
      rotation[0] = r0[0] + dl * e;
      rotation[1] = r0[1] + (phi - r0[1]) * e;
      zoom = z0 + (z - z0) * e;
      if (t >= 1) normalizeLambda();
    });
  }
  function recenter(ms = 1200) {
    const { c, zoom: z } = fitTarget();
    tweenTo(-c[0], -c[1], z, ms);
  }

  function stopFollow() {
    if (follow) {
      anims.delete(follow);
      follow = null;
      progress = 1;
    }
  }

  function replay() {
    cancelAnims();
    if (coords.length < 2) {
      progress = 1;
      recenter();
      return;
    }
    progress = 0;
    rotation = [-coords[0][0], -coords[0][1]];
    zoom = 1.5;
    const dur = clamp(total * 2600, 4500, 11000);
    follow = animate(
      dur,
      (t) => {
        progress = t;
        const [lon, lat] = headPoint(t);
        rotation[0] += angleDiff(rotation[0], -lon) * 0.1;
        rotation[1] += (-lat - rotation[1]) * 0.1;
        zoom += (1.45 - zoom) * 0.04;
      },
      () => {
        follow = null;
        progress = 1;
        recenter(1400);
      }
    );
  }



  // --------------------------------
  // ---------- PUBLIC API ----------
  // --------------------------------

  function setRoute(route) {
    cancelAnims();
    points = route.map((p) => ({ name: p.name || null, lat: p.lat, lon: p.lon }));
    coords = points.map((p) => [p.lon, p.lat]);
    segLen = [];
    total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const len = Math.max(geoDistance(coords[i], coords[i + 1]), 0.03);
      segLen.push(len);
      total += len;
    }
    labels = false;
    progress = 1;
    resize();
    replay();
  }

  /** Show the finished route with place names. */
  function finish() {
    cancelAnims();
    progress = 1;
    labels = true;
    recenter(900);
    schedule();
  }

  // ---------- pointer / wheel / keyboard ----------
  const pointers = new Map();
  let pinchDist = 0;
  const pinchDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopFollow();
    if (tween) {
      anims.delete(tween);
      tween = null;
    }
    if (pointers.size === 2) pinchDist = pinchDistance();
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) {
      const k = 0.28 / zoom;
      rotation[0] += dx * k;
      rotation[1] = clamp(rotation[1] - dy * k, -90, 90);
      normalizeLambda();
      schedule();
    } else if (pointers.size === 2) {
      const d = pinchDistance();
      setZoom(zoom * (d / pinchDist));
      pinchDist = d;
    }
  });
  const release = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stopFollow();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false }
  );
  canvas.addEventListener("keydown", (e) => {
    const step = 10 / zoom;
    const handled = {
      ArrowLeft: () => (rotation[0] += step),
      ArrowRight: () => (rotation[0] -= step),
      ArrowUp: () => (rotation[1] = clamp(rotation[1] - step, -90, 90)),
      ArrowDown: () => (rotation[1] = clamp(rotation[1] + step, -90, 90)),
      "+": () => setZoom(zoom * 1.25),
      "=": () => setZoom(zoom * 1.25),
      "-": () => setZoom(zoom / 1.25),
    }[e.key];
    if (handled) {
      e.preventDefault();
      stopFollow();
      handled();
      normalizeLambda();
      schedule();
    }
  });

  resize();
  draw();

  return {
    setRoute,
    finish,
    replay,
    recenter: () => {
      stopFollow();
      recenter();
    },
    zoomBy: (factor) => setZoom(zoom * factor),
  };
}
