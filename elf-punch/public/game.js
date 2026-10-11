import * as THREE from "three";
import { A } from "/audio.js";
// Elf Castle Wood Puncher 5000: low-poly 3D client. The server protocol is unchanged 2D (x east, y south); y becomes three's z.
const $ = (id) => document.getElementById(id);
const timeU = { value: 0 };
const hud = $("hud"), hx = hud.getContext("2d");
const mobile = matchMedia("(pointer: coarse)").matches;

// ---------- state ----------
let ws = null, me = 0, world = null, snap = null, joined = false, dead = false, tries = 0;
let mine = { x: 30, y: 30, hp: 10, hu: 100, wa: 100, wood: 0, kills: 0, st: 100, stone: 0, tools: 0 }, sm = { x: 30, y: 30 };
// build mode: hammer equipped, sel indexes PIECES, aim is a manual grid cell (mouse hover or a tap) that falls back to the cell in front
let haveMine = false, prevNight = null, stepD = 0, caKick = 0, fovBase = 54, hammer = false, sel = 0, aim = null, aimAt = 0, bagOpen = false, bagKey = "";
const PIECES = [
  { k: 0, n: "Wall", w: 2, s: 0 }, { k: 1, n: "Stone wall", w: 0, s: 3 }, { k: 2, n: "Floor", w: 1, s: 0 }, { k: 3, n: "Torch", w: 2, s: 0 },
  { k: 4, n: "Spikes", w: 4, s: 0 }, { k: 5, n: "Campfire", w: 6, s: 0 }, { k: -1, n: "Demolish", w: 0, s: 0 },
];
const REACH = 6.5;
let W = 0, H = 0, dpr = 1, flash = 0, shake = 0, lb = [], punchAt = 0, rollAt = 0, blocking = false, slow = 0, lastIn = "", mv = { x: 0, y: 0 };
const ent = new Map(); // players and goblins by id
const fireObjs = new Map(), wallObjs = new Map(), mushObjs = new Map();
const treeIndex = new Map(), rockIndex = new Map(); let felled = new Set(), treeShake = new Map(), rockShake = new Map(), rockIM, pieceCells = new Map();
$("name").value = localStorage.getItem("ep-name") || "";

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
$("gl").appendChild(renderer.domElement);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping, bloom and grading happen in the composite pass below
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 500);
const sky = new THREE.Color("#8ec5ff");
scene.background = sky; scene.fog = new THREE.Fog(sky, 18, 46);
const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6a9a58, 1.25); scene.add(hemi);
const fill = new THREE.DirectionalLight(0x7fb6c8, 0.5); scene.add(fill, fill.target);
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 }); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const firePool = []; for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff8a30, 0, 11, 1.6); scene.add(l); firePool.push(l); }
const heroLight = new THREE.PointLight(0xaec8ff, 0, 7, 1.5); scene.add(heroLight);

