/* ============================================================================
   THE FLOW — app
   A camera riding the coolant through a pipe. Scroll = flow.
   Plain <script> (no build step). Needs: three, gsap, ScrollTrigger, lenis, CV.
   ========================================================================== */
(function () {
"use strict";

const TAU = Math.PI * 2;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = matchMedia("(max-width: 720px)").matches;

/* palette — stays in the blue family, blended */
const COL = {
  bg:      new THREE.Color("#070A0F"),
  indigo:  new THREE.Color("#3B2E8C"),
  deep:    new THREE.Color("#152C6E"),
  blue:    new THREE.Color("#1D4ED8"),
  bright:  new THREE.Color("#3B82F6"),
  cyan:    new THREE.Color("#5FE3FF"),
};

/* ---------------------------------------------------------------- renderer */
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 500);

/* ---------------------------------------------------------------- the path */
/* a long pipe that sinks and coils; generally heads -Z */
const ctrl = [];
const TURNS = 5.2, LEN = 520, DROP = 40;
for (let i = 0; i <= 22; i++) {
  const u = i / 22;
  const wob = Math.sin(u * 7.0) * 0.5 + Math.sin(u * 2.3) * 1.0;
  ctrl.push(new THREE.Vector3(
    Math.sin(u * Math.PI * TURNS) * (5.5 + wob),
    Math.cos(u * Math.PI * (TURNS * 0.7)) * 3.2 - u * DROP,
    -u * LEN
  ));
}
const curve = new THREE.CatmullRomCurve3(ctrl, false, "catmullrom", 0.5);

/* bake samples + Frenet frames once — cheap lookups every frame */
const N = 700;
const P = new Array(N + 1), T = new Array(N + 1);
for (let i = 0; i <= N; i++) { P[i] = curve.getPointAt(i / N); T[i] = curve.getTangentAt(i / N); }
const frames = curve.computeFrenetFrames(N, false); // .normals .binormals

function sampleAt(p, outPos, outTan) {
  p = Math.min(0.99999, Math.max(0, p));
  const f = p * N, i = Math.floor(f), k = f - i, j = Math.min(N, i + 1);
  outPos.copy(P[i]).lerp(P[j], k);
  if (outTan) outTan.copy(T[i]).lerp(T[j], k).normalize();
}
const _n = new THREE.Vector3(), _b = new THREE.Vector3();
function frameAt(p, outN, outB) {
  const f = p * N, i = Math.floor(f), k = f - i, j = Math.min(N, i + 1);
  outN.copy(frames.normals[i]).lerp(frames.normals[j], k).normalize();
  outB.copy(frames.binormals[i]).lerp(frames.binormals[j], k).normalize();
}

/* ---------------------------------------------------------------- gates
   Degree/training gates recolour the pipe: red = chapter opens,
   green = chapter passed, purple = professional training. Up to 5. */
const GATE_RGB = {
  start: [1.00, 0.28, 0.28],   // red
  done:  [0.16, 0.85, 0.50],   // green
  train: [0.62, 0.42, 1.00]    // purple
};
function buildGateUniforms() {
  const list = CV.stations.filter(s => s.gate).slice(0, 5).map(s => {
    const c = GATE_RGB[s.gate] || GATE_RGB.start;
    return new THREE.Vector4(c[0], c[1], c[2], s.t);
  });
  while (list.length < 5) list.push(new THREE.Vector4(0, 0, 0, -9.0)); // inert
  return list;
}

/* ---------------------------------------------------------------- pipe wall */
const wallMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    uFlow: { value: 0 }, uSpeed: { value: 0 },
    cDeep: { value: COL.deep }, cIndigo: { value: COL.indigo },
    cBlue: { value: COL.blue }, cBright: { value: COL.bright }, cCyan: { value: COL.cyan },
    cBg: { value: COL.bg },
    uFadeNear: { value: 10.0 }, uFadeFar: { value: 150.0 },
    uDim: { value: (matchMedia("(max-width: 720px)").matches ? 0.72 : 1.0) },
    /* gates tint the tunnel itself: xyz = colour, w = position along pipe */
    uGates: { value: buildGateUniforms() }
  },
  vertexShader: `
    varying vec2 vUv; varying float vDist; varying vec3 vN; varying vec3 vView;
    void main(){
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position,1.0);
      vView = normalize(-mv.xyz);
      vN = normalize(normalMatrix * normal);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv; varying float vDist; varying vec3 vN; varying vec3 vView;
    uniform float uFlow, uSpeed, uFadeNear, uFadeFar, uDim;
    uniform vec3 cDeep, cIndigo, cBlue, cBright, cCyan, cBg;
    uniform vec4 uGates[5];
    float band(float x, float w){ float d = abs(fract(x) - 0.5); return smoothstep(w, 0.0, d - (0.5 - w)); }
    void main(){
      float along = vUv.y * 150.0 - uFlow * 6.0;              // rushing weld rings
      float weld  = band(along, 0.020);
      float gauge = band(vUv.y * 30.0 - uFlow * 1.2, 0.028);  // fewer, brighter gauge rings
      float seam  = smoothstep(0.012, 0.0, min(vUv.x, 1.0 - vUv.x));
      float ribs  = band(vUv.x * 24.0, 0.06) * 0.06;

      float tone = 0.5 + 0.5 * sin(vUv.y * 2.4 + vUv.x * 6.28);
      vec3 base = mix(cDeep, cIndigo, tone) * 0.05;

      float rim = pow(1.0 - abs(dot(vView, vN)), 4.0);        // tight grazing rim only
      vec3 lines = cBright * (weld * 0.32 + seam * 0.16 + ribs)
                 + cCyan   * (gauge * 0.28)
                 + cBlue   * (rim   * 0.10);

      vec3 col = base + lines + cCyan * uSpeed * weld * 1.2;

      // gate zones: the ENTIRE tunnel becomes red (chapter opens) or green
      // (chapter passed) — full colour plateau at the gate, blending back to
      // blue on the way to the next station.
      // NOTE: vUv.x runs ALONG the tube (0..1 = position on the path);
      // vUv.y runs AROUND it. The zone must be keyed on vUv.x.
      for (int gi = 0; gi < 5; gi++) {
        float gd = abs(vUv.x - uGates[gi].w);
        float inf = 1.0 - smoothstep(0.02, 0.052, gd);   // 1 at gate, 0 past halfway out
        vec3 gc = uGates[gi].xyz;
        float lum = dot(col, vec3(0.35, 0.45, 0.20));    // keep rings/seams structure
        vec3 gated = gc * (lum * 2.2 + 0.02) + gc * (weld * 0.5 + gauge * 0.35);
        col = mix(col, gated, inf);
      }

      float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDist);
      col = mix(cBg, col, fade);
      col *= smoothstep(2.0, 7.0, vDist);                     // don't blow out when wall is right on the lens
      gl_FragColor = vec4(col * uDim, 1.0);
    }`
});
const wall = new THREE.Mesh(new THREE.TubeGeometry(curve, 460, 3.4, 22, false), wallMat);
scene.add(wall);

/* ---------------------------------------------------------------- coolant sleeve */
const coolMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false,
  blending: THREE.NormalBlending,
  uniforms: {
    uFlow: { value: 0 }, uSpeed: { value: 0 },
    cBlue: { value: COL.blue }, cCyan: { value: COL.cyan },
    uFadeNear: { value: 5.0 }, uFadeFar: { value: 70.0 },
    uDim: { value: (matchMedia("(max-width: 720px)").matches ? 0.45 : 1.0) },
    uGates: { value: buildGateUniforms() }
  },
  vertexShader: `
    varying vec2 vUv; varying float vDist;
    void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0);
      vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv; varying float vDist;
    uniform float uFlow, uSpeed, uFadeNear, uFadeFar, uDim;
    uniform vec3 cBlue, cCyan;
    uniform vec4 uGates[5];
    void main(){
      float y = vUv.y * 40.0 - uFlow * 5.0;
      float c1 = sin(y + sin(vUv.x * 12.0 + uFlow) * 1.5);
      float c2 = sin(y * 0.5 - vUv.x * 8.0 + uFlow * 0.6);
      float caustic = smoothstep(0.72, 1.0, c1 * 0.6 + c2 * 0.5 + 0.4);
      float veil = 0.03 + 0.05 * (0.5 + 0.5 * sin(y * 0.2));
      vec3 col = mix(cBlue, cCyan, caustic) * (0.5 + caustic * 0.5 + uSpeed * 1.0);
      // the coolant itself turns red/green inside a gate zone
      // (vUv.x runs along the tube; vUv.y runs around it)
      for (int gi = 0; gi < 5; gi++) {
        float inf = 1.0 - smoothstep(0.02, 0.05, abs(vUv.x - uGates[gi].w));
        float lum = dot(col, vec3(0.35, 0.45, 0.20));
        col = mix(col, uGates[gi].xyz * (lum * 1.6 + 0.25), inf);
      }
      float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDist);
      float a = (veil + caustic * 0.22) * fade * smoothstep(2.0, 6.0, vDist);
      gl_FragColor = vec4(col, a * uDim);
    }`
});
scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 280, 2.55, 14, false), coolMat));