// ---------- sky dome and distant ridges (Firewatch-style layered silhouettes) ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { time: timeU, top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 0.3, -1) }, night: { value: 0 }, warm: { value: 0 } },
  vertexShader: "varying vec3 vD; void main(){ vD=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z=gl_Position.w*0.99999; }",
  fragmentShader: `varying vec3 vD; uniform vec3 top, mid, hor, sunCol, sunDir; uniform float night, warm, time;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(17.3,9.1); a*=.5; } return s; }
    void main(){
      vec3 d = normalize(vD); float y = d.y;
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, y)); c = mix(c, top, smoothstep(0.18, 0.75, y));
      c = mix(c, hor, smoothstep(0.0, -0.12, y));
      float sd = max(dot(d, normalize(sunDir)), 0.0);
      c += sunCol * (pow(sd, 6.0) * 0.28 + pow(sd, 40.0) * 0.45) * (1.0 - night * 0.7);
      c = mix(c, sunCol * 3.2, smoothstep(0.9975, 0.9985, sd));
      if (y > 0.015) {
        vec2 cuv = d.xz / (y + 0.28) * 0.55 + vec2(time * 0.012, time * 0.004); float n = fbm(cuv), cl = smoothstep(0.56, 0.78, n) * smoothstep(0.015, 0.2, y);
        float lit = pow(sd, 3.0), rim = clamp(smoothstep(0.56, 0.64, n) - smoothstep(0.7, 0.9, n), 0., 1.);
        vec3 cc = mix(mid * 1.1 + 0.05, vec3(1.0, 0.93, 0.85) * (0.8 + 0.5 * (1. - night)), 0.45); cc = mix(cc, hor * 1.25, 0.25 + warm * 0.45); cc += sunCol * (rim * (0.35 + lit * 1.4) + lit * 0.25) * (1. - night * 0.85);
        cc *= mix(1.0, 0.25, night); c = mix(c, cc, cl * 0.95);
      }
      vec2 sp = vec2(atan(d.z, d.x) * 60.0, asin(clamp(y,-1.,1.)) * 120.0); vec2 g = floor(sp); float r = h21(g);
      float star = step(0.985, r) * smoothstep(0.02, 0.25, y) * night * (0.6 + 0.4 * sin(r * 900.0));
      star *= smoothstep(0.42, 0.08, length(fract(sp) - 0.5)); c += vec3(star);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), skyMat); skyDome.renderOrder = -10; skyDome.frustumCulled = false; scene.add(skyDome);
const ridges = [];
function makeRidge(R, lo, hi, seed, k) {
  const N = 140, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, n = 0.5 + 0.5 * (Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 + seed * 2.3) * 0.3 + Math.sin(a * 19 + seed * 3.7) * 0.2), h = lo + (hi - lo) * Math.pow(n, 1.4);
    pos.push(Math.cos(a) * R, -10, Math.sin(a) * R, Math.cos(a) * R, h, Math.sin(a) * R);
    if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#345", side: THREE.DoubleSide, fog: false, toneMapped: false })); m.position.set(30, 0, 30); m.frustumCulled = false; m.renderOrder = -5; scene.add(m);
  ridges.push({ m, k });
}
makeRidge(170, 12, 34, 1.3, 0.7); makeRidge(130, 8, 22, 4.1, 0.48); makeRidge(96, 4, 12, 7.7, 0.24);
const PAL = {
  day: { top: new THREE.Color("#2f68a8"), mid: new THREE.Color("#79b0d2"), hor: new THREE.Color("#f3cc9c"), sun: new THREE.Color("#ffe2b0"), hs: new THREE.Color("#c4dcec"), hg: new THREE.Color("#8a7a44"), ridge: new THREE.Color("#2f4d3e") },
  dusk: { top: new THREE.Color("#3a3f86"), mid: new THREE.Color("#b25a88"), hor: new THREE.Color("#ff8a55"), sun: new THREE.Color("#ff9a5a"), hs: new THREE.Color("#c07a9a"), hg: new THREE.Color("#7a4a3a"), ridge: new THREE.Color("#3a2c4a") },
  night: { top: new THREE.Color("#060a20"), mid: new THREE.Color("#121a46"), hor: new THREE.Color("#2b3268"), sun: new THREE.Color("#dfe8ff"), hs: new THREE.Color("#4a5aa0"), hg: new THREE.Color("#101828"), ridge: new THREE.Color("#0a1030") },
};
const CUR = { top: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), ridge: new THREE.Color() };
function mixPalette(nf, wf) { for (const k in CUR) CUR[k].copy(PAL.day[k]).lerp(PAL.night[k], nf).lerp(PAL.dusk[k], Math.min(1, wf * 0.85)); }

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2); W = innerWidth; H = innerHeight;
  renderer.setPixelRatio(dpr); renderer.setSize(W, H); hud.width = W * dpr; hud.height = H * dpr;
  camera.aspect = W / H; fovBase = W / H < 1 ? 66 : 54; camera.fov = fovBase; camera.updateProjectionMatrix();
  if (typeof makeTargets === "function") makeTargets();
}
addEventListener("resize", resize);

// ---------- post pipeline: HDR scene -> blur chain -> composite (bloom, god rays, tilt-shift, ACES, grade, grain) ----------
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene(), fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
const hdr = renderer.capabilities.isWebGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
let sceneRT = null, rtA = null, rtB1 = null, rtB2 = null, rtC1 = null, rtC2 = null;
const rt = (w, h, ms) => new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: ms || 0, depthBuffer: !!ms || ms === undefined, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
function makeTargets() {
  for (const t of [sceneRT, rtA, rtB1, rtB2, rtC1, rtC2]) t && t.dispose();
  const w = W * dpr, h = H * dpr;
  sceneRT = rt(w, h, mobile ? 0 : 4); sceneRT.depthBuffer = true; rtA = rt(w / 2, h / 2, 0); rtB1 = rt(w / 4, h / 4, 0); rtB2 = rt(w / 4, h / 4, 0); rtC1 = rt(w / 8, h / 8, 0); rtC2 = rt(w / 8, h / 8, 0);
}
const VS = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }";
const copyMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: VS, fragmentShader: "varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor=texture2D(t,vUv); }", depthTest: false, depthWrite: false });
const blurMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: "varying vec2 vUv; uniform sampler2D t; uniform vec2 dir; void main(){ vec3 c=texture2D(t,vUv).rgb*0.2270; c+=(texture2D(t,vUv+dir*1.3846).rgb+texture2D(t,vUv-dir*1.3846).rgb)*0.3162; c+=(texture2D(t,vUv+dir*3.2308).rgb+texture2D(t,vUv-dir*3.2308).rgb)*0.0703; gl_FragColor=vec4(c,1.); }" });
const compMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: VS,
  uniforms: { tS: { value: null }, tB: { value: null }, tC: { value: null }, sunUV: { value: new THREE.Vector2(0.5, 0.8) }, sunCol: { value: new THREE.Color() }, rays: { value: 0 }, bloom: { value: 0.6 }, thr: { value: 0.9 }, vig: { value: 0.35 }, hurt: { value: 0 }, ca: { value: 0.0008 }, tilt: { value: 0.55 }, expo: { value: 1.02 }, time: { value: 0 }, night: { value: 0 }, warm: { value: 0 }, sat: { value: 1.22 } },
  fragmentShader: `varying vec2 vUv; uniform sampler2D tS, tB, tC; uniform vec2 sunUV; uniform vec3 sunCol; uniform float rays, bloom, thr, vig, hurt, ca, tilt, expo, time, night, warm, sat;
    float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    void main(){
      vec2 uv=vUv, off=(uv-0.5)*ca*(1.0+hurt*4.0);
      vec3 col=vec3(texture2D(tS,uv+off).r, texture2D(tS,uv).g, texture2D(tS,uv-off).b);
      vec3 b1=texture2D(tB,uv).rgb, b2=texture2D(tC,uv).rgb;
      float t=pow(smoothstep(0.12,0.62,abs(uv.y-0.56)), 1.3)*tilt; col=mix(col, mix(b1,b2,0.4), t);
      col += (max(b1-thr,0.0)*0.8 + max(b2-thr*0.6,0.0)*1.2) * bloom;
      if(rays>0.001){ vec2 d=(sunUV-uv)/14.0, p=uv; vec3 acc=vec3(0.); float w=1.0; for(int i=0;i<14;i++){ p+=d; acc+=max(texture2D(tC,p).rgb-thr*0.55,0.0)*w; w*=0.92; } col += acc*sunCol*rays*0.16; }
      col*=expo; col=aces(col); col=mix(col, col*col*(3.0-2.0*col), 0.3);
      float lum=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(lum),col,sat);
      col*=mix(vec3(0.93,1.0,1.07), vec3(1.07,1.0,0.92), smoothstep(0.25,0.75,lum));
      col=mix(col, col*vec3(1.08,0.98,0.9), warm*0.5); col=mix(col, col*vec3(0.85,0.95,1.15)+vec3(0.0,0.004,0.02), night*0.6);
      float v=smoothstep(0.85,0.25,length((uv-0.5)*vec2(1.15,1.0))); col*=mix(1.0-vig,1.0,v);
      col=mix(col, vec3(lum)*vec3(1.0,0.4,0.35)+vec3(0.15,0.0,0.0), hurt*0.45);
      col+= (h12(uv*vec2(1920.,1080.)+time)-0.5)*0.035;
      gl_FragColor=vec4(col,1.0);
      #include <colorspace_fragment>
    }` });
function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
function blur(src, tmp, w, h) { blurMat.uniforms.t.value = src.texture; blurMat.uniforms.dir.value.set(1 / w, 0); pass(blurMat, tmp); blurMat.uniforms.t.value = tmp.texture; blurMat.uniforms.dir.value.set(0, 1 / h); pass(blurMat, src); }
function renderFrame() {
  if (!sceneRT) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
  renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, camera);
  const w = W * dpr, h = H * dpr;
  copyMat.uniforms.t.value = sceneRT.texture; pass(copyMat, rtA);
  copyMat.uniforms.t.value = rtA.texture; pass(copyMat, rtB1); blur(rtB1, rtB2, w / 4, h / 4);
  copyMat.uniforms.t.value = rtB1.texture; pass(copyMat, rtC1); blur(rtC1, rtC2, w / 8, h / 8);
  const u = compMat.uniforms; u.tS.value = sceneRT.texture; u.tB.value = rtB1.texture; u.tC.value = rtC1.texture; u.time.value = performance.now() % 1000 / 1000; u.thr.value = hdr ? 0.95 : 0.72;
  pass(compMat, null);
}
resize();
const mats = {};
const M = (c, o = {}) => { const k = c + JSON.stringify(o); return mats[k] || (mats[k] = new THREE.MeshStandardMaterial(Object.assign({ color: c, flatShading: false, roughness: 0.92, metalness: 0 }, o))); };
const B = (c) => new THREE.MeshBasicMaterial({ color: c });
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mesh = (g, m, x = 0, y = 0, z = 0, cast = true) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = cast; return o; };

// ---------- lake: animated normals, fresnel sky reflection, HDR sun glitter, fades into the horizon ----------
const seaMat = new THREE.ShaderMaterial({ fog: false,
  uniforms: { time: timeU, hor: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 0.3, -1) }, night: { value: 0 }, deep: { value: new THREE.Color("#1b4656") } },
  vertexShader: "varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }",
  fragmentShader: `varying vec3 vW; uniform float time, night; uniform vec3 hor, mid, sunCol, sunDir, deep;
    float wv(vec2 p, float t){ return sin(p.x*0.9+t*1.1)*0.5+sin(p.y*1.3-t*0.9+p.x*0.4)*0.35+sin((p.x+p.y)*2.1+t*1.7)*0.18; }
    void main(){
      vec3 V=normalize(cameraPosition-vW); vec2 p=vW.xz; float e=0.08;
      float h=wv(p,time), hx=wv(p+vec2(e,0.),time), hz=wv(p+vec2(0.,e),time);
      vec3 n=normalize(vec3(-(hx-h)/e*0.05, 1.0, -(hz-h)/e*0.05));
      float fr=pow(1.0-max(dot(n,V),0.0), 3.0), dist=length(cameraPosition-vW);
      vec3 R=reflect(-V,n); vec3 sky=mix(hor, mid, smoothstep(0.0,0.5,R.y));
      vec3 col=mix(deep*(1.0-night*0.7), sky, clamp(fr*0.65+0.05,0.,1.));
      float sp=pow(max(dot(R,normalize(sunDir)),0.0), 260.0); col += sunCol*sp*7.0*(1.0-night*0.5);
      col += sunCol*pow(max(dot(R,normalize(sunDir)),0.0), 12.0)*0.12;
      col=mix(col, hor, smoothstep(30.0, 300.0, dist));
      gl_FragColor=vec4(col,1.0);
      #include <colorspace_fragment>
    }` });

// ---------- world ----------
const DIRT = new THREE.Color("#b8905e"), tmpC2 = new THREE.Color();
let staticBuilt = false, trunkIM, coneIMs = [];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
function buildWorld() {
  if (staticBuilt) return; staticBuilt = true;
  const w = world.w, h = world.h;
  // ground with vertex colour and gentle relief
  const g = new THREE.PlaneGeometry(w, h, w, h); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2, z = pos.getZ(i) + h / 2, n = hash(Math.round(x), Math.round(z));
    pos.setY(i, (Math.sin(x * 0.35) * Math.cos(z * 0.3) * 0.07) + n * 0.03);
    const patch = 0.5 + 0.5 * Math.sin(x * 0.17 + Math.cos(z * 0.23) * 1.7) * Math.cos(z * 0.13 + Math.sin(x * 0.11) * 2.1), p2 = 0.5 + 0.5 * Math.sin(x * 0.51 + z * 0.37);
    const c = tmpC.set("#5f8a3a").lerp(tmpC2.set("#9aa246"), patch * 0.7).lerp(tmpC2.set("#44703a"), p2 * 0.35); c.offsetHSL(0, 0, (n - 0.5) * 0.05);
    const dirt = Math.max(0, 1 - Math.hypot(x - 30, z - 30) / 4.5); if (dirt > 0) c.lerp(DIRT, dirt * 0.8);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness: 1 }));
  ground.position.set(w / 2, 0, h / 2); ground.receiveShadow = true; scene.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(w / 2, -0.6, h / 2); scene.add(sea);
  // perimeter boulders
  const rockG = new THREE.IcosahedronGeometry(0.6, 0), rocks = [];
  for (let i = 0; i < w; i += 1.2) { rocks.push([i, -0.3], [i, h + 0.3]); rocks.push([-0.3, i], [w + 0.3, i]); }
  const rim = new THREE.InstancedMesh(rockG, M("#6f6f7a", { flatShading: true }), rocks.length); rim.castShadow = rim.receiveShadow = true;
  rocks.forEach(([x, z], i) => { const s = 0.8 + hash(i, 9) * 1.1; tmpM.compose(tmpV.set(x, 0.1, z), tmpQ.setFromEuler(tmpE.set(hash(i, 1) * 3, hash(i, 2) * 3, 0)), tmpS.set(s, s * 0.8, s)); rim.setMatrixAt(i, tmpM); });
  scene.add(rim);
  // trees: trunk + three cones, instanced
  const n = world.trees.length;
  trunkIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1.3, 6).translate(0, 0.65, 0), M("#4d3628"), n);
  const coneDefs = [[0.95, 1.5, 1.5], [0.75, 1.3, 2.3], [0.5, 1.1, 3.0]];
  coneIMs = coneDefs.map(([r, hh, y]) => new THREE.InstancedMesh(new THREE.ConeGeometry(r, hh, 9).translate(0, y, 0), M("#ffffff"), n));
  const TREE_COL = ["#2f5f3a", "#3a6b3a", "#47763c", "#5d7f3a", "#2a5a4c", "#7a8a3a", "#b5652b"];
  for (let i = 0; i < n; i++) { const r = hash(i, 31), base = new THREE.Color(r < 0.1 ? TREE_COL[6] : r < 0.25 ? TREE_COL[5] : TREE_COL[Math.floor(hash(i, 32) * 5)]); coneIMs.forEach((im, j) => im.setColorAt(i, tmpC.copy(base).offsetHSL(0, 0.02 * j, 0.045 * j))); }
  sway(coneIMs[0].material, 0.03);
  [trunkIM, ...coneIMs].forEach((im) => { im.castShadow = true; im.receiveShadow = false; scene.add(im); });
  world.trees.forEach((t, i) => { treeIndex.set(t[0].toFixed(2) + "," + t[1].toFixed(2), i); setTree(i, 0); });
  // boulders (mineable for stone): index i here is tree index NT + i
  const nr = world.rocks.length;
  rockIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 0).translate(0, 0.45, 0), M("#ffffff", { flatShading: true }), nr);
  rockIM.castShadow = rockIM.receiveShadow = true; scene.add(rockIM);
  world.rocks.forEach((t, i) => { rockIndex.set(t[0].toFixed(2) + "," + t[1].toFixed(2), i); setRock(i, 0); });
  // decor: grass blades, rocks, bushes, flowers (visual only)
  const grass = [], rk = [], bu = [], fl = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = hash(x * 3 + 1, y * 5 + 2);
    if (hash(x, y) < 0.5) grass.push([x + hash(y, x), y + hash(x + 7, y)]);
    if (a > 0.975) bu.push([x + 0.5, y + 0.6]); else if (a > 0.95) rk.push([x + 0.5, y + 0.6]); else if (a > 0.86) fl.push([x + hash(y, x), y + 0.7, (x + y) & 3]);
  }
  const inst = (geo, mat, list, f, shadow) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { f(p, i); im.setMatrixAt(i, tmpM); }); im.castShadow = !!shadow; im.receiveShadow = true; scene.add(im); return im; };
  const gm = new THREE.MeshStandardMaterial({ color: "#ffffff", flatShading: true, roughness: 1 }); sway(gm, 0.35);
  const gIM = inst(new THREE.ConeGeometry(0.05, 0.3, 3).translate(0, 0.15, 0), gm, grass, (p, i) => { tmpM.compose(tmpV.set(p[0], 0.05, p[1]), tmpQ.setFromEuler(tmpE.set((hash(i, 4) - .5) * .5, hash(i, 5) * 6, (hash(i, 6) - .5) * .5)), tmpS.set(1, 0.6 + hash(i, 7) * 0.6, 1)); }, false);
  grass.forEach((_, i) => gIM.setColorAt(i, tmpC.set(hash(i, 8) < 0.5 ? "#5f7f32" : "#b2b955")));
  inst(new THREE.IcosahedronGeometry(0.35, 0).translate(0, 0.2, 0), M("#7b7d88", { flatShading: true }), rk, (p, i) => { const s = 0.7 + hash(i, 3) * 0.9; tmpM.compose(tmpV.set(p[0], 0, p[1]), tmpQ.setFromEuler(tmpE.set(0, hash(i, 2) * 6, 0)), tmpS.set(s, s * 0.7, s)); }, true);
  const bsh = inst(new THREE.IcosahedronGeometry(0.42, 1).translate(0, 0.32, 0), M("#4a6e35"), bu, (p, i) => { const s = 0.8 + hash(i, 3) * 0.6; tmpM.compose(tmpV.set(p[0], 0, p[1]), tmpQ.identity(), tmpS.set(s, s * 0.8, s)); }, true);
  const berry = inst(new THREE.IcosahedronGeometry(0.06, 0), B("#e0404f"), bu.flatMap((p, i) => [[p[0] + 0.2, p[1] + 0.25, 0.5], [p[0] - 0.15, p[1] + 0.32, 0.4], [p[0] + 0.05, p[1] + 0.12, 0.6]]), (p) => { tmpM.compose(tmpV.set(p[0], p[2], p[1]), tmpQ.identity(), tmpS.set(1, 1, 1)); }, false);
  const FL = ["#f6ead0", "#ffb347", "#ff7a5c", "#c9a0ff"];
  const flIM = inst(new THREE.OctahedronGeometry(0.09, 0).translate(0, 0.3, 0), new THREE.MeshBasicMaterial({ color: "#ffffff" }), fl, (p, i) => { tmpM.compose(tmpV.set(p[0], 0, p[1]), tmpQ.identity(), tmpS.set(1, 1, 1)); }, false);
  fl.forEach((p, i) => flIM.setColorAt(i, tmpC.set(FL[p[2]])));
}
function sway(mat, amp) {
  mat.onBeforeCompile = (sh) => { sh.uniforms.uT = timeU; sh.vertexShader = "uniform float uT;\n" + sh.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = vec3(position);
    #ifdef USE_INSTANCING
    float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
    #else
    float ph = 0.0;
    #endif
    float sw = max(position.y, 0.0) * ${amp.toFixed(3)};
    transformed.x += sin(uT * 1.4 + ph) * sw + sin(uT * 3.1 + ph * 2.3) * sw * 0.25; transformed.z += cos(uT * 1.1 + ph) * sw * 0.7;`); };
  mat.customProgramCacheKey = () => "sway" + amp;
}
function setRock(i, shk) {
  const t = world.rocks[i], s = 0.75 + hash(i, 21) * 0.4, f = felled.has(world.trees.length + i);
  const j = shk ? Math.sin(performance.now() / 22) * 0.06 * shk : 0;
  tmpQ.setFromEuler(tmpE.set(hash(i, 22) * 0.4, hash(i, 23) * 6, hash(i, 24) * 0.4));
  tmpM.compose(tmpV.set(t[0] + j, 0, t[1]), tmpQ, f ? tmpS.set(s * 0.45, s * 0.2, s * 0.45) : tmpS.set(s, s * 0.85, s)); rockIM.setMatrixAt(i, tmpM);
  tmpC.set(f ? "#6d7482" : hash(i, 25) < 0.5 ? "#8a91a0" : "#9aa2b2"); rockIM.setColorAt(i, tmpC);
  rockIM.instanceMatrix.needsUpdate = true; if (rockIM.instanceColor) rockIM.instanceColor.needsUpdate = true;
}
function setTree(i, shk) {
  const t = world.trees[i], s = 0.62 + hash(i, 11) * 0.3, f = felled.has(i);
  const rz = shk ? Math.sin(performance.now() / 25) * 0.12 * shk : 0, rx = shk ? Math.cos(performance.now() / 31) * 0.08 * shk : 0;
  tmpQ.setFromEuler(tmpE.set(rx, hash(i, 12) * 6, rz));
  tmpM.compose(tmpV.set(t[0], 0, t[1]), tmpQ, tmpS.set(s, f ? s * 0.25 : s, s)); trunkIM.setMatrixAt(i, tmpM);
  tmpM.compose(tmpV.set(t[0], 0, t[1]), tmpQ, tmpS.set(f ? 0 : s, f ? 0 : s, f ? 0 : s)); coneIMs.forEach((im) => im.setMatrixAt(i, tmpM));
  trunkIM.instanceMatrix.needsUpdate = true; coneIMs.forEach((im) => (im.instanceMatrix.needsUpdate = true));
}

// ---------- text sprites ----------
const texCache = new Map();
function textTex(text, color) {
  const k = text + color; if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d");
  x.font = "700 38px Avenir Next, Futura, Helvetica Neue, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.lineJoin = "round"; x.lineWidth = 7; x.strokeStyle = "rgba(20,16,30,.75)"; x.strokeText(text, 128, 34); x.fillStyle = color; x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache.set(k, t); return t;
}
function label(text, color, scale = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(text, color), depthTest: false, transparent: true }));
  s.scale.set(2.4 * scale, 0.6 * scale, 1); s.renderOrder = 10; return s;
}

// ---------- characters ----------
function limbGroup(x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); return g; }
function makeFigure(o) {
  const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig);
  const legL = limbGroup(-0.12, 0.5, 0), legR = limbGroup(0.12, 0.5, 0);
  for (const l of [legL, legR]) { l.add(mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.42, 6).translate(0, -0.22, 0), M(o.legs))); l.add(mesh(new THREE.BoxGeometry(0.17, 0.12, 0.26).translate(0, -0.46, 0.04), M(o.boots))); rig.add(l); }
  const body = limbGroup(0, 0.5, 0); rig.add(body);
  body.add(mesh(new THREE.CylinderGeometry(o.bw * 0.8, o.bw, 0.6, 8).translate(0, 0.3, 0), M(o.body)));
  body.add(mesh(new THREE.TorusGeometry(o.bw * 0.92, 0.035, 5, 10).rotateX(Math.PI / 2).translate(0, 0.12, 0), M("#8a5a2c")));
  const head = limbGroup(0, 0.78, 0); body.add(head);
  head.add(mesh(new THREE.SphereGeometry(o.hr, 10, 8), M(o.skin)));
  for (const sx of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.035, 6, 5), o.eye, sx * 0.085, 0.03, o.hr * 0.9, false));
  const earG = new THREE.ConeGeometry(o.ear, o.earL, 4); earG.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) { const e = mesh(earG, M(o.skin), sx * (o.hr + 0.07), 0.05, -0.02); e.rotation.z = sx * 0.35; e.scale.x = sx; head.add(e); }
  if (o.hair) { const h = mesh(new THREE.SphereGeometry(o.hr * 1.08, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M(o.hair), 0, 0.03, -0.02); head.add(h); head.add(mesh(new THREE.SphereGeometry(o.hr * 0.8, 8, 6), M(o.hair), 0, -0.02, -o.hr * 0.65)); }
  const armL = limbGroup(-o.bw - 0.06, 0.52, 0), armR = limbGroup(o.bw + 0.06, 0.52, 0);
  for (const a of [armL, armR]) { a.add(mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.38, 6).translate(0, -0.19, 0), M(o.armC))); body.add(a); }
  let gloves = [];
  if (o.glove) for (const a of [armL, armR]) { const gl = mesh(new THREE.SphereGeometry(0.15, 8, 6), M("#d8384a"), 0, -0.44, 0.02); a.add(gl); gloves.push(gl); }
  else { armR.add(mesh(new THREE.SphereGeometry(0.07, 6, 5), M(o.skin), 0, -0.4, 0)); armL.add(mesh(new THREE.SphereGeometry(0.07, 6, 5), M(o.skin), 0, -0.4, 0)); }
  root.userData = { rig, body, head, legL, legR, armL, armR, gloveR: gloves[1] };
  return root;
}
function makeElfFigure(o) {
  const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig);
  const SK = M(o.skin), TU = M(o.body, { roughness: 0.7 }), TR = M("#f4e9c8", { roughness: 0.6 }), LE = M("#5a3a22", { roughness: 0.6 }), GO = M("#f2c14e", { roughness: 0.3, metalness: 0.6 });
  const HA = M(o.hair, { roughness: 0.55 }), BO = M("#6a4630", { roughness: 0.6 });
  const legL = limbGroup(-0.11, 0.5, 0), legR = limbGroup(0.11, 0.5, 0);
  for (const l of [legL, legR]) {
    l.add(mesh(new THREE.CapsuleGeometry(0.075, 0.26, 4, 10).translate(0, -0.22, 0), M("#e9e0c4")));
    l.add(mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.14, 12).translate(0, -0.36, 0), BO)); // boot shaft
    l.add(mesh(new THREE.CylinderGeometry(0.125, 0.105, 0.05, 12).translate(0, -0.3, 0), LE)); // cuff
    l.add(mesh(new THREE.SphereGeometry(0.1, 12, 8).scale(1, 0.75, 1.55).translate(0, -0.44, 0.05), BO)); // toe
    rig.add(l);
  }
  const body = limbGroup(0, 0.5, 0); rig.add(body);
  // tunic: waist-to-chest taper plus a flared, scalloped skirt
  const torso = new THREE.LatheGeometry([[0.2, 0], [0.21, 0.08], [0.19, 0.25], [0.17, 0.42], [0.2, 0.52], [0.13, 0.6], [0.1, 0.64]].map(([r, y]) => new THREE.Vector2(r, y)), 16); body.add(mesh(torso, TU));
  const skirt = mesh(new THREE.CylinderGeometry(0.21, 0.3, 0.3, 16, 1, true).translate(0, -0.06, 0), M(o.body, { side: THREE.DoubleSide, roughness: 0.7 })); body.add(skirt);
  body.add(mesh(new THREE.TorusGeometry(0.3, 0.022, 6, 20).rotateX(Math.PI / 2).translate(0, -0.21, 0), GO)); // hem trim
  body.add(mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 16).translate(0, 0.14, 0), LE)); // belt
  body.add(mesh(new THREE.BoxGeometry(0.1, 0.085, 0.03).translate(0, 0.14, 0.205), GO)); // buckle
  body.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02).translate(0, 0.14, 0.222), LE));
  body.add(mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 16).rotateX(Math.PI / 2).translate(0, 0.56, 0), TR)); // collar
  // cape, hangs from the shoulders and sways
  const cape = limbGroup(0, 0.58, -0.16); cape.add(mesh(new THREE.BoxGeometry(0.4, 0.62, 0.03, 4, 6, 1).translate(0, -0.3, -0.02), M("#b23a48", { roughness: 0.75 }))); cape.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.04).translate(0, 0, 0), GO)); cape.rotation.x = 0.12; body.add(cape);
  const head = limbGroup(0, 0.88, 0); body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.27, 20, 16), SK));
  const ew = new THREE.MeshBasicMaterial({ color: "#ffffff" }), iris = new THREE.MeshBasicMaterial({ color: "#2f8f5a" }), pup = B("#15121c");
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.06, 12, 10).scale(0.85, 1.15, 0.5), ew, sx * 0.1, 0.0, 0.245, false));
    head.add(mesh(new THREE.SphereGeometry(0.038, 10, 8).scale(0.9, 1.15, 0.5), iris, sx * 0.1, -0.005, 0.262, false));
    head.add(mesh(new THREE.SphereGeometry(0.022, 8, 6).scale(1, 1.1, 0.5), pup, sx * 0.1, -0.005, 0.272, false));
    head.add(mesh(new THREE.SphereGeometry(0.011, 6, 5), ew, sx * 0.1 + 0.014, 0.018, 0.282, false));
    const br = mesh(new THREE.BoxGeometry(o.rugged ? 0.11 : 0.085, o.rugged ? 0.03 : 0.018, 0.02), HA, sx * 0.1, o.rugged ? 0.075 : 0.085, 0.25, false); br.rotation.z = -sx * (o.rugged ? 0.4 : 0.18); head.add(br);
    if (!o.rugged) head.add(mesh(new THREE.SphereGeometry(0.038, 8, 6).scale(1, 0.6, 0.3), M("#f29a9a", { roughness: 1 }), sx * 0.165, -0.085, 0.215, false)); // blush
    // long pointed ear, tilted back, pink inside
    const ear = new THREE.Group(); ear.position.set(sx * 0.255, 0.03, -0.01); ear.rotation.set(0, 0, sx * -0.55); ear.scale.x = sx; if (o.rugged) ear.scale.set(sx * 0.75, 0.9, 1);
    ear.add(mesh(new THREE.ConeGeometry(0.075, 0.42, 10).rotateZ(-Math.PI / 2).translate(0.2, 0, 0).scale(1, 1, 0.35), SK, 0, 0, 0, false));
    ear.add(mesh(new THREE.ConeGeometry(0.045, 0.3, 8).rotateZ(-Math.PI / 2).translate(0.17, 0, 0.012).scale(1, 1, 0.3), M("#eea0a0", { roughness: 0.9 }), 0, 0, 0, false));
    head.add(ear);
  }
  head.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), M("#e8b48c"), 0, -0.05, 0.265, false)); // nose
  const smile = mesh(new THREE.TorusGeometry(0.04, 0.008, 5, 12, Math.PI).rotateZ(Math.PI), B("#8a3b3b"), 0, -0.09, 0.248, false); head.add(smile);
  // hair: cap, back mass, side locks, swoop bangs, ponytail
  head.add(mesh(new THREE.SphereGeometry(0.295, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), HA, 0, 0.02, -0.03));
  head.add(mesh(new THREE.SphereGeometry(0.27, 14, 10).scale(1, 1.15, 0.8), HA, 0, -0.06, -0.12));
  for (const sx of [-1, 1]) { if (o.rugged) continue; head.add(mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8), HA, sx * 0.25, -0.1, 0.03)); const bang = mesh(new THREE.ConeGeometry(0.09, 0.22, 8), HA, sx * 0.1, 0.17, 0.22); bang.rotation.set(2.45, 0, sx * 0.5); head.add(bang); }
  if (o.rugged) {
    const BE = M("#5a3d22", { roughness: 0.9 });
    head.add(mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.4).scale(1.02, 1, 1.04), BE, 0, -0.01, 0.02)); // jaw beard
    head.add(mesh(new THREE.SphereGeometry(0.1, 10, 8).scale(1.3, 0.45, 0.6), BE, 0, -0.075, 0.245, false)); // moustache
    head.scale.set(1.08, 1, 1.02);
    body.scale.set(1.28, 1.05, 1.15);
  }
  const tail = limbGroup(0, -0.02, -0.26); tail.add(mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8).translate(0, -0.2, 0), HA)); tail.add(mesh(new THREE.TorusGeometry(0.055, 0.015, 5, 10).translate(0, 0.0, 0), GO)); tail.rotation.x = 0.35; if (!o.rugged) head.add(tail);
  const armL = limbGroup(-0.25, 0.54, 0), armR = limbGroup(0.25, 0.54, 0);
  for (const a of [armL, armR]) { a.add(mesh(new THREE.SphereGeometry(0.085, 10, 8), TU)); a.add(mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8).translate(0, -0.19, 0), TU)); a.add(mesh(new THREE.CylinderGeometry(0.072, 0.066, 0.1, 10).translate(0, -0.3, 0), LE)); body.add(a); }
  const gloves = [];
  for (const a of [armL, armR]) { const gl = new THREE.Group(); gl.position.set(0, -0.44, 0.02); gl.add(mesh(new THREE.SphereGeometry(0.15, 14, 10), M("#d8384a", { roughness: 0.5 }))); gl.add(mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 12).translate(0, 0.1, 0).rotateX(Math.PI / 2), TR)); gl.add(mesh(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1, 0.6), M("#f06a78"), 0, 0.03, 0.12, false)); a.add(gl); gloves.push(gl); }
  root.userData = { rig, body, head, legL, legR, armL, armR, gloveR: gloves[1], cape, tail, rugged: !!o.rugged };
  return root;
}
function makeElf(id, rugged) {
  const tunics = ["#3f9a52", "#3a78c4", "#b0468a", "#d08a2a", "#7a52c0", "#2aa8a0"];
  const f = makeElfFigure({ body: tunics[id % tunics.length], skin: rugged ? "#e2b88c" : "#f6d2ae", hair: rugged ? "#4a3220" : "#e8c860", rugged });
  const shield = new THREE.Group(); shield.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.07, 12).rotateX(Math.PI / 2), M("#a9763e")), mesh(new THREE.SphereGeometry(0.1, 6, 5), M("#b8c0cc"), 0, 0, 0.05));
  shield.add(mesh(new THREE.TorusGeometry(0.38, 0.03, 5, 14), M("#8a93a0")));
  shield.position.set(0, 0.25, 0.45); shield.visible = false; f.userData.body.add(shield); f.userData.shield = shield;
  // held items (right hand): handle runs along local y, rotated so it points forward from the fist
  const held = {};
  const grip = (g) => { g.position.set(0, -0.42, 0.06); g.rotation.x = Math.PI / 2; g.visible = false; f.userData.armR.add(g); return g; };
  const hm = new THREE.Group(); hm.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.72, 6).translate(0, 0.1, 0), M("#8b5e34")), mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2).translate(0, 0.5, 0), M("#8a93a0")), mesh(new THREE.BoxGeometry(0.36, 0.05, 0.22).translate(0, 0.5, 0), M("#5a6270"))); held.hammer = grip(hm);
  const ax = new THREE.Group(); ax.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.78, 6).translate(0, 0.15, 0), M("#8b5e34")), mesh(new THREE.BoxGeometry(0.06, 0.3, 0.3).translate(0, 0.5, 0.12), M("#a9b0bd")), mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1).translate(0, 0.46, 0), M("#6a4630"))); held.axe = grip(ax);
  const cl = new THREE.Group(); cl.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.6, 6).translate(0, 0.05, 0), M("#8b5e34")), mesh(new THREE.CylinderGeometry(0.15, 0.09, 0.42, 7).translate(0, 0.52, 0), M("#9aa2b2")), mesh(new THREE.SphereGeometry(0.1, 6, 5), M("#b8c0cc"), 0, 0.75, 0)); held.club = grip(cl);
  f.userData.held = held;
  // swoosh arcs: jab = flat sweep in front, smash = vertical arc over the top
  const arcMat = () => new THREE.MeshBasicMaterial({ color: "#fff3c0", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const jab = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.05, 16, 1, Math.PI * 1.15, Math.PI * 0.7).rotateX(-Math.PI / 2), arcMat()); jab.position.set(0, 0.85, 0.05);
  const smash = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.15, 16, 1, -Math.PI * 0.15, Math.PI * 0.75).rotateY(-Math.PI / 2), arcMat()); smash.position.set(0, 0.85, 0.1);
  f.userData.rig.add(jab, smash); f.userData.jab = jab; f.userData.smash = smash;
  const tc = tunics[id % tunics.length], hat = new THREE.Group();
  hat.add(mesh(new THREE.ConeGeometry(0.2, 0.46, 9).translate(0, 0.23, 0), M(tc)), mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 14).rotateX(Math.PI / 2), M("#8a5a2c"), 0, 0.02, 0));
  const fe = mesh(new THREE.BoxGeometry(0.02, 0.22, 0.07).translate(0, 0.11, 0), M("#f4efe0")); fe.position.set(0.15, 0.06, -0.02); fe.rotation.z = -0.9; hat.add(fe);
  hat.position.set(0, 0.15, -0.03); hat.rotation.x = -0.28; hat.scale.setScalar(1.25); f.userData.head.add(hat);
  f.scale.setScalar(1.3);
  return f;
}
function makeGoblin() {
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#ff4030" });
  const f = makeFigure({ legs: "#4a6a2a", boots: "#45291a", body: "#8a5a2c", armC: "#7cb342", skin: "#7cb342", eye: eyeMat, bw: 0.25, hr: 0.27, ear: 0.09, earL: 0.5, glove: false });
  const club = new THREE.Group(); club.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.7, 6).translate(0, -0.05, 0), M("#8b5e34")), mesh(new THREE.SphereGeometry(0.17, 7, 6), M("#a9763e"), 0, 0.3, 0));
  club.position.set(0, -0.4, 0.1); club.rotation.x = Math.PI / 2; f.userData.armR.add(club);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ff3030", transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.position.y = 0.05; ring.visible = false; f.add(ring); f.userData.ring = ring;
  const bang = label("!", "#ff4d4d", 0.9); bang.position.y = 2.0; bang.visible = false; f.add(bang); f.userData.bang = bang;
  const stars = new THREE.Group(); for (let i = 0; i < 3; i++) stars.add(mesh(new THREE.OctahedronGeometry(0.09, 0), B("#ffd23f"), Math.cos(i * 2.1) * 0.35, 0, Math.sin(i * 2.1) * 0.35, false));
  stars.position.y = 1.75; stars.visible = false; f.add(stars); f.userData.stars = stars;
  f.scale.setScalar(1.12); f.userData.eyeMat = eyeMat;
  f.traverse((o) => { if (o.isMesh && o.material.emissive) o.material = o.material.clone(); });
  return f;
}
function nameTag(name, isMe) { const s = label(name, isMe ? "#ffd23f" : "#ffffff", 0.52); s.position.y = 2.4; return s; }