/* ---------------------------------------------------------------- particles */
const COUNT = reduced ? 400 : (isMobile ? 1100 : 2200);
const pGeo = new THREE.BufferGeometry();
const pos = new Float32Array(COUNT * 3);
const seedA = new Float32Array(COUNT);      // param along path 0..1
const seedR = new Float32Array(COUNT * 2);  // radius, angle
const aShade = new Float32Array(COUNT);     // colour pick
for (let i = 0; i < COUNT; i++) {
  seedA[i] = Math.random();
  seedR[i * 2] = Math.pow(Math.random(), 0.7) * 2.15;
  seedR[i * 2 + 1] = Math.random() * TAU;
  aShade[i] = Math.random();
}
pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
pGeo.setAttribute("aShade", new THREE.BufferAttribute(aShade, 1));

function discTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.35, "rgba(200,224,255,0.8)");
  rg.addColorStop(1, "rgba(120,170,255,0)");
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uMap: { value: discTexture() }, uSize: { value: isMobile ? 18 : 26 },
              uSpeed: { value: 0 }, cBlue: { value: COL.bright }, cCyan: { value: COL.cyan } },
  vertexShader: `
    attribute float aShade; varying float vShade; varying float vFade;
    uniform float uSize, uSpeed;
    void main(){
      vShade = aShade;
      vec4 mv = modelViewMatrix * vec4(position,1.0);
      float d = -mv.z;
      vFade = smoothstep(1.0, 4.0, d) * (1.0 - smoothstep(30.0, 110.0, d));
      gl_PointSize = clamp((uSize * (1.0 + uSpeed*4.0)) / max(0.4, d), 1.0, 34.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D uMap; uniform vec3 cBlue, cCyan;
    varying float vShade; varying float vFade;
    void main(){
      float a = texture2D(uMap, gl_PointCoord).a;
      vec3 col = mix(cBlue, cCyan, vShade);
      gl_FragColor = vec4(col, a * vFade * 0.5);
    }`
});
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
scene.add(points);

const _pp = new THREE.Vector3();
function updateParticles(dt, speed) {
  const adv = (isMobile ? 0.012 : 0.015) + speed * 0.9;
  for (let i = 0; i < COUNT; i++) {
    let t = seedA[i] + (performance.now() * 0.00001) + adv * (0.4 + seedR[i * 2] * 0.25);
    t = t - Math.floor(t);
    const f = t * N, idx = Math.floor(f), kk = f - idx, jd = Math.min(N, idx + 1);
    _pp.copy(P[idx]).lerp(P[jd], kk);
    _n.copy(frames.normals[idx]).lerp(frames.normals[jd], kk);
    _b.copy(frames.binormals[idx]).lerp(frames.binormals[jd], kk);
    const r = seedR[i * 2], ang = seedR[i * 2 + 1] + t * 26.0;
    pos[i * 3]     = _pp.x + (_n.x * Math.cos(ang) + _b.x * Math.sin(ang)) * r;
    pos[i * 3 + 1] = _pp.y + (_n.y * Math.cos(ang) + _b.y * Math.sin(ang)) * r;
    pos[i * 3 + 2] = _pp.z + (_n.z * Math.cos(ang) + _b.z * Math.sin(ang)) * r;
  }
  pGeo.attributes.position.needsUpdate = true;
}