// ---------- pickups, fires, walls ----------
function makeMush() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6).translate(0, 0.1, 0), M("#f2e6cf")));
  g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.2, 0), M("#d8384a")));
  for (const [x, z] of [[0.08, 0.05], [-0.08, 0.08], [0.0, -0.11]]) g.add(mesh(new THREE.SphereGeometry(0.035, 5, 4), B("#ffffff"), x, 0.36 - Math.hypot(x, z) * 0.3, z, false));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff2a0", transparent: true, opacity: 0.18, depthWrite: false })); glow.position.y = 0.2; g.add(glow);
  return g;
}
function makeFire() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) { const l = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6).rotateZ(Math.PI / 2), M("#6a4630"), 0, 0.1, 0); l.rotation.y = i * 1.05; g.add(l); }
  for (let i = 0; i < 7; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.11, 0), M("#7b8291"), Math.cos(i * 0.9) * 0.5, 0.06, Math.sin(i * 0.9) * 0.5));
  const fl = []; for (const [r, hh, c] of [[0.3, 0.95, "#f0822a"], [0.2, 0.75, "#ffc940"], [0.11, 0.55, "#fff3a8"]]) { const m = mesh(new THREE.ConeGeometry(r, hh, 6).translate(0, hh / 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.4) }), 0, 0.15, 0, false); g.add(m); fl.push(m); }
  g.userData.fl = fl; return g;
}
function makeWall() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.96, 1.0, 0.96).translate(0, 0.5, 0), M("#b98550")));
  for (const y of [0.3, 0.7]) g.add(mesh(new THREE.BoxGeometry(1.0, 0.08, 1.0).translate(0, y, 0), M("#8a5a2c"), 0, 0, 0, false));
  for (const [x, z] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) g.add(mesh(new THREE.BoxGeometry(0.1, 1.04, 0.1).translate(x, 0.52, z), M("#6a4630"), 0, 0, 0, false));
  return g;
}
function makeStoneWall() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.98, 1.1, 0.98).translate(0, 0.55, 0), M("#8d94a3")));
  for (const y of [0.25, 0.55, 0.85]) g.add(mesh(new THREE.BoxGeometry(1.0, 0.05, 1.0).translate(0, y, 0), M("#6b7283"), 0, 0, 0, false));
  for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) g.add(mesh(new THREE.BoxGeometry(0.26, 0.2, 0.26).translate(x, 1.2, z), M("#9aa2b2")));
  return g;
}
function makeFloor() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.98, 0.2, 0.98).translate(0, 0.05, 0), M("#c9985c"), 0, 0, 0, false));
  for (const x of [-0.33, 0, 0.33]) g.add(mesh(new THREE.BoxGeometry(0.02, 0.21, 0.98).translate(x, 0.05, 0), M("#8a5a2c"), 0, 0, 0, false));
  g.children.forEach((c) => (c.receiveShadow = true));
  return g;
}
function makeTorch() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 6).translate(0, 0.55, 0), M("#6a4630")), mesh(new THREE.CylinderGeometry(0.11, 0.06, 0.14, 6).translate(0, 1.12, 0), M("#3a3a44")));
  const fl = []; for (const [r, hh, c] of [[0.14, 0.42, "#f0822a"], [0.09, 0.32, "#ffc940"], [0.05, 0.22, "#fff3a8"]]) { const m = mesh(new THREE.ConeGeometry(r, hh, 6).translate(0, hh / 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.4) }), 0, 1.18, 0, false); g.add(m); fl.push(m); }
  g.userData.fl = fl; return g;
}
function makeSpikes() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9).translate(0, 0.04, 0), M("#6a4630"), 0, 0, 0, false));
  for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28], [0, 0]]) g.add(mesh(new THREE.ConeGeometry(0.09, 0.5, 5).translate(0, 0.33, 0), M("#b8bfcc"), x, 0, z));
  return g;
}
const makePiece = (k) => [makeWall, makeStoneWall, makeFloor, makeTorch, makeSpikes, makeFire][k]();

// ---------- particles ----------
function pSystem(additive) {
  const N = 700, geo = new THREE.BufferGeometry();
  const a = { position: new Float32Array(N * 3), col: new Float32Array(N * 3), size: new Float32Array(N), alpha: new Float32Array(N) };
  geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3)); geo.setAttribute("col", new THREE.BufferAttribute(a.col, 3)); geo.setAttribute("size", new THREE.BufferAttribute(a.size, 1)); geo.setAttribute("alpha", new THREE.BufferAttribute(a.alpha, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: "attribute vec3 col; attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float sc; void main(){ vC=col; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*sc/-mv.z; gl_Position=projectionMatrix*mv; }",
    fragmentShader: "varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor=vec4(vC * BOOST, vA*smoothstep(.5,.25,d)); }".replace("BOOST", additive ? "1.5" : "1.0"), uniforms: { sc: { value: 600 } } });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  return { pts, a, N, list: [], u: m.uniforms };
}
const PS = { add: pSystem(true), norm: pSystem(false) };
const parts = [];
function spawn(sys, o) { parts.push(Object.assign({ sys, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0.6, max: 0.6, size: 0.15, col: new THREE.Color("#fff"), drag: 0 }, o, { max: o.life || 0.6, col: new THREE.Color(o.col || "#fff") })); }
function burst(sys, n, x, y, z, o) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, sp = (o.sp || 2) * (0.4 + Math.random()); spawn(sys, Object.assign({}, o, { x, y, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (o.up || 2) * (0.3 + Math.random()), life: (o.life || 0.6) * (0.6 + Math.random() * 0.6), col: Array.isArray(o.cols) ? o.cols[i % o.cols.length] : o.col })); } }
function updateParticles(dt) {
  for (const p of parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= p.g * dt; if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vz *= d; } if (p.y < 0.03 && p.g > 0) { p.y = 0.03; p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; } }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
  for (const k of ["add", "norm"]) {
    const S = PS[k], a = S.a; let n = 0;
    for (const p of parts) { if (p.sys !== k || n >= S.N) continue; const f = Math.max(0, p.life / p.max); a.position[n * 3] = p.x; a.position[n * 3 + 1] = p.y; a.position[n * 3 + 2] = p.z; a.col.set([p.col.r, p.col.g, p.col.b], n * 3); a.size[n] = p.size * (p.shrink ? f : 1); a.alpha[n] = Math.min(1, f * 2.2); n++; }
    S.pts.geometry.setDrawRange(0, n); for (const at of ["position", "col", "size", "alpha"]) S.pts.geometry.attributes[at].needsUpdate = true; S.u.sc.value = H * dpr * 0.9;
  }
}
const floaters = [];
function floatText(text, color, x, y, z, scale = 1) { const s = label(text, color, scale); s.position.set(x, y, z); scene.add(s); floaters.push({ s, t: 0, y0: y }); }
const rings = [];
function ring(x, z, color, size = 2.2, life = 0.45, y = 0.08) { const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })); m.position.set(x, y, z); scene.add(m); rings.push({ m, t: 0, life, size }); }
const goldTrunk = new THREE.Color("#ffd23f");