/* ---------------------------------------------------------------- station markers */
const modeColor = {
  aero: COL.cyan, mold: COL.bright, battery: COL.blue, stress: COL.cyan,
  emotor: COL.bright, flux: COL.cyan, network: COL.blue, iso: COL.bright, bvs: COL.cyan
};
const markers = [];
const flangeGeo = new THREE.TorusGeometry(3.15, 0.10, 8, 48);
const haloGeo = new THREE.RingGeometry(2.2, 3.6, 48);
CV.stations.forEach((st) => {
  const g = new THREE.Group();
  const p = new THREE.Vector3(), tan = new THREE.Vector3();
  sampleAt(st.t, p, tan);
  g.position.copy(p);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.clone().normalize());

  const c = st.gate === "start" ? new THREE.Color("#FF6B6B")
          : st.gate === "done"  ? new THREE.Color("#3ECF8E")
          : st.gate === "train" ? new THREE.Color("#9E6BFF")
          : (modeColor[st.mode] || COL.bright);
  const flange = new THREE.Mesh(flangeGeo, new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  // a few short branch stubs -> reads as a junction
  for (let k = 0; k < 4; k++) {
    const stub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 2.4, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    const a = k * Math.PI / 2 + Math.PI / 4;
    stub.position.set(Math.cos(a) * 3.1, Math.sin(a) * 3.1, 0);
    stub.rotation.z = a;
    g.add(stub);
  }
  g.add(flange, halo);

  // per-job background scene, parented so it inherits the junction's orientation
  let fx = null;
  const sceneMode = ({ venture: "mold", training: "iso" })[st.mode] || st.mode;
  if (window.SceneFX) {
    try { fx = window.SceneFX.make(sceneMode, c); g.add(fx.group); } catch (e) { fx = null; }
  }

  scene.add(g);
  markers.push({ st, g, fx, mats: [flange.material, halo.material, ...g.children.slice(0, 4).map(m => m.material)] });
});

/* ------------------------------------------------ the entrance
   From outside, a BackSide tube is invisible — so the opening shot needs its
   own geometry: a glowing mouth ring, an outer shell, and a soft halo disc. */
const entrance = new THREE.Group();
{
  const p0 = P[0].clone(), t0 = T[0].clone().normalize();
  const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t0);

  const ringIn = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.09, 10, 64),
    new THREE.MeshBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  const ringIn2 = new THREE.Mesh(
    new THREE.TorusGeometry(3.75, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({ color: COL.bright, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  // soft halo behind the mouth
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 6.4, 64),
    new THREE.MeshBasicMaterial({ color: COL.blue, transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  // outer shell so the pipe has a body when seen from outside
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(3.58, 3.58, 30, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x0C1730, transparent: true, opacity: 0.92,
      side: THREE.FrontSide, depthWrite: true }));
  shell.geometry.rotateX(Math.PI / 2);       // align cylinder axis with +Z
  shell.position.z = -15;                    // extend inward from the mouth
  const shellRim = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.6, 30, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: COL.blue, transparent: true, opacity: 0.08,
      side: THREE.FrontSide, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shellRim.geometry.rotateX(Math.PI / 2);
  shellRim.position.z = -15;

  entrance.add(ringIn, ringIn2, halo, shell, shellRim);
  entrance.position.copy(p0);
  entrance.quaternion.copy(q0);
  entrance._mats = [ringIn.material, ringIn2.material, halo.material, shell.material, shellRim.material];
  entrance._base = [0.9, 0.5, 0.10, 0.92, 0.08];
}
scene.add(entrance);

/* the outro: the pipe opens into space — a bright mouth ring at the end */
const mouth = new THREE.Mesh(
  new THREE.TorusGeometry(3.2, 0.14, 10, 60),
  new THREE.MeshBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false })
);
{ const p = new THREE.Vector3(), tan = new THREE.Vector3(); sampleAt(0.988, p, tan);
  mouth.position.copy(p); mouth.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), tan.normalize()); }
scene.add(mouth);

/* ---------------------------------------------------------------- dwell map */
/* The first PIN of scroll is the approach: camera outside the pipe, diving in.
   After that, scroll (PIN..1) -> pipe param (0..1), easing to a near-stop at
   every station so each job "arrives" instead of whizzing past. */
const PIN = 0.055;
const _anchors = [{ s: PIN, t: 0 }]
  .concat(CV.stations.map(st => ({ s: st.s, t: st.t })))
  .concat([{ s: 1, t: 0.985 }]);
function smoother(x) { x = Math.max(0, Math.min(1, x)); return x * x * x * (x * (x * 6 - 15) + 10); }
function dwellMap(p) {
  p = Math.max(PIN, Math.min(1, p));
  let i = 0;
  while (i < _anchors.length - 2 && p > _anchors[i + 1].s) i++;
  const A = _anchors[i], B = _anchors[i + 1];
  const span = (B.s - A.s) || 1e-6;
  return A.t + (B.t - A.t) * smoother((p - A.s) / span);
}

/* ---------------------------------------------------------------- camera rig */
let progress = 0, target = 0, speed = 0, camT = 0, prevCamT = 0;
const camPos = new THREE.Vector3(), camTan = new THREE.Vector3();
const look = new THREE.Vector3(), upN = new THREE.Vector3(), upB = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener("pointermove", (e) => {
  mouse.tx = (e.clientX / innerWidth - 0.5) * 2;
  mouse.ty = (e.clientY / innerHeight - 0.5) * 2;
});

function positionCamera(cp) {
  cp = Math.min(0.985, Math.max(0.0, cp));
  sampleAt(cp, camPos, camTan);
  sampleAt(Math.min(0.995, cp + 0.02), look, null);
  frameAt(cp, upN, upB);

  mouse.x += (mouse.tx - mouse.x) * 0.05;
  mouse.y += (mouse.ty - mouse.y) * 0.05;
  const right = camTan.clone().cross(worldUp).normalize();
  camPos.addScaledVector(right, mouse.x * 0.5);
  camPos.addScaledVector(upN, -mouse.y * 0.4);

  camera.position.copy(camPos);
  // bank into the bend: tilt "up" toward the curve's inner normal
  const up = worldUp.clone().lerp(upN, 0.32).normalize();
  camera.up.copy(up);
  camera.lookAt(look);
}

/* the opening shot: hover outside the mouth, then dive through it */
const _mouthPos = P[0].clone();
const _tan0 = T[0].clone().normalize();
const _extPos = _mouthPos.clone()
  .addScaledVector(_tan0, -11)                                  // pulled back out
  .addScaledVector(new THREE.Vector3(1, 0, 0), -3.2)            // off to the side
  .addScaledVector(new THREE.Vector3(0, 1, 0), 1.6);            // slightly above
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
function rigCamera(p) {
  if (p < PIN) {
    const k = smoother(p / PIN);
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    _v1.lerpVectors(_extPos, _mouthPos, k);
    _v1.x += mouse.x * (1 - k) * 0.8; _v1.y -= mouse.y * (1 - k) * 0.6;
    // look: at the mouth first, then into the throat
    _v2.copy(_mouthPos).addScaledVector(_tan0, k * 4 + 0.5);
    camera.position.copy(_v1);
    camera.up.set(0, 1, 0);
    camera.lookAt(_v2);
  } else {
    positionCamera(camT);
  }
}

/* ---------------------------------------------------------------- HTML: stations */
const stage = document.getElementById("stations");
/* page-level layer for video projections — must NOT sit inside a faded
   ancestor, or mix-blend-mode:screen stops seeing the pipe behind it */