const FX_SND = { hit: "hit", fell: "fell", chip: "chip", shatter: "shatter", build: "build", demolish: "demolish", kill: "kill", crit: "crit", hurt: "hurt", parry: "parry", block: "block", dodge: "dodge" };
function fxEvent(kind, x, y) {
  const near = Math.abs(x - mine.x) < 1.4 && Math.abs(y - mine.y) < 1.4;
  if (FX_SND[kind]) A.play(FX_SND[kind], x, y, kind === "hurt" && !near ? 0.5 : 1);
  if (near && (kind === "crit" || kind === "parry")) { camera.fov -= 4; caKick = 1; } else if (near && kind === "hurt") { camera.fov += 2; caKick = 0.8; } else if (near && (kind === "hit" || kind === "chip" || kind === "fell" || kind === "shatter")) camera.fov -= 1;
  if (kind === "hit" || kind === "fell") {
    treeShake.set(x.toFixed(2) + "," + y.toFixed(2), performance.now());
    burst("norm", kind === "fell" ? 16 : 6, x, 1.0, y, { sp: 2.5, up: 4, g: 14, size: 0.16, cols: ["#c99458", "#7a5028"], life: 0.8 });
    burst("norm", kind === "fell" ? 10 : 3, x, 2.2, y, { sp: 1.2, up: 0.5, g: 1.5, size: 0.18, cols: ["#3f9a52", "#66c274"], life: 1.4, drag: 1 });
    burst("add", 6, x, 1.0, y, { sp: 3, up: 2, g: 4, size: 0.2, col: "#ffd27a", life: 0.3, shrink: true });
    if (kind === "fell") floatText("+3 wood", "#ffd23f", x, 2.6, y);
    if (near) { slow = Math.max(slow, 0.05); shake = Math.max(shake, 0.06); }
  } else if (kind === "chip" || kind === "shatter") {
    rockShake.set(x.toFixed(2) + "," + y.toFixed(2), performance.now());
    burst("norm", kind === "shatter" ? 18 : 6, x, 0.7, y, { sp: 2.6, up: 4, g: 14, size: 0.14, cols: ["#9aa2b2", "#6d7482", "#c4cad6"], life: 0.8 });
    burst("add", 6, x, 0.8, y, { sp: 3, up: 2, g: 4, size: 0.18, col: "#fff3c0", life: 0.25, shrink: true });
    if (kind === "shatter") floatText("+3 stone", "#c4cad6", x, 2.0, y);
    if (near) { slow = Math.max(slow, 0.05); shake = Math.max(shake, 0.06); }
  } else if (kind === "build") {
    burst("norm", 12, x, 0.15, y, { sp: 2, up: 1.5, g: 6, size: 0.26, col: "#d8ccb8", life: 0.5, drag: 1.5, shrink: true });
    burst("norm", 6, x, 0.6, y, { sp: 2, up: 3, g: 12, size: 0.12, cols: ["#c99458", "#8a5a2c"], life: 0.6 });
    burst("add", 5, x, 0.6, y, { sp: 2.5, up: 2, g: 4, size: 0.16, col: "#ffe9a0", life: 0.25, shrink: true }); ring(x, y, "#ffe9a0", 1.6, 0.35);
    if (near || Math.hypot(x - mine.x, y - mine.y) < 7) shake = Math.max(shake, 0.05);
  } else if (kind === "demolish") {
    burst("norm", 14, x, 0.5, y, { sp: 2.8, up: 3.5, g: 12, size: 0.2, cols: ["#c99458", "#8d94a3", "#6a4630"], life: 0.7 }); ring(x, y, "#ff9a7a", 1.6, 0.35);
  } else if (kind === "kill") {
    burst("norm", 14, x, 0.6, y, { sp: 2.5, up: 3, g: 8, size: 0.3, col: "#9bd05a", life: 0.7, shrink: true });
    floatText("KO!", "#9bd05a", x, 2.0, y, 1.2);
  } else if (kind === "crit") {
    burst("add", 20, x, 1.0, y, { sp: 4, up: 3, g: 4, size: 0.26, cols: ["#ffd23f", "#ff8a30"], life: 0.5, shrink: true }); ring(x, y, "#ffd23f", 2.6); floatText("CRIT!", "#ff9a30", x, 2.3, y, 1.3); slow = 0.12;
  } else if (kind === "hurt") {
    burst("add", 10, x, 1.0, y, { sp: 3, up: 3, g: 10, size: 0.22, col: "#ff4d5e", life: 0.5, shrink: true });
    if (near) { shake = 0.3; flash = 0.5; }
  } else if (kind === "parry") {
    burst("add", 26, x, 1.0, y, { sp: 5, up: 3, g: 3, size: 0.25, cols: ["#fff3a8", "#ffd23f", "#ffffff"], life: 0.5, shrink: true }); ring(x, y, "#ffe27a", 3.4, 0.5); ring(x, y, "#ffffff", 2.0, 0.3);
    floatText("PARRY!", "#ffe27a", x, 2.4, y, 1.4); if (near) { slow = 0.22; shake = 0.15; }
  } else if (kind === "block") {
    burst("add", 10, x, 1.0, y, { sp: 3, up: 2, g: 6, size: 0.18, col: "#bcd8ff", life: 0.35, shrink: true }); floatText("block", "#bcd8ff", x, 2.1, y, 0.8); if (near) shake = 0.12;
  } else if (kind === "dodge") {
    burst("norm", 8, x, 0.2, y, { sp: 1.5, up: 0.5, g: 0, size: 0.35, col: "#d8ccb8", life: 0.5, drag: 2 }); floatText("dodge", "#b6f0a0", x, 2.0, y, 0.8);
  }
}

// ---------- network ----------
function connect(cb) {
  const s = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); ws = s;
  s.onopen = () => { tries = 0; cb(); };
  s.onmessage = (e) => on(JSON.parse(e.data));
  s.onclose = () => {
    if (ws !== s) return;
    if (!joined) { if (++tries < 6) { $("msg").textContent = "Waking the server up..."; setTimeout(() => connect(cb), 1200); } else $("msg").textContent = "Could not connect. Tap PLAY to retry."; return; }
    joined = false; $("btns").classList.add("hide"); $("start").classList.remove("hide"); $("msg").textContent = "Disconnected.";
  };
}
const tx = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
function start() {
  A.init(); A.resume(); A.start(); A.play("select");
  const name = $("name").value.trim() || "elf"; localStorage.setItem("ep-name", name); $("msg").textContent = "Connecting...";
  const go = () => tx({ t: "join", name, look });
  if (ws && ws.readyState === 1) go(); else connect(go);
}
$("play").onclick = start; $("again").onclick = () => { A.resume(); $("dead").classList.add("hide"); dead = false; tx({ t: "join", name: $("name").value.trim() || "elf", look }); };

function on(m) {
  if (m.t === "init") { me = m.id; world = m; buildWorld(); joined = true; dead = false; haveMine = false; setHammer(false); $("start").classList.add("hide"); $("btns").classList.remove("hide"); clearEnts(); snap = null; sm.init = 0; }
  else if (m.t === "full") { $("msg").textContent = "World is full (25 elves). Try again in a minute."; }
  else if (m.t === "dead") { dead = true; A.play("death"); $("deadmsg").textContent = `You lasted ${m.secs}s and punched ${m.kills} goblin${m.kills === 1 ? "" : "s"}. Cause: ${m.why}.`; $("dead").classList.remove("hide"); }
  else if (m.t === "s") {
    snap = m; const [x, y, hp, hu, wa, wood, kills, st, stone, tools] = m.me; if (haveMine) { if (hu - mine.hu > 10) A.play("pickup"); else if (wood > mine.wood || stone > mine.stone) A.play("loot", undefined, undefined, 0.8); if (tools !== mine.tools && tools > mine.tools) A.play("craft"); } mine = { x, y, hp, hu, wa, wood, kills, st, stone, tools }; haveMine = true; if (bagOpen) renderBag();
    if (!sm.init) sm = { x, y, init: 1 };
    const seen = new Set();
    for (const p of m.p) { seen.add(p[0]); upsert(p[0], "p", p); }
    for (const g of m.g) { seen.add(g[0]); upsert(g[0], "g", g); }
    for (const [id, e] of ent) if (!seen.has(id)) { scene.remove(e.node); ent.delete(id); }
    syncStatic(m);
    for (const ev of m.ev) fxEvent(ev[0], ev[1], ev[2]);
    if (m.lb) lb = m.lb;
  }
}
function clearEnts() { for (const e of ent.values()) scene.remove(e.node); ent.clear(); for (const mp of [fireObjs, wallObjs, mushObjs]) { for (const o of mp.values()) scene.remove(o); mp.clear(); } felled = new Set(); world.trees.forEach((_, i) => setTree(i, 0)); world.rocks.forEach((_, i) => setRock(i, 0)); }
function upsert(id, type, d) {
  let e = ent.get(id);
  if (!e) {
    const node = type === "p" ? makeElf(id, id === me ? look === 1 : (d[7] >> 3 & 1) === 1) : makeGoblin();
    if (type === "p") node.add(nameTag(d[5], id === me));
    e = { isMe: type === "p" && id === me, type, node, x: d[1], y: d[2], tx: d[1], ty: d[2], rot: 0, walk: 0, punchT: -1, rollT: -1, swingT: -1, st: 0, hp: d[3], flashT: 0 };
    node.position.set(d[1], 0, d[2]); scene.add(node); ent.set(id, e);
  }
  e.tx = d[1]; e.ty = d[2];
  if (type === "p") { const st = d[6] || 0; e.eq = d[7] | 0; if (d[4] && e.punchT < 0) startPunch(e); if (st === 2 && e.st !== 2) e.rollT = 0; e.st = st; e.face = d[3]; }
  else { const st = d[4] || 0; if (st === 1 && e.st !== 1) A.play("gob_wind", e.x, e.y); if (st === 3 && e.st !== 3) A.play("gob_stun", e.x, e.y); if (e.st === 1 && st !== 1 && st !== 3) { e.swingT = 0; A.play("gob_swing", e.x, e.y); } if (d[3] < e.hp) e.flashT = 0.18; e.hp = d[3]; e.st = st; }
}
function syncStatic(m) {
  const nf = new Set(m.tf);
  const NT = world.trees.length, fix = (i) => (i < NT ? setTree(i, 0) : setRock(i - NT, 0));
  for (const i of nf) if (!felled.has(i)) { felled.add(i); fix(i); }
  for (const i of [...felled]) if (!nf.has(i)) { felled.delete(i); fix(i); }
  const sync = (map, list, key, make, place) => {
    const seen = new Set();
    for (const it of list) { const k = key(it); seen.add(k); let o = map.get(k); if (!o) { o = make(it); place(o, it); o.userData.kind = it[3]; scene.add(o); map.set(k, o); } o.userData.it = it; }
    for (const [k, o] of map) if (!seen.has(k)) { scene.remove(o); map.delete(k); }
  };
  sync(mushObjs, m.m, (i) => i[0] + "," + i[1], makeMush, (o, i) => o.position.set(i[0], 0, i[1]));
  sync(fireObjs, m.f, (i) => i[0] + "," + i[1], makeFire, (o, i) => o.position.set(i[0], 0, i[1]));
  sync(wallObjs, m.w, (i) => i[0] + "," + i[1] + "," + i[3], (i) => makePiece(i[3] | 0), (o, i) => o.position.set(i[0], 0, i[1]));
  pieceCells = new Map(m.w.map((i) => [Math.floor(i[0]) + "," + Math.floor(i[1]), i[3] | 0]));
}