const projLayer = document.createElement("div");
projLayer.id = "projections";
document.body.insertBefore(projLayer, stage);
const nodes = [];
function esc(s){ return String(s); }
CV.stations.forEach((st, i) => {
  const el = document.createElement("article");
  el.className = "overlay station";
  el.dataset.idx = i;
  const hasImg = !!st.img;
  // education & training are waypoints — no visual panel unless given an image
  const hasViz = !hasImg && st.kind !== "edu" && st.kind !== "training"
                 && window.VIZ && VIZ.has(st.mode);
  el.innerHTML = `
    <div class="st-inner">
      <div class="st-card">
        <div class="st-kick"></div>
        <div class="st-years"></div>
        <div class="st-dur"></div>
        <h2 class="st-org"></h2>
        <div class="st-role"></div>
        <div class="st-place"></div>
        <ul class="st-bullets"></ul>
      </div>
      ${hasImg ? '<div class="st-viz-wrap"><div class="st-photo" style="--img:url(' + st.img + ')"><img src="' + st.img + '" alt="" loading="lazy" /></div></div>' : ""}
      ${hasViz ? '<div class="st-viz-wrap"><canvas class="st-viz" width="560" height="340"></canvas></div>' : ""}
    </div>`;
  stage.appendChild(el);
  el._viz = hasViz ? el.querySelector(".st-viz") : null;
  el._build = 0;
  // video projection: lives at page level so screen-blending sees the pipe
  el._video = null;
  if (st.vid && !reduced && !isMobile) {
    const v = document.createElement("video");
    v.className = "st-video";
    v.src = st.vid;
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "metadata";
    projLayer.appendChild(v);
    el._video = v;
    el.classList.add("has-video");
  }
  nodes.push(el);
});

const outroEl = document.getElementById("outro");

let LANG = "en";
function pick(v){ return (v && typeof v === "object") ? (v[LANG] ?? v.en) : v; }

function render() {
  document.documentElement.lang = LANG;
  // hero
  document.querySelector("#hero .h-sub").textContent = pick(CV.meta.intro);
  document.querySelector("#hero .h-tag").textContent = pick(CV.meta.tagline);
  // ui
  document.querySelector(".scroll-cue span").textContent = pick(CV.ui.scroll);
  document.getElementById("pl-label").textContent = pick(CV.ui.loading);
  const dl = document.getElementById("dl-cv"); if (dl) dl.textContent = pick(CV.ui.downloadCV);
  const rp = document.getElementById("replay"); if (rp) rp.textContent = pick(CV.ui.replay);
  document.querySelectorAll(".lang button").forEach(b => b.classList.toggle("on", b.dataset.lang === LANG));
  // stations
  let jobNo = 0;
  CV.stations.forEach((st, i) => {
    const el = nodes[i];
    el.className = "overlay station kind-" + st.kind + (st.gate ? " gate-" + st.gate : "")
                 + (el._video ? " has-video" : "");
    let kick;
    if (st.kind === "upcoming")      kick = pick(CV.ui.upcoming);
    else if (st.gate === "start")    kick = pick(CV.ui.gateStart);
    else if (st.gate === "done")     kick = pick(CV.ui.gateDone);
    else if (st.gate === "train")    kick = pick(st.place);
    else if (st.kind === "edu")      kick = pick(st.role);
    else { jobNo++;                  kick = String(jobNo).padStart(2, "0") + " — " + pick(st.role); }
    el.querySelector(".st-kick").textContent = kick;
    el.querySelector(".st-years").textContent = pick(st.years);
    const durEl = el.querySelector(".st-dur");
    durEl.textContent = st.dur ? pick(st.dur) : "";
    durEl.style.display = st.dur ? "" : "none";
    el.querySelector(".st-org").textContent = pick(st.org);
    el.querySelector(".st-role").textContent = pick(st.role);
    el.querySelector(".st-place").textContent = pick(st.place);
    const ul = el.querySelector(".st-bullets"); ul.innerHTML = "";
    (pick(st.bullets) || []).forEach(b => { const li = document.createElement("li"); li.textContent = b; ul.appendChild(li); });
  });
  // hero route list — the positions, visible before diving in
  const route = document.getElementById("route");
  if (route) {
    route.querySelector(".r-title").textContent = pick(CV.ui.positions);
    const ol = route.querySelector("ol"); ol.innerHTML = "";
    CV.stations.forEach((st) => {
      if (st.kind === "edu") return;                 // keep the list tight: positions only
      const li = document.createElement("li");
      li.innerHTML = "<b></b><span></span>";
      li.querySelector("b").textContent = pick(st.years);
      li.querySelector("span").textContent = pick(st.org);
      if (st.kind === "upcoming") li.className = "up";
      ol.appendChild(li);
    });
  }
  // outro
  outroEl.querySelector(".o-kick").textContent = pick(CV.outro.kicker);
  outroEl.querySelector(".o-line").textContent = pick(CV.outro.line);
  outroEl.querySelector(".o-loc").textContent = pick(CV.outro.location);
}
function setLang(l) {
  LANG = (l === "de") ? "de" : "en";
  try { localStorage.setItem("flow_lang", LANG); } catch (e) {}
  render();
}
document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));
setLang((() => { try { return localStorage.getItem("flow_lang"); } catch (e) { return null; } })()
        || (navigator.language || "en").slice(0, 2));

/* ---------------------------------------------------------------- scroll
   ONE source of truth: target = scrollY / max, read every frame in the loop.
   Every fade (hero, cards, outro) is computed from that same number — no
   separate trigger system that can drift out of sync. */
document.getElementById("scroll-space").style.height = "1250vh";

let lenis = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.85 });
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
window.jumpTo = (f) => {
  const y = f * (document.body.scrollHeight - innerHeight);
  window.scrollTo(0, y);
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  target = progress = f;
  // apply one frame immediately (also lets us inspect state while rAF is paused)
  camT = dwellMap(progress);
  rigCamera(progress);
  updateOverlays(progress, performance.now() / 1000);
  renderer.render(scene, camera);
};

function ramp(x, a, b) {            // 0 before a, 1 after b, smooth between
  return Math.max(0, Math.min(1, (x - a) / (b - a)));
}

/* per-station card visibility, computed from progress each frame */
const heroInner = document.querySelector("#hero .h-inner");
const cueEl = document.querySelector(".scroll-cue");
function updateOverlays(p, nowSec) {
  // hero rides the approach, clears as we cross the mouth
  const heroA = 1 - ramp(p, 0.024, PIN);
  heroInner.style.opacity = heroA;
  heroInner.style.visibility = heroA > 0.01 ? "visible" : "hidden";
  const cueA = 1 - ramp(p, 0.008, 0.03);
  cueEl.style.opacity = cueA;
  cueEl.style.visibility = cueA > 0.01 ? "visible" : "hidden";

  CV.stations.forEach((st, i) => {
    const d = p - st.s;
    // tight window: full card only around the dwell, gone well before the next one
    const a = ramp(d, -0.024, -0.009) * (1 - ramp(d, 0.009, 0.024));
    const el = nodes[i];
    el.style.opacity = a;
    el.style.visibility = a > 0.01 ? "visible" : "hidden";
    if (a > 0.01) {
      const card = el.querySelector(".st-card");
      card.style.transform = "translateY(" + (-d * 1900).toFixed(1) + "px)";
      // the visual floats: slower scroll drift than the text (depth) +
      // a gentle continuous levitation (sine bob, tiny sway and tilt)
      const t0 = (nowSec || 0) + i * 1.7;
      const fy = Math.sin(t0 * 0.55) * 11 + Math.sin(t0 * 1.31) * 4;
      const fx = Math.sin(t0 * 0.42 + 1.3) * 8;
      const rot = Math.sin(t0 * 0.35 + 0.6) * 1.1;
      // mobile: projection is centred at the top (left:50%), so the base
      // shift is horizontal-centering, with a gentler drift
      const floatTf = isMobile
        ? "translateX(calc(-50% + " + (fx * 0.5).toFixed(1) + "px)) " +
          "translateY(" + (-d * 420 + fy * 0.6).toFixed(1) + "px) rotate(" + (rot * 0.6).toFixed(2) + "deg)"
        : "translateY(calc(-50% + " + (-d * 900 + fy).toFixed(1) + "px)) " +
          "translateX(" + fx.toFixed(1) + "px) rotate(" + rot.toFixed(2) + "deg)";
      const wrap = el.querySelector(".st-viz-wrap");
      if (wrap) wrap.style.transform = floatTf;
      if (el._video) {
        el._video.style.opacity = a;
        el._video.style.visibility = "visible";
        el._video.style.transform = floatTf;
        if (el._video.paused) { try { el._video.play(); } catch (e) {} }
      }
      // draw-on progress: rises approaching the dwell, holds, never rewinds mid-view
      el._build = Math.max(el._build * (a > 0.02 ? 1 : 0), ramp(d, -0.026, -0.004));
      if (el._viz && window.VIZ) {
        VIZ.draw(st.mode, el._viz, nowSec || 0, a, el._build);
      }
    } else {
      el._build = 0;
      if (el._video) {
        el._video.style.opacity = 0;
        el._video.style.visibility = "hidden";
        if (!el._video.paused) el._video.pause();
      }
    }
  });

  const oA = ramp(p, 0.928, 0.962);
  outroEl.style.opacity = oA;
  outroEl.style.visibility = oA > 0.01 ? "visible" : "hidden";
}