// ---------- input ----------
for (const ev of ["gesturestart", "gesturechange", "gestureend", "dblclick", "contextmenu"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
let lastTouch = 0;
document.addEventListener("touchend", (e) => { const n = Date.now(); if (n - lastTouch < 400) e.preventDefault(); lastTouch = n; }, { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
const keys = {}; let stick = null;
let look = localStorage.getItem("ep-look") === "1" ? 1 : 0;
const syncLook = () => { for (const b of document.querySelectorAll("#looks button")) b.classList.toggle("on", +b.dataset.look === look); };
for (const b of document.querySelectorAll("#looks button")) b.onclick = () => { look = +b.dataset.look; localStorage.setItem("ep-look", look); syncLook(); };
syncLook();
// camera rotation: Z / C, right-drag, or the on-screen arrows; movement is rotated to match
let camYaw = 0, camGoal = 0, camDrag = null; const camKeys = { l: 0, r: 0 };
const rotCam = (d) => { camGoal += d; };
const KMAP = { KeyW: "u", ArrowUp: "u", KeyS: "d", ArrowDown: "d", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
const cellOf = (x, y) => [Math.floor(x), Math.floor(y)];
// the grid cell the hammer is aimed at: a manual aim (mouse hover, or a tap) if fresh, else the cell in front of the elf
function aimCell() {
  const me_ = ent.get(me), a = me_ ? me_.rot : 0;
  if (aim && Math.hypot(aim[0] + 0.5 - sm.x, aim[1] + 0.5 - sm.y) <= REACH + 2 && (aim.mouse || performance.now() - aimAt < 4000)) return aim;
  return cellOf(sm.x + Math.sin(a) * 1.5, sm.y + Math.cos(a) * 1.5);
}
const afford = (p) => mine.wood >= p.w && mine.stone >= p.s;
function cellOk(p, c) {
  const [cx, cy] = c, mx = cx + 0.5, my = cy + 0.5;
  if (Math.hypot(mx - sm.x, my - sm.y) > REACH) return false;
  if (p.k === -1) return pieceCells.has(cx + "," + cy) || [...fireObjs.values()].some((o) => Math.hypot(o.position.x - mx, o.position.z - my) < 0.9);
  if (cx < 1 || cy < 1 || cx >= world.w - 1 || cy >= world.h - 1 || pieceCells.has(cx + "," + cy)) return false;
  if (p.k === 5 && [...fireObjs.values()].some((o) => Math.hypot(o.position.x - mx, o.position.z - my) < 0.9)) return mine.wood >= 2;
  if (!afford(p)) return false;
  if (world.trees.some((t, i) => !felled.has(i) && Math.hypot(t[0] - mx, t[1] - my) < 0.9)) return false;
  if (world.rocks.some((t, i) => !felled.has(world.trees.length + i) && Math.hypot(t[0] - mx, t[1] - my) < 0.9)) return false;
  if (p.k < 2 && [...ent.values()].some((e) => Math.floor(e.x) === cx && Math.floor(e.y) === cy)) return false;
  return true;
}
function doPlace() {
  const p = PIECES[sel], [cx, cy] = aimCell();
  tx(p.k === -1 ? { t: "remove", cx, cy } : { t: "place", k: p.k, cx, cy });
}
function setHammer(on) {
  if (hammer !== on) A.play("equip"); hammer = on; aim = null; if (on) setBlock(false); tx({ t: "equip", h: on });
  $("bh").style.outline = on ? "4px solid #ffd23f" : ""; $("bar").classList.toggle("hide", !on); syncBuildUI();
}
function syncBuildUI() { $("bp").firstChild.textContent = !hammer ? "PUNCH" : PIECES[sel].k === -1 ? "BREAK" : "PLACE"; if (hammer) renderBar(); }
function pick(n) { A.play("select"); sel = n; if (!hammer) setHammer(true); else syncBuildUI(); }
let ghost = null, ghostKey = "";
function renderBar() {
  $("bar").innerHTML = PIECES.map((p, i) => `<div class="slot${i === sel ? " on" : ""}${p.k >= 0 && !afford(p) ? " no" : ""}" data-i="${i}"><b>${i + 1}</b>${p.n}<small>${p.k === -1 ? "refund half" : (p.w ? p.w + " wood" : "") + (p.s ? p.s + " stone" : "")}</small></div>`).join("");
  for (const el of $("bar").children) el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); pick(+el.dataset.i); });
}
function renderBag() {
  const k = [mine.wood, mine.stone, mine.tools, hammer].join(); if (bagOpen && k === bagKey) return; bagKey = k;
  const has = (n) => (mine.tools >> n) & 1, can = (w, st) => mine.wood >= w && mine.stone >= st;
  $("bag").innerHTML = `<h2>BAG</h2><div class="row"><span>Wood</span><b>${mine.wood}</b></div><div class="row"><span>Stone</span><b>${mine.stone}</b></div>
  <div class="row"><span>Hammer</span><b>always with you</b></div>
  <button data-c="axe" ${has(0) || !can(4, 2) ? "disabled" : ""}>${has(0) ? "Stone Axe (owned)" : "Craft Stone Axe"}<small>4 wood, 2 stone. Chops trees and rocks twice as fast.</small></button>
  <button data-c="club" ${has(1) || !can(3, 3) ? "disabled" : ""}>${has(1) ? "Stone Club (owned)" : "Craft Stone Club"}<small>3 wood, 3 stone. Double punch damage on goblins, bigger crits.</small></button>
  <div class="dim2">Hammer (E): pick a piece with 1-7, aim with the mouse, click or space to place. Punch rocks for stone. Tools are lost when you die.</div>
  <button id="bagx" class="x">CLOSE</button>`;
  for (const b of $("bag").querySelectorAll("button[data-c]")) b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); tx({ t: "craft", k: b.dataset.c }); });
  $("bagx").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); toggleBag(false); });
}
function toggleBag(on) { bagOpen = on === undefined ? !bagOpen : on; $("bag").classList.toggle("hide", !bagOpen); bagKey = ""; if (bagOpen) renderBag(); }
function toggleMute() { const on = !A.enabled; A.setEnabled(on); localStorage.setItem("ep-mute", on ? "0" : "1"); $("mute").textContent = on ? "\u266a" : "\u00d7"; $("mute").classList.toggle("off", !on); }
A.enabled = localStorage.getItem("ep-mute") !== "1"; $("mute").textContent = A.enabled ? "\u266a" : "\u00d7"; $("mute").classList.toggle("off", !A.enabled);
$("mute").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); A.resume(); toggleMute(); });
const punch = () => { punchAt = performance.now(); if (hammer) doPlace(); else tx({ t: "punch" }); };
const dodge = () => { rollAt = performance.now(); tx({ t: "dodge" }); };
const setBlock = (on) => { if (blocking === on) return; blocking = on; tx({ t: "block", on }); $("bb").style.outline = on ? "4px solid #fff" : ""; };
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  A.resume(); if (e.code === "KeyM" && !e.repeat) toggleMute();
  if (e.code === "KeyZ") camKeys.l = 1; if (e.code === "KeyC") camKeys.r = 1;
  if (KMAP[e.code]) keys[KMAP[e.code]] = 1;
  if (e.code === "Space" || e.code === "KeyJ") { e.preventDefault(); if (!e.repeat) punch(); }
  if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyL") { if (!e.repeat) dodge(); }
  if ((e.code === "KeyB" || e.code === "KeyK" || e.code === "ControlLeft") && !hammer) setBlock(true);
  if (e.code === "KeyF") tx({ t: "fire" }); if (e.code === "KeyQ") tx({ t: "wall" });
  if (e.code === "KeyE" && !e.repeat && joined && !dead) setHammer(!hammer);
  if (e.code === "Escape") { if (bagOpen) toggleBag(false); else if (hammer) setHammer(false); }
  if ((e.code === "KeyI" || e.code === "Tab") && !e.repeat) { e.preventDefault(); toggleBag(); }
  if (/^Digit[1-7]$/.test(e.code) && joined && !dead) pick(+e.code.slice(5) - 1);
});
addEventListener("keyup", (e) => { if (e.code === "KeyZ") camKeys.l = 0; if (e.code === "KeyC") camKeys.r = 0; if (KMAP[e.code]) keys[KMAP[e.code]] = 0; if (e.code === "KeyB" || e.code === "KeyK" || e.code === "ControlLeft") setBlock(false); });
const bind = (id, fn, up) => { const el = $(id); el.addEventListener("pointerdown", (e) => { A.resume(); if (id !== "bp" && id !== "bd" && id !== "bb") A.play("click"); e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); fn(); }); if (up) { el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); } };
bind("bp", punch); bind("cl", () => rotCam(Math.PI / 4)); bind("cr", () => rotCam(-Math.PI / 4)); bind("bh", () => setHammer(!hammer)); bind("bg", () => toggleBag()); bind("bd", dodge); bind("bb", () => setBlock(true), () => setBlock(false));
const surf = $("gl");
surf.addEventListener("contextmenu", (e) => e.preventDefault());
surf.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button === 2) { camDrag = { x: e.clientX, g: camGoal }; surf.setPointerCapture(e.pointerId); } });
surf.addEventListener("pointermove", (e) => { if (camDrag) camGoal = camDrag.g - (e.clientX - camDrag.x) * 0.008; });
surf.addEventListener("pointerup", (e) => { if (e.button === 2) camDrag = null; });
const rayCell = (cx, cy) => { const v = new THREE.Vector2(cx / W * 2 - 1, -(cy / H) * 2 + 1), rc = new THREE.Raycaster(); rc.setFromCamera(v, camera); const hit = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); return hit ? [Math.floor(hit.x), Math.floor(hit.z)] : null; };
surf.addEventListener("pointermove", (e) => { if (hammer && e.pointerType === "mouse") { const c = rayCell(e.clientX, e.clientY); if (c) { aim = c; aim.mouse = 1; aimAt = performance.now(); } } });
surf.addEventListener("pointerdown", (e) => {
  if (hammer && joined && !dead && (e.pointerType === "mouse" || e.clientX >= W * 0.55)) {
    const c = rayCell(e.clientX, e.clientY); if (c) { aim = c; if (e.pointerType === "mouse") { aim.mouse = 1; punchAt = performance.now(); doPlace(); } else aimAt = performance.now(); }
    return;
  }
  if (e.clientX < W * 0.55 && !stick) { stick = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY }; surf.setPointerCapture(e.pointerId); } });
surf.addEventListener("pointermove", (e) => { if (stick && stick.id === e.pointerId) { stick.cx = e.clientX; stick.cy = e.clientY; } });
const up = (e) => { if (stick && stick.id === e.pointerId) stick = null; };
surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
setInterval(() => {
  if (!joined || dead) return;
  let x = (keys.r || 0) - (keys.l || 0), y = (keys.d || 0) - (keys.u || 0);
  if (stick) { const dx = stick.cx - stick.x, dy = stick.cy - stick.y, l = Math.hypot(dx, dy); if (l > 8) { const f = Math.min(1, l / 50); x = dx / l * f; y = dy / l * f; } }
  { const c = Math.cos(camYaw), sn = Math.sin(camYaw), rx = x * c + y * sn; y = -x * sn + y * c; x = rx; }
  mv = { x, y }; const k = x.toFixed(2) + "," + y.toFixed(2);
  if (k !== lastIn || x || y) { lastIn = k; tx({ t: "in", x, y }); }
}, 100);