/* progress rail */
const railFill = document.querySelector(".rail i");

/* ---------------------------------------------------------------- loop */
let last = performance.now(), flow = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  // read scroll directly — the one source of truth
  const maxY = Math.max(1, document.body.scrollHeight - innerHeight);
  target = Math.max(0, Math.min(1, (window.scrollY || window.pageYOffset || 0) / maxY));
  if (!isFinite(progress)) progress = 0;
  progress += (target - progress) * (reduced ? 1 : 0.09);

  prevCamT = camT;
  camT = dwellMap(progress);
  const camMove = Math.abs(camT - prevCamT);
  speed += (camMove * 200 - speed) * 0.09;
  flow += dt * (0.16 + speed * 26.0);

  rigCamera(progress);

  // entrance fixtures fade once we're through the mouth
  const entFade = 1 - ramp(progress, PIN * 1.1, PIN * 2.2);
  entrance._mats.forEach((m, i) => { m.opacity = entrance._base[i] * Math.max(0.0, entFade); });
  entrance.visible = entFade > 0.01;

  wallMat.uniforms.uFlow.value = flow;
  wallMat.uniforms.uSpeed.value = speed;
  coolMat.uniforms.uFlow.value = flow * 1.3;
  coolMat.uniforms.uSpeed.value = speed;
  pMat.uniforms.uSpeed.value = speed;
  updateParticles(dt, speed);

  // markers glow when the camera is near them
  markers.forEach(({ st, mats, fx }) => {
    const d = Math.abs(camT - st.t);
    const glow = Math.max(0, 1 - d / 0.06);
    const o = glow * glow;
    mats[0].opacity = o * 0.9;        // flange
    mats[1].opacity = o * 0.22;       // halo
    for (let k = 2; k < mats.length; k++) mats[k].opacity = o * 0.5;
    if (fx) { try { fx.update(flow, o, speed); } catch (e) {} }
    st._g = o;
  });
  const dm = Math.abs(camT - 0.985);
  mouth.material.opacity = Math.max(0, 1 - dm / 0.03) * 0.9;

  updateOverlays(progress, now / 1000);
  if (railFill) railFill.style.height = (progress * 100).toFixed(1) + "%";

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------------------------------------------------------- preloader */
const plBar = document.querySelector("#preloader .pl-bar i");
let pct = 0;
const iv = setInterval(() => {
  pct = Math.min(100, pct + Math.random() * 20 + 6);
  if (plBar) plBar.style.width = pct + "%";
  if (pct >= 100) {
    clearInterval(iv);
    setTimeout(() => document.getElementById("preloader").classList.add("done"), 250);
  }
}, 120);

/* sound toggle — wired but silent for now (no audio asset yet) */
const sBtn = document.getElementById("sound");
if (sBtn) sBtn.addEventListener("click", () => {
  sBtn.classList.toggle("on");
  sBtn.textContent = sBtn.classList.contains("on") ? pick(CV.ui.soundOn) : pick(CV.ui.soundOff);
});

/* replay */
const rBtn = document.getElementById("replay");
if (rBtn) rBtn.addEventListener("click", () => window.jumpTo(0));

requestAnimationFrame(loop);
})();