// ---------- animation ----------
const angLerp = (a, b, k) => { let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * k; };
const nearestTarget = (x, y) => { let best = null, bd = 1.5; for (const e of ent.values()) if (e.type === "g") { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } } if (best) return [best.x, best.y]; bd = 1.5; if (world) [...world.trees, ...world.rocks].forEach((t, i) => { if (felled.has(i)) return; const d = Math.hypot(t[0] - x, t[1] - y); if (d < bd) { bd = d; best = { x: t[0], y: t[1] }; } }); return best ? [best.x, best.y] : null; };
function startPunch(e) { e.punchT = 0; e.combo = ((e.combo | 0) + 1) % 3; if (!(e.isMe ? hammer : (e.eq | 0) & 1)) A.play(e.combo === 2 ? "swing_big" : "swing", e.x, e.y); }
const clamp01 = (v) => Math.max(0, Math.min(1, v)), easeOut = (t) => 1 - (1 - t) ** 3, easeIn = (t) => t * t * t;
// swing curve: -1 fully wound up (p=.3), +1 full extension (p=.5), then eases back to 0. Anticipation, fast strike, slow recovery.
const swingW = (p) => (p < 0.3 ? -easeOut(p / 0.3) : p < 0.5 ? -1 + 2 * easeIn((p - 0.3) / 0.2) : 1 - easeOut((p - 0.5) / 0.5));
function animFigure(e, dt, now, isMe) {
  const u = e.node.userData, moving = Math.hypot(e.tx - e.x, e.ty - e.y) > 0.015 || (isMe && (mv.x || mv.y));
  e.walk += dt * (moving ? 11 : 0); const sw = moving ? Math.sin(e.walk) : 0;
  u.legL.rotation.x = sw * 0.8; u.legR.rotation.x = -sw * 0.8; u.armL.rotation.set(-sw * 0.6, 0, 0.08); u.armR.rotation.set(sw * 0.6, 0, -0.08);
  u.body.position.y = 0.5 + (moving ? Math.abs(Math.sin(e.walk)) * 0.07 : Math.sin(now / 600) * 0.012); u.body.rotation.set(0, 0, 0); u.rig.rotation.set(0, 0, 0); u.rig.position.set(0, 0, 0); u.head.rotation.set(0, 0, 0); if (u.smash) u.smash.scale.set(1, 1, 1);
  if (u.cape) { const v = moving ? 0.35 + Math.abs(sw) * 0.25 : 0.1 + Math.sin(now / 700) * 0.04; u.cape.rotation.x = v; u.tail.rotation.x = 0.35 + (moving ? Math.sin(e.walk * 0.5) * 0.25 : Math.sin(now / 900) * 0.06); }
  if (e.type === "p") {
    const st = isMe && blocking && e.st === 0 ? 3 : e.st;
    const eq = isMe ? (hammer ? 1 : 0) | (mine.tools << 1) : e.eq | 0;
    u.held.hammer.visible = !!(eq & 1); u.held.club.visible = !(eq & 1) && !!(eq & 4); u.held.axe.visible = !(eq & 1) && !(eq & 4) && !!(eq & 2); u.gloveR.visible = !(eq & 7);
    if (isMe && now - punchAt < 40 && e.punchT < 0) startPunch(e);
    u.jab.material.opacity = 0; u.smash.material.opacity = 0;
    if (e.punchT >= 0) {
      e.punchT += dt; const p = Math.min(1, e.punchT / 0.3), w = swingW(p), ex = Math.max(0, w), wind = Math.max(0, -w);
      const big = e.combo === 2 || (eq & 1), arm = e.combo === 1 && !(eq & 1) ? u.armL : u.armR, off = arm === u.armR ? u.armL : u.armR, side = arm === u.armR ? 1 : -1;
      if (big) {
        // overhead smash: both hands up and back, slam down and forward, weight on the front foot
        arm.rotation.set(w < 0 ? 2.9 * w : -1.35 * w, 0, -0.1 * side); off.rotation.set(w < 0 ? 1.6 * w : -0.9 * w, 0, 0.12 * side);
        u.body.rotation.x = 0.5 * w; u.rig.position.z = 0.26 * ex - 0.05 * wind; u.body.position.y -= 0.07 * ex; u.body.rotation.y = 0.12 * w * side;
        u.legL.rotation.x = -0.55 * ex + 0.25 * wind; u.legR.rotation.x = 0.5 * ex - 0.2 * wind;
        if (p > 0.28 && p < 0.62) { u.smash.material.opacity = 0.75 * (1 - clamp01((p - 0.3) / 0.3)); u.smash.scale.set(1, 1 + 0.25 * ex, 1 + 0.25 * ex); }
        u.head.rotation.x = 0.25 * ex - 0.2 * wind;
      } else {
        // quick jab: fist pulled back to the hip, then straight out, hips and shoulders turning into it
        arm.rotation.set(w < 0 ? -w * 0.9 : -w * 1.6, 0, -0.12 * side * ex); off.rotation.set(-0.5 + 0.35 * w, 0, 0.3 * side);
        u.body.rotation.y = -0.55 * w * side; u.body.rotation.x = 0.12 * w; u.rig.position.z = 0.17 * ex - 0.03 * wind;
        u.legL.rotation.x = -0.35 * ex * side; u.legR.rotation.x = 0.35 * ex * side;
        if (p > 0.28 && p < 0.6) { u.jab.material.opacity = 0.6 * (1 - clamp01((p - 0.3) / 0.3)); u.jab.scale.x = side; }
        u.head.rotation.y = 0.2 * w * side;
      }
      if (p >= 1) e.punchT = -1;
    }
    if (e.rollT >= 0 || (isMe && now - rollAt < 400 && e.st !== 2 && now - rollAt < 60)) { if (e.rollT < 0) e.rollT = 0; }
    if (e.rollT >= 0) { e.rollT += dt; const p = Math.min(1, e.rollT / 0.4); u.rig.rotation.x = p * Math.PI * 2; u.rig.position.y = 0.45 + Math.sin(p * Math.PI) * 0.15; u.armL.rotation.set(-2.4, 0, 0.3); u.armR.rotation.set(-2.4, 0, -0.3); u.legL.rotation.x = u.legR.rotation.x = -1.6; if (p >= 1) e.rollT = -1; }
    const sh = u.shield; sh.visible = st === 3 || st === 4;
    if (sh.visible) { u.armL.rotation.set(-1.25, 0, 0.35); u.armR.rotation.set(-1.25, 0, -0.35); u.held.hammer.visible = u.held.axe.visible = u.held.club.visible = false; u.gloveR.visible = true; sh.children[0].material = st === 4 ? M("#ffe27a", { emissive: "#ffb000", emissiveIntensity: 0.8 }) : M("#a9763e"); }
  } else {
    if (e.st === 1) { const ph = Math.min(1, (e.windT = (e.windT || 0) + dt) / 0.65); u.armR.rotation.set(-2.9 + Math.sin(now / 40) * 0.05, 0, -0.2); u.body.rotation.x = -0.35 * ph; u.body.position.y += 0.03; u.ring.visible = true; u.ring.scale.setScalar(0.4 + 0.75 * ph); u.ring.material.opacity = 0.3 + 0.6 * ph; u.bang.visible = true; u.bang.scale.set(2.2 + Math.sin(now / 60) * 0.25, 0.55 + Math.sin(now / 60) * 0.07, 1); }
    else { e.windT = 0; u.ring.visible = false; u.bang.visible = false; }
    if (e.swingT >= 0) { e.swingT += dt; const p = Math.min(1, e.swingT / 0.25); u.armR.rotation.set(-2.9 + p * 3.6, 0, 0); u.body.rotation.x = 0.4 * Math.sin(p * Math.PI); if (p >= 1) e.swingT = -1; }
    u.stars.visible = e.st === 3; if (e.st === 3) { u.stars.rotation.y += dt * 6; u.body.rotation.z = Math.sin(now / 130) * 0.18; u.head.rotation.z = Math.sin(now / 90) * 0.25; u.armR.rotation.set(0.5, 0, 0); u.armL.rotation.set(0.5, 0, 0); }
    e.flashT = Math.max(0, e.flashT - dt); u.eyeMat.color.set(e.st === 1 ? "#ffee40" : "#ff4030");
    const fl = e.flashT > 0; e.node.traverse((o) => { if (o.isMesh && o.material.emissive !== undefined) { o.material.emissive.set(fl ? "#ff6060" : "#000000"); o.material.emissiveIntensity = fl ? 0.8 : 0; } });
  }
}
function nightFactor(tm) { return tm >= 140 ? (150 - tm) / 10 : tm >= 90 ? 1 : tm >= 80 ? (tm - 80) / 10 : 0; }
function warmFactor(tm) { return tm >= 72 && tm < 92 ? Math.sin((tm - 72) / 20 * Math.PI) : tm >= 138 && tm < 150 ? Math.sin((tm - 138) / 12 * Math.PI) * 0.7 : 0; }
const SKY_DAY = new THREE.Color("#8ec5ff"), SKY_NIGHT = new THREE.Color("#070b22"), SKY_WARM = new THREE.Color("#ff9a5a");
const SUN_DAY = new THREE.Color("#fff0d0"), SUN_NIGHT = new THREE.Color("#5a78d0");
let last = performance.now(), emberAcc = 0, leafAcc = 0, dustT = 0;
const dotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const firefly = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: "#c8ff78", size: 0.32, map: dotTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
firefly.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(60 * 3), 3)); firefly.frustumCulled = false; scene.add(firefly);

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (slow > 0) { slow -= dt; dt *= 0.3; }
  if (!world || !snap) { renderFrame(); return; }
  const k = 1 - Math.exp(-dt * 14);
  sm.x += (mine.x - sm.x) * k; sm.y += (mine.y - sm.y) * k;
  shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  const tm = snap.tm, nf = nightFactor(tm), wf = warmFactor(tm);
  // entities
  for (const [id, e] of ent) {
    const isMe = id === me, kk = 1 - Math.exp(-dt * (isMe ? 18 : 12));
    const px = e.x, py = e.y; e.x += (e.tx - e.x) * kk; e.y += (e.ty - e.y) * kk;
    if (isMe) { e.x = sm.x; e.y = sm.y; }
    const dx = e.x - px, dy = e.y - py; let want = null;
    if (e.type === "p" && isMe && (e.punchT >= 0 || now - punchAt < 280)) { if (hammer) { const c = aimCell(); want = Math.atan2(c[0] + 0.5 - e.x, c[1] + 0.5 - e.y); } else { const t = nearestTarget(e.x, e.y); if (t) want = Math.atan2(t[0] - e.x, t[1] - e.y); } }
    if (want === null && isMe && (mv.x || mv.y)) want = Math.atan2(mv.x, mv.y);
    if (want === null && Math.hypot(dx, dy) > 0.004) want = Math.atan2(dx, dy);
    if (want === null && e.type === "g") { let bd = 99, bx = 0, by = 0; for (const o of ent.values()) if (o.type === "p") { const d = Math.hypot(o.x - e.x, o.y - e.y); if (d < bd) { bd = d; bx = o.x; by = o.y; } } if (bd < 99) want = Math.atan2(bx - e.x, by - e.y); }
    if (want !== null) e.rot = angLerp(e.rot, want, 1 - Math.exp(-dt * (e.type === "g" && e.st === 1 ? 4 : 14)));
    const fy = pieceCells.get(Math.floor(e.x) + "," + Math.floor(e.y)) === 2 ? 0.14 : 0; e.ey = (e.ey || 0) + (fy - (e.ey || 0)) * Math.min(1, dt * 12);
    e.node.position.set(e.x, e.ey, e.y); e.node.rotation.y = e.rot;
    animFigure(e, dt, now, isMe);
    if (isMe) { stepD += Math.hypot(dx, dy); if (stepD > 1.15) { stepD = 0; A.play(pieceCells.get(Math.floor(e.x) + "," + Math.floor(e.y)) === 2 ? "step_wood" : "step", undefined, undefined, 0.9); } }
    if (isMe && Math.hypot(dx, dy) > 0.02 && now - dustT > 130) { dustT = now; burst("norm", 1, e.x - Math.sin(e.rot) * 0.2, 0.05, e.y - Math.cos(e.rot) * 0.2, { sp: 0.3, up: 0.3, g: 0, size: 0.22, col: "#c8b48c", life: 0.45, drag: 2, shrink: true }); }
  }
  // trees that are shaking
  for (const [key, t0] of treeShake) { const i = treeIndex.get(key), f = 1 - (now - t0) / 380; if (i === undefined || f <= 0) { treeShake.delete(key); if (i !== undefined) setTree(i, 0); } else setTree(i, f); }
  for (const [key, t0] of rockShake) { const i = rockIndex.get(key), f = 1 - (now - t0) / 320; if (i === undefined || f <= 0) { rockShake.delete(key); if (i !== undefined) setRock(i, 0); } else setRock(i, f); }
  // pickups, fire, walls
  for (const o of mushObjs.values()) { o.position.y = 0.05 + Math.sin(now / 400 + o.position.x) * 0.04; o.rotation.y += dt; }
  const fl = [...fireObjs.values(), ...[...wallObjs.values()].filter((o) => o.userData.kind === 3)]; fl.sort((a, b) => Math.hypot(a.position.x - sm.x, a.position.z - sm.y) - Math.hypot(b.position.x - sm.x, b.position.z - sm.y));
  fl.forEach((o, n) => { const t = now / 1000 + o.position.x * 3; o.userData.fl.forEach((m, j) => { const s = 1 + Math.sin(t * (9 + j * 3) + j) * 0.12 + Math.sin(t * 23 + j) * 0.06; m.scale.set(s * 0.95, s * (1 + j * 0.05), s * 0.95); m.rotation.y = t * 2; }); if (n < 3) { const l = firePool[n]; l.position.set(o.position.x, 1.0, o.position.z); l.intensity = (16 + Math.sin(t * 17) * 3 + Math.sin(t * 29) * 2) * (0.35 + nf * 0.85) * (o.userData.kind === 3 ? 0.4 : 1); } });
  for (let n = fl.length; n < 3; n++) firePool[n].intensity = 0;
  for (const o of wallObjs.values()) { const hp = o.userData.it[2], k = o.userData.kind; if (k === 0) o.children[0].material = hp >= 8 ? M("#b98550") : hp > 4 ? M("#a07048") : M("#8a4a3a"); else if (k === 1) o.children[0].material = hp > 12 ? M("#8d94a3") : hp > 6 ? M("#7a8090") : M("#6a6070"); }
  updateBuildView(now);
  // embers, leaves
  emberAcc += dt * 16; while (emberAcc > 1) { emberAcc--; const o = fl.length ? fl[Math.floor(Math.random() * fl.length)] : null; if (o) spawn("add", { x: o.position.x + (Math.random() - .5) * .3, y: 0.5, z: o.position.z + (Math.random() - .5) * .3, vx: (Math.random() - .5) * .4, vy: 1.2 + Math.random() * 1.5, vz: (Math.random() - .5) * .4, g: -0.2, size: 0.11, col: Math.random() < 0.5 ? "#ffb030" : "#ff6a20", life: 1 + Math.random(), shrink: true }); }
  leafAcc += dt * 2; while (leafAcc > 1) { leafAcc--; spawn("norm", { x: sm.x + (Math.random() - .5) * 18, y: 6 + Math.random() * 2, z: sm.y + (Math.random() - .5) * 14 - 4, vx: 0.6, vy: -0.9, vz: 0.3, g: 0, size: 0.14, col: Math.random() < 0.5 ? "#9bd05a" : "#d8a34a", life: 6, drag: 0 }); }
  updateParticles(dt);
  for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t += dt; f.s.position.y = f.y0 + f.t * 1.1; f.s.material.opacity = Math.max(0, 1 - Math.max(0, f.t - 0.6) / 0.6); if (f.t > 1.2) { scene.remove(f.s); f.s.material.dispose(); floaters.splice(i, 1); } }
  for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += dt; const p = r.t / r.life; r.m.scale.setScalar(0.3 + p * r.size); r.m.material.opacity = Math.max(0, 0.9 * (1 - p)); if (p >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); } }
  // sky and lights
  mixPalette(nf, wf); sky.copy(CUR.hor); scene.fog.color.copy(CUR.hor); scene.fog.near = 26 - nf * 14; scene.fog.far = 84 - nf * 48;
  skyMat.uniforms.top.value.copy(CUR.top); skyMat.uniforms.mid.value.copy(CUR.mid); skyMat.uniforms.hor.value.copy(CUR.hor); skyMat.uniforms.sunCol.value.copy(CUR.sun); skyMat.uniforms.night.value = nf; skyMat.uniforms.warm.value = wf;
  skyDome.position.copy(camera.position); timeU.value = now / 1000;
  { const su = seaMat.uniforms; su.hor.value.copy(CUR.hor); su.mid.value.copy(CUR.mid); su.sunCol.value.copy(CUR.sun); su.night.value = nf; }
  for (const r of ridges) { r.m.material.color.copy(CUR.ridge).lerp(tmpC.copy(CUR.hor).lerp(CUR.mid, 0.5 + 0.3 * (1 - nf)), r.k * 0.9); }
  hemi.intensity = 1.7 - nf * 1.2; hemi.color.copy(CUR.hs); hemi.groundColor.copy(CUR.hg);
  sun.intensity = 2.6 - nf * 2.3; sun.color.copy(CUR.sun).lerp(tmpC.set("#ffb060"), 0.35 * (1 - nf));
  const az = (tm / 150) * Math.PI * 1.1 + 0.4, sdx = Math.cos(az) * 18, sdy = 8.5 + Math.sin(az) * 3.5, sdz = -14;
  sun.position.set(sm.x + sdx, sdy, sm.y + sdz); sun.target.position.set(sm.x, 0, sm.y); skyMat.uniforms.sunDir.value.set(sdx, sdy - 3.0, sdz); seaMat.uniforms.sunDir.value.copy(skyMat.uniforms.sunDir.value);
  fill.color.copy(CUR.hs).lerp(tmpC.set("#7fb6c8"), 0.5); fill.intensity = 0.95 - nf * 0.7; fill.position.set(sm.x - 6, 6, sm.y + 10); fill.target.position.set(sm.x, 0, sm.y);
  heroLight.intensity = nf * 4.5; heroLight.position.set(sm.x, 2.5, sm.y + 0.8);
  firefly.material.opacity = nf * 0.9; if (nf > 0.05) { const p = firefly.geometry.attributes.position; for (let i = 0; i < 60; i++) p.setXYZ(i, sm.x + Math.sin(now / 2000 + i * 7) * 9 + (hash(i, 1) - .5) * 14, 0.4 + hash(i, 2) * 2 + Math.sin(now / 700 + i) * 0.3, sm.y + Math.cos(now / 2300 + i * 5) * 7 + (hash(i, 3) - .5) * 12); p.needsUpdate = true; }
  { A.listener.x = sm.x; A.listener.y = sm.y; let gd = 99, fd = 99; for (const e of ent.values()) if (e.type === "g") gd = Math.min(gd, Math.hypot(e.x - sm.x, e.y - sm.y)); for (const o of fl) fd = Math.min(fd, Math.hypot(o.position.x - sm.x, o.position.z - sm.y));
    A.update(dt, { night: nf, danger: nf > 0.2 ? Math.max(0, Math.min(1, 1 - (gd - 3) / 11)) : 0, fire: Math.max(0, Math.min(1, 1 - fd / 9)) });
    const isN = tm >= 88 && tm < 148; if (prevNight !== null && isN !== prevNight) A.play(isN ? "dusk" : "dawn"); prevNight = isN; }
  // camera
  const sx = shake ? (Math.random() - .5) * 0.5 * shake / 0.3 : 0, sz = shake ? (Math.random() - .5) * 0.5 * shake / 0.3 : 0;
  const dist = W / H < 1 ? 1.0 : 0.86;
  camGoal += ((camKeys.r || 0) - (camKeys.l || 0)) * dt * 2; camYaw += (camGoal - camYaw) * Math.min(1, dt * 8);
  { const cy = Math.cos(camYaw), sy = Math.sin(camYaw), oz = 10.0 * dist, lz = -4.2;
    camera.position.set(sm.x + sx + oz * sy, 5.8 * dist, sm.y + sz + oz * cy); camera.lookAt(sm.x + lz * sy, 2.3, sm.y + lz * cy); }
  { const u = compMat.uniforms, sd = skyMat.uniforms.sunDir.value.clone().normalize(), p = camera.position.clone().addScaledVector(sd, 200).project(camera), fwd = camera.getWorldDirection(new THREE.Vector3()), front = Math.max(0, fwd.dot(sd));
    u.sunUV.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); u.sunCol.value.copy(CUR.sun); u.rays.value = front > 0.05 ? (0.2 + wf * 0.9) * (1 - nf) * Math.min(1, front * 2.5) : 0;
    u.bloom.value = 0.22 + nf * 0.6 + wf * 0.3; u.night.value = nf; u.warm.value = wf; u.hurt.value = Math.max(0, flash) * 1.4 + (mine.hp < 3 ? (3 - mine.hp) / 3 * 0.35 * (0.6 + 0.4 * Math.sin(now / 240)) : 0); u.ca.value = 0.0009 + caKick * 0.006; u.vig.value = 0.3 + nf * 0.12; }
  caKick = Math.max(0, caKick - dt * 3); camera.fov += (fovBase - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix();
  renderFrame();
  drawHud(now, nf);
}

// ---------- build view: grid, ghost piece, aim marker ----------
const GR = 9, gridPts = []; for (let i = -GR; i <= GR + 1; i++) { gridPts.push(-GR, 0, i, GR + 1, 0, i, i, 0, -GR, i, 0, GR + 1); }
const gridGeo = new THREE.BufferGeometry(); gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false, fog: false })); grid.visible = false; grid.renderOrder = 3; scene.add(grid);
const cellMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#5cff7a", transparent: true, opacity: 0.35, depthWrite: false })); cellMark.visible = false; cellMark.renderOrder = 4; scene.add(cellMark);
const GOOD = new THREE.MeshBasicMaterial({ color: "#7dffa0", transparent: true, opacity: 0.55, depthWrite: false }), BAD = new THREE.MeshBasicMaterial({ color: "#ff6a6a", transparent: true, opacity: 0.5, depthWrite: false });
function updateBuildView(now) {
  grid.visible = cellMark.visible = hammer && joined && !dead;
  if (!grid.visible) { if (ghost) { scene.remove(ghost); ghost = null; ghostKey = ""; } return; }
  const c = aimCell(), p = PIECES[sel], ok = cellOk(p, c);
  grid.position.set(Math.floor(sm.x), 0.15, Math.floor(sm.y));
  cellMark.position.set(c[0] + 0.5, 0.16, c[1] + 0.5); cellMark.material.color.set(ok ? "#5cff7a" : "#ff5a5a"); cellMark.material.opacity = 0.25 + Math.sin(now / 160) * 0.08;
  if (ghostKey !== String(p.k)) {
    if (ghost) scene.remove(ghost); ghostKey = String(p.k); ghost = null;
    if (p.k >= 0) { ghost = makePiece(p.k); ghost.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.base = o.material; } }); scene.add(ghost); }
  }
  if (ghost) { ghost.position.set(c[0] + 0.5, 0, c[1] + 0.5); ghost.traverse((o) => { if (o.isMesh) o.material = ok ? GOOD : BAD; }); }
}

// ---------- HUD (2D overlay) ----------
function rr(x, y, w, h, r) { hx.beginPath(); hx.moveTo(x + r, y); hx.arcTo(x + w, y, x + w, y + h, r); hx.arcTo(x + w, y + h, x, y + h, r); hx.arcTo(x, y + h, x, y, r); hx.arcTo(x, y, x + w, y, r); hx.closePath(); }
function heart(x, y, s, c) { hx.fillStyle = c; hx.beginPath(); hx.moveTo(x, y + s * .35); hx.bezierCurveTo(x - s, y - s * .4, x - s * .3, y - s, x, y - s * .3); hx.bezierCurveTo(x + s * .3, y - s, x + s, y - s * .4, x, y + s * .35); hx.fill(); }
function mush(x, y, s) { hx.fillStyle = "#f2e6cf"; hx.fillRect(x - s * .25, y, s * .5, s * .5); hx.fillStyle = "#d8384a"; hx.beginPath(); hx.arc(x, y, s * .6, Math.PI, 0); hx.fill(); }
function flame(x, y, s) { hx.fillStyle = "#35b6e8"; hx.beginPath(); hx.moveTo(x, y - s); hx.quadraticCurveTo(x + s * .8, y, x, y + s * .6); hx.quadraticCurveTo(x - s * .8, y, x, y - s); hx.fill(); }
function bolt(x, y, s) { hx.fillStyle = "#a8e860"; hx.beginPath(); hx.moveTo(x + s * .2, y - s); hx.lineTo(x - s * .6, y + s * .1); hx.lineTo(x, y + s * .1); hx.lineTo(x - s * .2, y + s); hx.lineTo(x + s * .6, y - s * .1); hx.lineTo(x, y - s * .1); hx.closePath(); hx.fill(); }
const FONT = "Avenir Next, Futura, Helvetica Neue, system-ui, sans-serif", CREAM = "#f7ecd4";
function drawHud(now, nf) {
  hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, W, H);
  if (flash > 0) { hx.fillStyle = `rgba(220,50,40,${flash * 0.4})`; hx.fillRect(0, 0, W, H); }
  const vg = hx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.65); vg.addColorStop(0, "rgba(10,6,20,0)"); vg.addColorStop(1, "rgba(10,6,20,0.38)"); hx.fillStyle = vg; hx.fillRect(0, 0, W, H);
  const sh = (on) => { hx.shadowColor = on ? "rgba(12,8,20,.7)" : "transparent"; hx.shadowBlur = on ? 4 : 0; hx.shadowOffsetY = on ? 1 : 0; };
  const top = 16, left = 16;
  hx.letterSpacing = "1.5px"; hx.textBaseline = "alphabetic";
  const bar = (y, v, max, col, label) => {
    const fr = Math.max(0, Math.min(1, v / max)), low = fr < 0.25 && Math.floor(now / 300) % 2;
    sh(true); hx.fillStyle = CREAM + "cc"; hx.font = `600 9px ${FONT}`; hx.textAlign = "left"; hx.fillText(label, left, y); sh(false);
    hx.fillStyle = "rgba(247,236,212,.22)"; rr(left, y + 4, 132, 4, 2); hx.fill();
    if (fr > 0.005) { hx.fillStyle = low ? "#fff" : col; rr(left, y + 4, 132 * fr, 4, 2); hx.fill(); }
  };
  bar(top + 6, mine.hp, 10, "#ff7a6a", "HEALTH"); bar(top + 30, mine.st, 100, "#f2dc8a", "STAMINA"); bar(top + 54, mine.hu, 100, "#ffb15c", "FOOD"); bar(top + 78, mine.wa, 100, "#7cc6d8", "WARMTH");
  sh(true); hx.fillStyle = CREAM; hx.font = `700 11px ${FONT}`; hx.textAlign = "left"; hx.fillText(`WOOD ${mine.wood}    STONE ${mine.stone}    KILLS ${mine.kills}`, left, top + 114); sh(false);
  if (hammer) { const p = PIECES[sel], c = aimCell(), ok = cellOk(p, c); hx.textAlign = "center"; hx.font = `700 12px ${FONT}`; sh(true); const t = `BUILD: ${p.n}${p.k >= 0 && !afford(p) ? " (not enough materials)" : !ok ? " (can't go here)" : ""}`; hx.fillStyle = ok ? "#ffe27a" : "#ff9a9a"; hx.fillText(t, W / 2, 28); }
  sh(false);
  const night = snap.tm >= 90; hx.textAlign = "right"; sh(true);
  hx.font = `700 11px ${FONT}`; hx.fillStyle = night ? "#a8b8ff" : "#ffd9a0"; hx.fillText(`${night ? "NIGHT" : "DAY"}  \u00b7  ${snap.n} ONLINE`, W - 16, top + 10);
  hx.font = `500 10px ${FONT}`; hx.fillStyle = CREAM + "b0"; lb.forEach((r, i) => hx.fillText(`${r[0]}   ${r[1]}s   ${r[2]}k`, W - 16, top + 28 + i * 14)); sh(false);
  const mm = 86, r0 = mm / 2, mx = W - mm - 16, my = top + 36 + lb.length * 14, cx = mx + r0, cy = my + r0, mp = (v, n) => v / n * (mm - 10) + 5;
  hx.save(); hx.beginPath(); hx.arc(cx, cy, r0, 0, 7); hx.clip(); hx.fillStyle = "rgba(20,16,34,.5)"; hx.fillRect(mx, my, mm, mm);
  hx.fillStyle = "rgba(120,170,100,.55)"; for (const t of world.trees) hx.fillRect(mx + mp(t[0], world.w) - 0.8, my + mp(t[1], world.h) - 0.8, 1.6, 1.6);
  hx.fillStyle = "#b5bccb"; world.rocks.forEach((t, i) => { if (!felled.has(world.trees.length + i)) hx.fillRect(mx + mp(t[0], world.w) - 1.2, my + mp(t[1], world.h) - 1.2, 2.4, 2.4); });
  hx.fillStyle = "#ffa64a"; for (const f of snap.f) hx.fillRect(mx + mp(f[0], world.w) - 1.5, my + mp(f[1], world.h) - 1.5, 3, 3);
  hx.fillStyle = "#ff5a4a"; for (const g of snap.g) hx.fillRect(mx + mp(g[1], world.w) - 1.5, my + mp(g[2], world.h) - 1.5, 3, 3);
  hx.fillStyle = "#fff"; for (const p of snap.p) if (p[0] !== me) hx.fillRect(mx + mp(p[1], world.w) - 1.5, my + mp(p[2], world.h) - 1.5, 3, 3);
  hx.fillStyle = "#ffd9a0"; hx.beginPath(); hx.arc(mx + mp(sm.x, world.w), my + mp(sm.y, world.h), 2.8, 0, 7); hx.fill(); hx.restore();
  hx.strokeStyle = CREAM + "99"; hx.lineWidth = 1.5; hx.beginPath(); hx.arc(cx, cy, r0, 0, 7); hx.stroke();
  if (stick) { hx.globalAlpha = 0.3; hx.fillStyle = "#fff"; hx.beginPath(); hx.arc(stick.x, stick.y, 50, 0, 7); hx.fill(); hx.globalAlpha = 0.65; const dx = stick.cx - stick.x, dy = stick.cy - stick.y, l = Math.min(50, Math.hypot(dx, dy)), an = Math.atan2(dy, dx); hx.beginPath(); hx.arc(stick.x + Math.cos(an) * l, stick.y + Math.sin(an) * l, 24, 0, 7); hx.fill(); hx.globalAlpha = 1; }
  hx.letterSpacing = "0px";
}
requestAnimationFrame(frame);

for (const ev of ["touchend", "click"]) document.addEventListener(ev, () => A.resume(), { passive: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden) A.resume(); });
