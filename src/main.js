import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ================= endless channel: pure functions of x, valid everywhere =================
function channelCenter(x) { return 7.5 * Math.sin(x * 0.042) + 4.0 * Math.sin(x * 0.017 + 1.3); }
function channelHalf(x) { return 10.5 + 3.5 * Math.sin(x * 0.023 + 0.7); }
function bankHeight(x, z) {
  const d = Math.abs(z - channelCenter(x));
  const edge = Math.max(0, d - channelHalf(x)) / 22;
  return -1.7 + Math.tanh(edge * 1.6) * 3.8 + 0.12 * Math.sin(x * 0.1 + z * 0.07);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOON_DIR = new THREE.Vector3(0.55, 0.42, -0.72).normalize();
const NIGHT = {
  fog: new THREE.Color(0x0a1418), fogDensity: 0.016,
  zenith: new THREE.Color(0x02040a), horizon: new THREE.Color(0x14303e),
  moon: new THREE.Color(0xfff3d8), moonLight: new THREE.Color(0xbfd4ff), moonI: 2.2,
  hemiSky: new THREE.Color(0x33475e), hemiGnd: new THREE.Color(0x0c0f09), hemiI: 1.0,
  deep: new THREE.Color(0x03181c), sky: new THREE.Color(0x1d4256),
  lantern: new THREE.Color(0xffa860), exposure: 1.05,
  lamp: 1, lampGlass: 2.4, flies: true, mist: 0.16, bloom: 0.35, leafEm: 0.70,
};
const EVENING = {
  fog: new THREE.Color(0x3a2530), fogDensity: 0.016,
  zenith: new THREE.Color(0x1a2340), horizon: new THREE.Color(0xc96a35),
  moon: new THREE.Color(0xffe0b0), moonLight: new THREE.Color(0xffc9a0), moonI: 1.5,
  hemiSky: new THREE.Color(0x6a5a70), hemiGnd: new THREE.Color(0x241812), hemiI: 1.0,
  deep: new THREE.Color(0x0d1a1c), sky: new THREE.Color(0x6a4530),
  lantern: new THREE.Color(0xffb060), exposure: 1.15,
  lamp: 1, lampGlass: 1.6, flies: true, mist: 0.18, bloom: 0.30, leafEm: 0.45,
};
const DAY = {
  fog: new THREE.Color(0x9fb8be), fogDensity: 0.0085,
  zenith: new THREE.Color(0x2f6aa0), horizon: new THREE.Color(0xcfd8d4),
  moon: new THREE.Color(0xfff6e0), moonLight: new THREE.Color(0xfff2dd), moonI: 2.6,
  hemiSky: new THREE.Color(0x9db8cc), hemiGnd: new THREE.Color(0x3a4a3a), hemiI: 0.9,
  deep: new THREE.Color(0x0a2a30), sky: new THREE.Color(0x7fa8b8),
  lantern: new THREE.Color(0xffa860), exposure: 0.95,
  lamp: 0, lampGlass: 0.15, flies: false, mist: 0.07, bloom: 0.18, leafEm: 0.12,
};

// ================= renderer / scene =================
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = NIGHT.exposure;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(NIGHT.fog.clone(), NIGHT.fogDensity);
renderer.setClearColor(NIGHT.fog);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 700);

// ================= lights =================
const moonLight = new THREE.DirectionalLight(NIGHT.moonLight, NIGHT.moonI);
moonLight.position.copy(MOON_DIR).multiplyScalar(160);
scene.add(moonLight);
const hemi = new THREE.HemisphereLight(NIGHT.hemiSky, NIGHT.hemiGnd, NIGHT.hemiI);
scene.add(hemi);
const lantern = new THREE.PointLight(NIGHT.lantern, 30, 18, 2.0);
scene.add(lantern);
const stern = new THREE.PointLight(0xffb060, 9, 10, 2.0);
scene.add(stern);

// ================= sky dome =================
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    uTime: { value: 0 },
    uMoonDir: { value: MOON_DIR },
    uZenith: { value: NIGHT.zenith.clone() },
    uHorizon: { value: NIGHT.horizon.clone() },
    uMoonColor: { value: NIGHT.moon.clone() },
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: [
    'uniform float uTime; uniform vec3 uMoonDir, uZenith, uHorizon, uMoonColor; varying vec3 vDir;',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }',
    'float fbm(vec2 p){ return vnoise(p)*0.5+vnoise(p*2.13+7.7)*0.27+vnoise(p*4.31+3.1)*0.15+vnoise(p*8.17+9.2)*0.08; }',
    'void main(){',
    '  vec3 d = normalize(vDir); float h = clamp(d.y,-1.0,1.0);',
    '  vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.0,1.0),0.45));',
    '  if(h<0.0) col = mix(uHorizon, uHorizon*0.3, clamp(-h*3.0,0.0,1.0));',
    '  float mA = dot(d,uMoonDir); float moonGlow = pow(max(mA,0.0),6.0);',
    // cloudy band: projected noise, denser overhead, lit near the moon
    '  vec2 cuv = d.xz/(abs(d.y)+0.28)*0.55 + vec2(uTime*0.004, uTime*0.0015);',
    '  float cl = fbm(cuv*1.5);',
    '  cl = smoothstep(0.34,0.78,cl) * smoothstep(-0.02,0.14,h);',
    '  vec3 cloudCol = mix(uHorizon*0.45+uZenith*0.4, uHorizon*1.35+uMoonColor*0.30, moonGlow);',
    '  cloudCol += uMoonColor * pow(max(mA,0.0),36.0)*0.9;',
    '  col = mix(col, cloudCol, cl*0.9);',
    // stars fade where clouds cover
    '  vec3 pc = floor(d*120.0); vec3 f3 = fract(d*120.0)-0.5;',
    '  vec3 h3 = fract(sin(vec3(dot(pc,vec3(127.1,311.7,74.7)),dot(pc,vec3(269.5,183.3,246.1)),dot(pc,vec3(113.5,271.9,124.6))))*43758.5453);',
    '  float star = smoothstep(0.12,0.0,length(f3-(h3-0.5)*0.6));',
    '  float tw = 0.55+0.45*sin(uTime*(1.0+h3.z*3.0)+h3.x*40.0);',
    '  float mag = pow(h3.y,8.0);',
    '  col += vec3(0.85,0.92,1.0)*star*tw*(0.1+2.0*mag)*smoothstep(0.02,0.15,h)*(1.0-cl);',
    // moon punches through thin cloud, halo always glows
    '  float disk = smoothstep(0.99915,0.99955,mA);',
    '  col += uMoonColor*(disk*(3.2-2.2*cl) + pow(max(mA,0.0),600.0)*0.6 + pow(max(mA,0.0),40.0)*0.10);',
    '  col += (hash(gl_FragCoord.xy*0.7)-0.5)*0.012;',
    '  gl_FragColor = vec4(col,1.0);',
    '}',
  ].join('\n'),
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(430, 32, 20), skyMat);
sky.frustumCulled = false;
scene.add(sky);

// ================= water =================
const waterMat = new THREE.ShaderMaterial({
  fog: false,
  uniforms: {
    uTime: { value: 0 },
    uBoat: { value: new THREE.Vector2(0, 0) },
    uBoatDir: { value: new THREE.Vector2(1, 0) },
    uSpeed: { value: 0.4 },
    uMoonDir: { value: MOON_DIR },
    uFogColor: { value: NIGHT.fog.clone() },
    uFogDensity: { value: NIGHT.fogDensity },
    uDeep: { value: NIGHT.deep.clone() },
    uSky: { value: NIGHT.sky.clone() },
    uLampPos: { value: new THREE.Vector3() },
    uLampLevel: { value: 1 },
    uReflection: { value: null },
    uTextureMatrix: { value: new THREE.Matrix4() },
  },
  vertexShader: 'varying vec3 vW; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }',
  fragmentShader: [
    'uniform float uTime,uSpeed,uFogDensity; uniform vec2 uBoat,uBoatDir; uniform vec3 uLampPos; uniform float uLampLevel;',
    'uniform vec3 uMoonDir,uFogColor,uDeep,uSky; uniform sampler2D uReflection; uniform mat4 uTextureMatrix; varying vec3 vW;',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }',
    'void main(){',
    '  vec2 uv = vW.xz; float t = uTime;',
    '  vec2 warp = vec2(noise(uv*0.045+vec2(0.0,t*0.014)), noise(uv*0.045+vec2(5.2,t*0.011)))-0.5;',
    '  vec2 wuv = uv + warp*22.0;',
    '  float h1 = noise(wuv*0.09+vec2(t*0.030,t*0.016))*0.36+noise(wuv*0.28-vec2(t*0.042,t*0.026))*0.30+noise(wuv*0.80+vec2(-t*0.06,t*0.05))*0.22+noise(wuv*1.9+vec2(t*0.05,-t*0.04))*0.12;',
    '  float hx = noise((wuv+vec2(0.35,0.0))*0.38-t*0.03)-0.5;',
    '  float hz = noise((wuv+vec2(0.0,0.35))*0.38+t*0.025)-0.5;',
    '  vec2 rel = uv-uBoat; float d = length(rel); vec2 rn = rel/max(d,0.001);',
    '  float behind = max(0.0,-dot(rn,uBoatDir));',
    '  float rings = sin(d*5.0-t*3.0)*exp(-d*0.55)*(0.3+0.7*behind);',
    '  vec2 sideV = vec2(-uBoatDir.y, uBoatDir.x);',
    '  float backDist = dot(rel, -uBoatDir);',
    '  float lateral = abs(dot(rel, sideV));',
    '  float trailMask = exp(-max(backDist,0.0)*0.10)*exp(-lateral*lateral/max(1.5+max(backDist,0.0)*0.30,0.001));',
    '  trailMask *= step(0.0, backDist)*step(backDist, 42.0)*uSpeed;',
    '  float churn = 0.5+0.5*sin(max(backDist,0.0)*3.0 - t*5.0 + lateral*2.0);',
    '  vec3 N = normalize(vec3(hx*1.2+rn.x*rings*0.4*uSpeed+sideV.x*churn*trailMask*0.35, 1.0, hz*1.2+rn.y*rings*0.4*uSpeed+sideV.y*churn*trailMask*0.35));',
    '  vec4 rp = uTextureMatrix * vec4(vW, 1.0);',
    '  vec2 ruv = clamp(rp.xy / max(rp.w, 0.001) + N.xz * 0.085, 0.001, 0.999);',
    '  vec3 refl = texture2D(uReflection, ruv).rgb;',
    '  vec3 V = normalize(cameraPosition-vW);',
    '  float fres = pow(1.0-max(dot(V,N),0.0),3.0);',
    '  float F = clamp(0.30+0.70*fres, 0.0, 1.0);',
    '  vec3 col = mix(uDeep*(0.75+0.35*h1), refl*0.92, F);',
    '  vec3 R = reflect(-V,N);',
    '  float m = max(dot(R,uMoonDir),0.0);',
    '  col += vec3(1.0,0.93,0.78)*(pow(m,800.0)*3.0+pow(m,80.0)*0.25+pow(m,10.0)*0.03);',
    '  vec3 Ld = uLampPos-vW; float ldist = length(Ld); Ld /= max(ldist,0.001);',
    '  float latt = uLampLevel/(1.0+ldist*ldist*0.02);',
    '  float ls = max(dot(R,Ld),0.0);',
    '  col += vec3(1.0,0.87,0.64)*(pow(ls,500.0)*2.5+pow(ls,60.0)*0.25)*latt;',
    '  col += vec3(0.35,0.28,0.18)*max(dot(N,Ld),0.0)*latt*0.35;',
    '  col += vec3(0.10,0.16,0.14)*max(rings,0.0)*uSpeed;',
    '  col += vec3(0.17,0.25,0.22)*trailMask*(0.30+0.70*churn);',
    '  float bowD = length(uv-(uBoat+uBoatDir*2.6));',
    '  col += vec3(0.12,0.17,0.15)*exp(-bowD*1.4)*uSpeed;',
    '  for (int i = 0; i < 5; i++) {',
    '    float fi = float(i);',
    '    vec2 fp = uBoat + vec2(10.0+fi*8.0+sin(t*0.10+fi*2.1)*26.0, cos(t*0.083+fi*1.7)*8.0);',
    '    vec2 fd = (uv-fp)*vec2(0.8,1.9);',
    '    col *= 1.0 - smoothstep(0.70,0.35,length(fd))*0.55;',
    '  }',
    '  float dist = distance(cameraPosition,vW);',
    '  float f = 1.0-exp(-uFogDensity*uFogDensity*dist*dist);',
    '  col = mix(col,uFogColor,f);',
    '  col += (hash(gl_FragCoord.xy*0.7)-0.5)*0.012;',
    '  gl_FragColor = vec4(col,1.0);',
    '}',
  ].join('\n'),
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(360, 200), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.02;
scene.add(water);

// true planar reflection (three.js Water recipe): mirrored camera + clip plane
const WY = 0.02;
const reflectionRT = new THREE.WebGLRenderTarget(640, 360, { type: THREE.HalfFloatType });
const reflectionCamera = new THREE.PerspectiveCamera();
const reflTextureMatrix = new THREE.Matrix4();
const reflClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WY + 0.03);
const reflTarget = new THREE.Vector3();
waterMat.uniforms.uReflection.value = reflectionRT.texture;
waterMat.uniforms.uTextureMatrix.value = reflTextureMatrix;
function updateReflection() {
  camera.getWorldDirection(reflTarget);
  const tx = camera.position.x + reflTarget.x * 20;
  const ty = camera.position.y + reflTarget.y * 20;
  const tz = camera.position.z + reflTarget.z * 20;
  reflectionCamera.position.set(camera.position.x, 2 * WY - camera.position.y, camera.position.z);
  reflectionCamera.up.set(0, -1, 0);
  reflectionCamera.lookAt(tx, 2 * WY - ty, tz);
  reflectionCamera.updateMatrixWorld();
  reflectionCamera.projectionMatrix.copy(camera.projectionMatrix);
  reflTextureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  reflTextureMatrix.multiply(reflectionCamera.projectionMatrix);
  reflTextureMatrix.multiply(reflectionCamera.matrixWorldInverse);
  const hidden = [water, flies, gnats, ...mists, ...dragonflies.map((d) => d.node)];
  for (const o of hidden) o.visible = false;
  renderer.clippingPlanes = [reflClip];
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(reflectionRT);
  renderer.clear();
  renderer.render(scene, reflectionCamera);
  renderer.setRenderTarget(prevRT);
  renderer.clippingPlanes = [];
  for (const o of hidden) o.visible = true;
}

// ================= procedural cypress: trunk + branches + leaf cards =================
function makeLeafTexture() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  const rng = mulberry32(1234);
  for (let i = 0; i < 90; i++) {
    const x = 10 + rng() * (s - 20), y = 10 + rng() * (s - 20);
    const rx = 4 + rng() * 9, ry = 3 + rng() * 6, a = rng() * Math.PI;
    const g = 40 + Math.floor(rng() * 50);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(' + (20 + Math.floor(rng() * 20)) + ',' + g + ',' + (22 + Math.floor(rng() * 16)) + ',0.95)';
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const leafTex = makeLeafTexture();
const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({
  map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide,
  vertexColors: true, roughness: 1, emissive: 0x0a120c, emissiveIntensity: 0.55,
});
function makeMossTexture() {
  const w = 64, h = 128, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, w, h);
  const rng = mulberry32(555);
  for (let i = 0; i < 46; i++) {
    const x = rng() * w, len = h * (0.4 + rng() * 0.6), wd = 1 + rng() * 2.5;
    const tone = 85 + Math.floor(rng() * 55);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(' + (tone - 25) + ',' + tone + ',' + (tone - 45) + ',0.9)');
    g.addColorStop(1, 'rgba(' + (tone - 25) + ',' + tone + ',' + (tone - 45) + ',0)');
    ctx.strokeStyle = g; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 10, len * 0.5, x + (rng() - 0.5) * 16, len); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const mossMat = new THREE.MeshStandardMaterial({
  map: makeMossTexture(), alphaTest: 0.22, side: THREE.DoubleSide,
  roughness: 1, emissive: 0x11150c, emissiveIntensity: 0.5,
});
const bloomMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.8, emissive: 0x1a0f14, emissiveIntensity: 0.5,
});
const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
const lilyMat = new THREE.MeshStandardMaterial({ color: 0x1d3327, roughness: 0.9 });

function paint(geo, hex, jitter, rng) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (rng() - 0.5) * jitter;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function darken(geo, f) {
  const a = geo.attributes.color;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * f, a.getY(i) * f, a.getZ(i) * f);
  return geo;
}
const UP = new THREE.Vector3(0, 1, 0);

// Builds one tree in local coords (base at origin). Returns {wood[], leaves[]}.
function buildTree(rng) {
  const wood = [], leaves = [];
  const s = 0.9 + rng() * 0.9;
  const h = (7 + rng() * 4) * s;
  const trunk = new THREE.CylinderGeometry(0.30 * s, 0.85 * s, h, 7);
  trunk.translate(0, h / 2, 0);
  paint(trunk, 0x2e2318, 0.35, rng); wood.push(trunk);
  const flare = new THREE.ConeGeometry(1.25 * s, 2.4 * s, 7);
  flare.translate(0, 1.1 * s, 0);
  paint(flare, 0x241b12, 0.35, rng); wood.push(flare);
  const anchors = [];
  const nb = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < nb; i++) {
    const az = (i / nb) * Math.PI * 2 + rng() * 0.8;
    const tilt = 0.55 + rng() * 0.55;
    const len = (2.6 + rng() * 2.2) * s;
    const dir = new THREE.Vector3(Math.cos(az) * tilt, 1, Math.sin(az) * tilt).normalize();
    const base = new THREE.Vector3(Math.cos(az) * 0.3 * s, h * (0.55 + rng() * 0.35), Math.sin(az) * 0.3 * s);
    const g = new THREE.CylinderGeometry(0.05 * s, 0.15 * s, len, 5);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    g.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
    paint(g, 0x2a2016, 0.35, rng); wood.push(g);
    anchors.push(base.clone().addScaledVector(dir, len));
    // short twig continuing outward for canopy depth
    const twigLen = len * 0.45;
    const tg = new THREE.CylinderGeometry(0.02 * s, 0.05 * s, twigLen, 4);
    tg.translate(0, twigLen / 2, 0);
    const td = dir.clone(); td.y += 0.35; td.normalize();
    const tq = new THREE.Quaternion().setFromUnitVectors(UP, td);
    const tip = base.clone().addScaledVector(dir, len);
    tg.applyMatrix4(new THREE.Matrix4().compose(tip, tq, new THREE.Vector3(1, 1, 1)));
    paint(tg, 0x2a2016, 0.3, rng); wood.push(tg);
    anchors.push(tip.addScaledVector(td, twigLen));
  }
  anchors.push(new THREE.Vector3(0, h * 1.02, 0));
  anchors.push(new THREE.Vector3(0.6 * s, h * 0.92, 0.3 * s));
  for (const a of anchors) {
    const w = (2.4 + rng() * 2.2) * s, hh = (1.6 + rng() * 1.4) * s;
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(w, hh);
      p.rotateY(k * Math.PI / 2 + rng() * 0.6);
      p.translate(a.x + (rng() - 0.5), a.y + (rng() - 0.5) * 0.6, a.z + (rng() - 0.5));
      paint(p, 0x243a26, 0.55, rng); leaves.push(p);
    }
  }
  return { wood, leaves, anchors };
}

function buildGatorFallback() {
  const grp = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x27331f, roughness: 0.85 });
  const parts = [];
  const body = new THREE.CapsuleGeometry(0.34, 1.5, 4, 8);
  body.rotateZ(Math.PI / 2); body.scale(1, 0.72, 1);
  parts.push(body);
  const snout = new THREE.BoxGeometry(0.75, 0.2, 0.36);
  snout.translate(1.15, 0.02, 0); parts.push(snout);
  for (const lp of [[0.5, 0.35], [0.5, -0.35], [-0.5, 0.38], [-0.5, -0.38]]) {
    const leg = new THREE.CylinderGeometry(0.09, 0.11, 0.32, 5);
    leg.translate(lp[0], -0.22, lp[1]); parts.push(leg);
  }
  grp.add(new THREE.Mesh(mergeGeometries(parts, false), skinMat));
  const tailGeo = new THREE.ConeGeometry(0.3, 1.9, 6);
  tailGeo.rotateZ(Math.PI / 2); tailGeo.scale(1, 0.6, 1); tailGeo.translate(-0.95, 0, 0);
  const tailPivot = new THREE.Group(); tailPivot.position.set(-0.85, 0, 0);
  tailPivot.add(new THREE.Mesh(tailGeo, skinMat)); grp.add(tailPivot);
  const eyeGeo = [];
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.055, 6, 5);
    e.translate(0.85, 0.26, s * 0.16); eyeGeo.push(e);
  }
  grp.add(new THREE.Mesh(mergeGeometries(eyeGeo, false),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xc8d84a, emissiveIntensity: 1.2 })));
  grp.userData.tail = tailPivot;
  return grp;
}

// Blender-built gator when available, procedural fallback otherwise
let gatorAssets = null;
try {
  const gltf = await new GLTFLoader().loadAsync('models/gator.glb');
  const gb = gltf.scene.getObjectByName('GatorBody');
  const gt = gltf.scene.getObjectByName('GatorTail');
  if (gb && gt) gatorAssets = { body: gb, tail: gt, eyes: gltf.scene.getObjectByName('GatorEyes') };
} catch (err) { /* use procedural fallback */ }
function buildGator() {
  if (gatorAssets) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(gatorAssets.body.geometry, gatorAssets.body.material));
    const tailPivot = new THREE.Group();
    tailPivot.position.copy(gatorAssets.tail.position);
    tailPivot.add(new THREE.Mesh(gatorAssets.tail.geometry, gatorAssets.tail.material));
    grp.add(tailPivot);
    if (gatorAssets.eyes) grp.add(new THREE.Mesh(gatorAssets.eyes.geometry, gatorAssets.eyes.material));
    grp.userData.tail = tailPivot;
    return grp;
  }
  return buildGatorFallback();
}

// ================= endless segments: ground + forest baked per chunk =================
const SEG = 60, SEG_W = 220, RADIUS = 6;
const segQueue = [];
const segCache = new Map();
function buildSegment(idx) {
  const rng = mulberry32((idx * 2654435761) ^ 0x9e3779b9);
  const cx = idx * SEG + SEG / 2;
  const grp = new THREE.Group();
  // ground
  const gg = new THREE.PlaneGeometry(SEG + 10, SEG_W, 36, 22);
  gg.rotateX(-Math.PI / 2);
  gg.translate(cx, 0, 0);
  const gp = gg.attributes.position;
  const gc = new Float32Array(gp.count * 3);
  const cA = new THREE.Color(0x131a12), cB = new THREE.Color(0x2a3324), cW = new THREE.Color(0x0a1214);
  const tc = new THREE.Color();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, bankHeight(x, z));
    const wet = THREE.MathUtils.clamp(1 - Math.abs(Math.abs(z - channelCenter(x)) - channelHalf(x)) / 8, 0, 1);
    tc.copy(cA).lerp(cB, rng() * 0.55).lerp(cW, wet * 0.7);
    gc[i * 3] = tc.r; gc[i * 3 + 1] = tc.g; gc[i * 3 + 2] = tc.b;
  }
  gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  gg.computeVertexNormals();
  grp.add(new THREE.Mesh(gg, groundMat));
  // forest: dense front wall + darker back row so banks are never bare
  const woodGeos = [], leafGeos = [], mossGeos = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const PV = new THREE.Vector3(), SV = new THREE.Vector3();
  function plantTree(x, z, dim) {
    if (Math.hypot(x + 60, z - channelCenter(-60)) < 11) return; // keep spawn view open
    const y = bankHeight(x, z) - 0.2;
    E.set(0, rng() * Math.PI * 2, 0); Q.setFromEuler(E);
    const sc = 0.85 + rng() * 0.8;
    M.compose(PV.set(x, y, z), Q, SV.set(sc, sc, sc));
    const t = buildTree(rng);
    for (const g of t.wood) { const c = g.clone(); c.applyMatrix4(M); if (dim) darken(c, 0.55); woodGeos.push(c); }
    for (const g of t.leaves) { const c = g.clone(); c.applyMatrix4(M); if (dim) darken(c, 0.55); leafGeos.push(c); }
    // spanish moss hanging from branch tips
    const nm = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < nm; i++) {
      const a = t.anchors[Math.floor(rng() * t.anchors.length)].clone().applyMatrix4(M);
      const mw = (0.5 + rng() * 0.5) * sc, mh = (2.0 + rng() * 1.8) * sc;
      const mg = new THREE.PlaneGeometry(mw, mh);
      mg.rotateY(rng() * Math.PI);
      mg.translate(a.x, a.y - mh / 2 + 0.2, a.z);
      mossGeos.push(mg);
    }
  }
  const nFront = 26 + Math.floor(rng() * 8);
  for (let i = 0; i < nFront; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const lean = rng() < 0.2 ? -1.5 : 0; // a few trees lean over the water
    plantTree(x, channelCenter(x) + side * (channelHalf(x) + 3 + lean + rng() * 10), false);
  }
  const nMid = 16 + Math.floor(rng() * 7);
  for (let i = 0; i < nMid; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    plantTree(x, channelCenter(x) + side * (channelHalf(x) + 10 + rng() * 12), rng() < 0.5);
  }
  const nBack = 12 + Math.floor(rng() * 6);
  for (let i = 0; i < nBack; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    plantTree(x, channelCenter(x) + side * (channelHalf(x) + 22 + rng() * 20), true);
  }
  // gap-filler canopy: wide mid-distance masses closing sightlines between trunks
  for (let i = 0; i < 20; i++) {
    const x = cx + (rng() - 0.5) * (SEG + 10);
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + 13 + rng() * 20);
    const y = bankHeight(x, z);
    const w = 6 + rng() * 5, hh = 4 + rng() * 3;
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(w, hh);
      p.rotateY(k * Math.PI / 2 + rng() * 0.5);
      p.translate(x, y + 7 + rng() * 4, z);
      paint(p, 0x1c2f22, 0.45, rng); leafGeos.push(darken(p, 0.8));
    }
  }
  // far treeline wall: big dark masses so you never see through in evening
  for (let i = 0; i < 32; i++) {
    const x = cx + (rng() - 0.5) * (SEG + 10);
    const side = i % 2 === 0 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + 40 + rng() * 30);
    const y = bankHeight(x, z);
    const trunk = new THREE.CylinderGeometry(0.5, 0.9, 15, 5);
    trunk.translate(x, y + 6, z);
    paint(trunk, 0x1c150e, 0.3, rng); woodGeos.push(darken(trunk, 0.6));
    const w = 9 + rng() * 6, hh = 5.5 + rng() * 3;
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(w, hh);
      p.rotateY(k * Math.PI / 2 + rng() * 0.5);
      p.translate(x, y + 13 + rng() * 4, z);
      paint(p, 0x1a2a1e, 0.4, rng); leafGeos.push(darken(p, 0.6));
    }
  }
  // bushes: low wide leaf clusters filling gaps between trunks
  for (let i = 0; i < 80; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + rng() * 14);
    const y = bankHeight(x, z);
    const w = 1.4 + rng() * 1.6, hh = 0.9 + rng() * 0.9;
    for (let k = 0; k < 3; k++) {
      const p = new THREE.PlaneGeometry(w, hh);
      p.rotateY((k / 3) * Math.PI + rng() * 0.5);
      p.translate(x, y + hh * 0.4, z);
      paint(p, rng() < 0.5 ? 0x1e3020 : 0x243a24, 0.5, rng); leafGeos.push(p);
    }
  }
  // palmetto fans: arching fronds, distinctive swamp silhouette
  for (let i = 0; i < 28; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + rng() * 9);
    const y = bankHeight(x, z);
    const fr = 6 + Math.floor(rng() * 3);
    for (let k = 0; k < fr; k++) {
      const p = new THREE.PlaneGeometry(0.4, 1.5 + rng() * 0.9);
      p.translate(0, 0.75, 0);
      p.rotateX(-0.45 - rng() * 0.55);
      p.rotateY((k / fr) * Math.PI * 2 + rng() * 0.5);
      p.translate(x, y + 0.15, z);
      paint(p, 0x2a4428, 0.5, rng); leafGeos.push(p);
    }
  }
  // forest floor: fallen logs, saplings, deep ferns and bushes so it is never barren
  for (let i = 0; i < 8; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + 2 + rng() * 18);
    const y = bankHeight(x, z);
    const len = 3 + rng() * 3, rad = 0.22 + rng() * 0.18;
    const log = new THREE.CylinderGeometry(rad, rad * 1.15, len, 7);
    log.rotateZ(Math.PI / 2);
    log.rotateY(rng() * Math.PI);
    log.translate(x, y + rad * 0.8, z);
    paint(log, 0x241a10, 0.35, rng); woodGeos.push(log);
  }
  for (let i = 0; i < 18; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + 1 + rng() * 17);
    const y = bankHeight(x, z);
    const sh = 1.4 + rng() * 1.2;
    const trunk = new THREE.CylinderGeometry(0.05, 0.09, sh, 5);
    trunk.translate(x, y + sh / 2, z);
    paint(trunk, 0x2a2016, 0.3, rng); woodGeos.push(trunk);
    const cw = 1.0 + rng() * 0.8;
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(cw, cw * 0.8);
      p.rotateY(k * Math.PI / 2 + rng() * 0.5);
      p.translate(x, y + sh + cw * 0.2, z);
      paint(p, 0x243a26, 0.5, rng); leafGeos.push(p);
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + 4 + rng() * 12);
    const y = bankHeight(x, z);
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(0.9, 0.8);
      p.rotateY(k * Math.PI / 2 + rng() * 0.5);
      p.translate(x, y + 0.4, z);
      paint(p, 0x223626, 0.5, rng); leafGeos.push(p);
    }
  }
  for (let i = 0; i < 20; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) + 10 + rng() * 14);
    const y = bankHeight(x, z);
    for (let k = 0; k < 3; k++) {
      const p = new THREE.PlaneGeometry(1.5 + rng(), 1.0 + rng() * 0.6);
      p.rotateY((k / 3) * Math.PI + rng() * 0.5);
      p.translate(x, y + 0.5, z);
      paint(p, 0x1e2f20, 0.5, rng); leafGeos.push(p);
    }
  }
  // grass tufts on the banks
  for (let i = 0; i < 40; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) - 1 + rng() * 8);
    const g = new THREE.ConeGeometry(0.10, 0.5 + rng() * 0.5, 4);
    g.translate(x, Math.max(bankHeight(x, z), -0.2) + 0.3, z);
    paint(g, 0x2c3d24, 0.45, rng); woodGeos.push(g);
  }
  // ferns at the waterline
  for (let i = 0; i < 90; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) - 1 + rng() * 3);
    for (let k = 0; k < 2; k++) {
      const p = new THREE.PlaneGeometry(0.8, 0.7);
      p.rotateY(k * Math.PI / 2 + rng() * 0.5);
      p.translate(x, 0.35, z);
      paint(p, 0x24382a, 0.5, rng); leafGeos.push(p);
    }
  }
  // knees + reeds at the waterline
  for (let i = 0; i < 24; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) - 2 + rng() * 5);
    const k = 0.6 + rng();
    const g = new THREE.ConeGeometry(0.28 * k, 1.4 * k, 5);
    g.translate(x, Math.max(bankHeight(x, z), -0.4) + 0.5 * k, z);
    paint(g, 0x201812, 0.3, rng); woodGeos.push(g);
  }
  for (let i = 0; i < 80; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const side = rng() > 0.5 ? 1 : -1;
    const z = channelCenter(x) + side * (channelHalf(x) - 1 + rng() * 2.5);
    const g = new THREE.ConeGeometry(0.06, 1.4 + rng() * 0.8, 4);
    g.translate(x, 0.7, z);
    paint(g, 0x2c3a26, 0.4, rng); woodGeos.push(g);
  }
  if (woodGeos.length) grp.add(new THREE.Mesh(mergeGeometries(woodGeos, false), woodMat));
  if (leafGeos.length) grp.add(new THREE.Mesh(mergeGeometries(leafGeos, false), leafMat));
  if (mossGeos.length) grp.add(new THREE.Mesh(mergeGeometries(mossGeos, false), mossMat));
  // lily pads + lotus blossoms on the water
  const padGeos = [], bloomGeos = [];
  for (let i = 0; i < 60; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const z = channelCenter(x) + (rng() * 2 - 1) * channelHalf(x) * 0.85;
    const g = new THREE.CircleGeometry(0.3 + rng() * 0.35, 9);
    g.rotateX(-Math.PI / 2);
    g.rotateY(rng() * Math.PI * 2);
    g.translate(x, 0.055, z);
    padGeos.push(g);
  }
  for (let i = 0; i < 14; i++) {
    const x = cx + (rng() - 0.5) * SEG;
    const z = channelCenter(x) + (rng() * 2 - 1) * channelHalf(x) * 0.7;
    const bud = new THREE.CircleGeometry(0.5 + rng() * 0.3, 9);
    bud.rotateX(-Math.PI / 2); bud.rotateY(rng() * Math.PI * 2); bud.translate(x, 0.06, z);
    padGeos.push(bud);
    // blossom: ring of petals + yellow heart
    const np = 7 + Math.floor(rng() * 3);
    for (let k = 0; k < np; k++) {
      const a = (k / np) * Math.PI * 2 + rng() * 0.4;
      const petal = new THREE.SphereGeometry(0.11, 6, 4);
      petal.scale(1, 0.45, 0.6);
      petal.rotateX(-0.55);
      petal.rotateY(-a);
      petal.translate(x + Math.cos(a) * 0.14, 0.16, z + Math.sin(a) * 0.14);
      paint(petal, 0xd9a8bc, 0.35, rng); bloomGeos.push(petal);
    }
    const heart = new THREE.SphereGeometry(0.08, 6, 5);
    heart.translate(x, 0.15, z);
    paint(heart, 0xe8c840, 0.25, rng); bloomGeos.push(heart);
  }
  if (padGeos.length) grp.add(new THREE.Mesh(mergeGeometries(padGeos, false), lilyMat));
  if (bloomGeos.length) grp.add(new THREE.Mesh(mergeGeometries(bloomGeos, false), bloomMat));
  grp.userData.gators = [];
  const nGators = 1 + (rng() < 0.5 ? 1 : 0);
  for (let gi = 0; gi < nGators; gi++) {
    const gx = cx + (rng() - 0.5) * SEG;
    const gside = rng() > 0.5 ? 1 : -1;
    const bask = rng() < 0.45;
    const gz = bask
      ? channelCenter(gx) + gside * (channelHalf(gx) - 0.5 + rng() * 2.5)
      : channelCenter(gx) + gside * (channelHalf(gx) - 2.5 - rng() * 2);
    const gator = buildGator();
    const gy = bask ? Math.max(bankHeight(gx, gz), 0.05) + 0.18 : 0.02;
    gator.position.set(gx, gy, gz);
    gator.rotation.y = rng() * Math.PI * 2;
    grp.add(gator);
    grp.userData.gators.push({ node: gator, t: rng() * 10, sub: 0, baseY: gy });
  }
  grp.userData.idx = idx;
  scene.add(grp);
  segCache.set(idx, grp);
}
function updateSegments(boatX) {
  const cur = Math.floor(boatX / SEG);
  for (let i = cur - RADIUS; i <= cur + RADIUS; i++) {
    if (!segCache.has(i) && !segQueue.includes(i)) segQueue.push(i);
  }
  // build nearest-first, max 2 per frame: no travel hitches, no visible edge
  segQueue.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
  let budget = 2;
  while (budget-- > 0 && segQueue.length) {
    const i = segQueue.shift();
    if (i < cur - RADIUS - 1 || i > cur + RADIUS + 1) continue;
    if (!segCache.has(i)) buildSegment(i);
  }
  for (const [k, g] of segCache) {
    if (k < cur - RADIUS - 1 || k > cur + RADIUS + 1) {
      scene.remove(g);
      g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      segCache.delete(k);
    }
  }
}

// ================= boat: cabin cruiser "86" =================
function numberPlate(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ddd6c4'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#22242a'; ctx.font = 'bold 92px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 70);
  ctx.fillStyle = 'rgba(60,50,40,0.25)';
  for (let i = 0; i < 300; i++) ctx.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const dynMats = {};
const boat = new THREE.Group();
{
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2e4a48, roughness: 0.65, metalness: 0.15 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xcfc6ae, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffb45e, emissiveIntensity: 1.4 });
  dynMats.glass = glassMat;
  const hullGeo = new THREE.BoxGeometry(5.2, 1.0, 2.1, 6, 1, 2);
  const p = hullGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const taper = x > 0 ? THREE.MathUtils.lerp(1, 0.35, Math.max(0, x - 0.6) / 2.0) : THREE.MathUtils.lerp(1, 0.75, Math.max(0, -x - 0.6) / 2.0);
    p.setZ(i, p.getZ(i) * taper);
    if (p.getY(i) > 0) p.setY(i, p.getY(i) + Math.abs(x) * 0.10);
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, hullMat); hull.position.y = 0.1; boat.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 1.7), creamMat);
  deck.position.set(-0.2, 0.62, 0); boat.add(deck);
  // wheelhouse
  const house = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.25, 1.5), creamMat);
  house.position.set(-1.1, 1.25, 0); boat.add(house);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.8), creamMat);
  roof.position.set(-1.1, 1.95, 0); boat.add(roof);
  // roof grab rails like the mockup workboat
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 5), darkMat);
      post.position.set(-1.9 + i * 0.55, 2.16, s * 0.82); boat.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 5), darkMat);
    rail.rotation.z = Math.PI / 2; rail.position.set(-1.1, 2.32, s * 0.82); boat.add(rail);
  }
  // foredeck hatch + coiled rope
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.8), creamMat);
  hatch.position.set(0.9, 0.72, 0); boat.add(hatch);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.085, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a764f, roughness: 1 }));
  rope.rotation.x = Math.PI / 2; rope.position.set(-0.1, 0.70, 0.45); boat.add(rope);
  // rub strake proud of the hull sides
  for (const s of [-1, 1]) {
    const strake = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.06), darkMat);
    strake.position.set(-0.5, 0.28, s * 1.0); boat.add(strake);
  }
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.5), glassMat);
  windshield.position.set(-0.24, 1.45, 0); windshield.rotation.y = Math.PI / 2; boat.add(windshield);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.45), glassMat);
    win.position.set(-1.1, 1.45, s * 0.76); if (s < 0) win.rotation.y = Math.PI; boat.add(win);
  }
  // dark trim frames behind the glowing windows
  const shieldTrim = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), darkMat);
  shieldTrim.position.set(-0.245, 1.45, 0); shieldTrim.rotation.y = Math.PI / 2; boat.add(shieldTrim);
  for (const s of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), darkMat);
    trim.position.set(-1.1, 1.45, s * 0.755); if (s < 0) trim.rotation.y = Math.PI; boat.add(trim);
  }
  const rearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.45), glassMat);
  rearWin.position.set(-1.96, 1.45, 0); rearWin.rotation.y = -Math.PI / 2; boat.add(rearWin);
  // bow railing
  const railMat = darkMat;
  for (let i = 0; i < 5; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), railMat);
    const px = 0.4 + i * 0.45, taper = Math.max(0.3, 1 - Math.max(0, px - 0.6) / 2.0);
    post.position.set(px, 0.95, 0.78 * taper); boat.add(post);
    const post2 = post.clone(); post2.position.z *= -1; boat.add(post2);
  }
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5), railMat);
    rail.rotation.z = Math.PI / 2; rail.position.set(1.3, 1.3, s * 0.62); boat.add(rail);
  }
  // outboard motor
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), darkMat);
  motor.position.set(-2.75, 0.3, 0); boat.add(motor);
  // life ring
  // life ring: alternating orange/white segments like the mockup
  const ringOrange = new THREE.MeshStandardMaterial({ color: 0xc85428, roughness: 0.8 });
  const ringWhite = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 });
  for (let k = 0; k < 4; k++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 10, Math.PI / 2), k % 2 ? ringWhite : ringOrange);
    arc.position.set(-1.1, 1.2, 0.78);
    arc.rotation.z = k * Math.PI / 2;
    boat.add(arc);
  }
  // "86" plates
  const plate = numberPlate('18');
  const plateMat = new THREE.MeshStandardMaterial({ map: plate, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), plateMat);
    pl.position.set(-1.6, 0.15, s * 1.03); if (s < 0) pl.rotation.y = Math.PI; boat.add(pl);
  }
  // bow lamp post
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), darkMat);
  pole.position.set(1.9, 1.1, 0); boat.add(pole);
  const lampGlassMat = new THREE.MeshStandardMaterial({ color: 0x664411, emissive: 0xff9a40, emissiveIntensity: 2.4 });
  dynMats.lampGlass = lampGlassMat;
  const lampGlass = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), lampGlassMat);
  lampGlass.position.set(1.9, 1.8, 0); boat.add(lampGlass);
  const lampCap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 8), darkMat);
  lampCap.position.set(1.9, 1.98, 0); boat.add(lampCap);
  // headlight: spotlight + visible beam cone for night/evening
  const headSpot = new THREE.SpotLight(0xffe6b8, 750, 110, 0.8, 0.5, 1.8);
  headSpot.position.set(1.9, 1.85, 0);
  boat.add(headSpot);
  headSpot.target.position.set(26, -4, 0);
  boat.add(headSpot.target);
  dynMats.headSpot = headSpot;
}
scene.add(boat);

// ================= fireflies =================
const FLIES = 240;
const flyGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(FLIES * 3), sd = new Float32Array(FLIES * 4);
  const rng = mulberry32(99);
  for (let i = 0; i < FLIES; i++) {
    sd[i * 4] = (rng() - 0.5) * 180; sd[i * 4 + 1] = (rng() - 0.5) * 30;
    sd[i * 4 + 2] = rng() * 100; sd[i * 4 + 3] = 0.4 + rng() * 0.6;
  }
  flyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  flyGeo.setAttribute('seed', new THREE.BufferAttribute(sd, 4));
}
const flyMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: [
    'uniform float uTime; attribute vec4 seed; varying float vA;',
    'void main(){ float t=uTime*0.25*seed.w+seed.z;',
    '  vec3 p=vec3(seed.x+sin(t+seed.z)*4.0, 0.6+abs(sin(seed.z*1.7))*3.0+sin(t*1.5)*0.5, seed.y+cos(t*0.8)*4.0);',
    '  vA=0.25+0.75*pow(0.5+0.5*sin(uTime*seed.w*2.5+seed.z*80.0),3.0);',
    '  vec4 mv=modelViewMatrix*vec4(p,1.0); float d=max(0.1,-mv.z);',
    '  vA*=smoothstep(70.0,10.0,d); gl_PointSize=(2.0+seed.w*3.0)*60.0/d;',
    '  gl_Position=projectionMatrix*mv; }',
  ].join('\n'),
  fragmentShader: [
    'varying float vA; void main(){ float g=pow(smoothstep(0.5,0.0,length(gl_PointCoord-0.5)),2.0);',
    '  gl_FragColor=vec4(vec3(1.0,0.85,0.45)*g*vA, g*vA); }',
  ].join('\n'),
});
const flies = new THREE.Points(flyGeo, flyMat);
flies.frustumCulled = false;
scene.add(flies);

// dragonflies: small hunters with veined wings patrolling around the boat
function makeWingTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(200,215,220,0.85)';
  ctx.strokeStyle = 'rgba(120,140,150,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(4, 32);
  ctx.quadraticCurveTo(40, 2, 118, 22); ctx.quadraticCurveTo(122, 32, 118, 42);
  ctx.quadraticCurveTo(40, 62, 4, 32); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(6 + i * 18, 30);
    ctx.quadraticCurveTo(10 + i * 18, 32, 8 + i * 19, i % 2 ? 50 : 14); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const dragonflies = [];
{
  const bodyParts = [];
  const torso = new THREE.BoxGeometry(0.045, 0.045, 0.30);
  bodyParts.push(torso);
  const head = new THREE.SphereGeometry(0.035, 6, 5);
  head.translate(0, 0.01, 0.17); bodyParts.push(head);
  const bodyG = mergeGeometries(bodyParts.map((g) => paint(g, 0x16272c, 0.2, mulberry32(11))), false);
  const bodyM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const wingR = new THREE.PlaneGeometry(0.30, 0.15);
  wingR.rotateX(-Math.PI / 2); wingR.translate(0.17, 0.02, 0);
  const wingL = wingR.clone(); wingL.rotateY(Math.PI);
  const wingsG = mergeGeometries([wingR, wingL], false);
  const wingsM = new THREE.MeshBasicMaterial({
    map: makeWingTexture(), transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false, color: 0x8a9aa2,
  });
  const drng = mulberry32(21);
  for (let i = 0; i < 10; i++) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(bodyG, bodyM));
    const wings = new THREE.Mesh(wingsG, wingsM);
    grp.add(wings);
    scene.add(grp);
    dragonflies.push({ node: grp, wings, seed: drng() * 100, r: 2 + drng() * 4.5, h: 0.5 + drng() * 1.5, sp: 0.5 + drng() * 0.8 });
  }
}

// gnat swarm hovering around the bow lamp at night
function makeDotTexture() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
const GNATS = 50;
const gnatGeo = new THREE.BufferGeometry();
const gnatPos = new Float32Array(GNATS * 3);
gnatGeo.setAttribute('position', new THREE.BufferAttribute(gnatPos, 3));
const gnats = new THREE.Points(gnatGeo, new THREE.PointsMaterial({
  color: 0xffd9a0, size: 0.05, map: makeDotTexture(), transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
gnats.frustumCulled = false;
scene.add(gnats);
const gnatSeeds = [];
{ const r = mulberry32(31); for (let i = 0; i < GNATS; i++) gnatSeeds.push([r() * 6.28, 0.3 + r() * 1.2, 0.5 + r() * 1.5, r() * 6.28]); }

// herons/egrets gliding high ahead of the boat
const birds = [];
{
  const bodyG = new THREE.BoxGeometry(0.12, 0.12, 0.9);
  paint(bodyG, 0x22282c, 0.2, mulberry32(41));
  const wingG = new THREE.PlaneGeometry(1.5, 0.42);
  wingG.rotateX(-Math.PI / 2);
  paint(wingG, 0x2c3438, 0.2, mulberry32(42));
  const bodyM = new THREE.MeshBasicMaterial({ vertexColors: true });
  const brng = mulberry32(43);
  for (let i = 0; i < 7; i++) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(bodyG, bodyM));
    const wings = new THREE.Mesh(wingG, bodyM);
    grp.add(wings);
    scene.add(grp);
    birds.push({ node: grp, wings, seed: brng() * 100, r: 22 + brng() * 22, h: 11 + brng() * 11, sp: 0.03 + brng() * 0.04 });
  }
}

// butterflies fluttering low over the bank bushes
const butterflies = [];
{
  const bparts = [];
  const btorso = new THREE.BoxGeometry(0.035, 0.035, 0.16);
  bparts.push(btorso);
  const bG = mergeGeometries(bparts.map((g) => paint(g, 0x2a2018, 0.2, mulberry32(51))), false);
  const bM = new THREE.MeshBasicMaterial({ vertexColors: true });
  const wR = new THREE.PlaneGeometry(0.20, 0.16);
  wR.rotateX(-Math.PI / 2); wR.translate(0.11, 0.02, 0);
  const wL = wR.clone(); wL.rotateY(Math.PI);
  const wG = mergeGeometries([wR, wL], false);
  const wM = new THREE.MeshBasicMaterial({
    map: makeWingTexture(), transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false, color: 0xcf8a4a,
  });
  const frng = mulberry32(53);
  for (let i = 0; i < 8; i++) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(bG, bM));
    const wings = new THREE.Mesh(wG, wM);
    grp.add(wings);
    scene.add(grp);
    butterflies.push({
      node: grp, wings, seed: frng() * 100,
      ox: (frng() - 0.5) * 60, oz: (frng() - 0.5) * 24, h: 0.8 + frng() * 1.2, sp: 0.6 + frng() * 0.9,
    });
  }
}

// fish shadows gliding under the surface are composited in the water shader

// ================= mist cards =================
function mistTexture() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = x / s - 0.5, dy = y / s - 0.5;
    const dd = Math.sqrt(dx * dx + dy * dy);
    const a = Math.max(0, 1 - dd * 2.2);
    const i = (y * s + x) * 4; img.data[i] = 190; img.data[i + 1] = 210; img.data[i + 2] = 220; img.data[i + 3] = Math.pow(a, 1.6) * 128;
  }
  ctx.putImageData(img, 0, 0); return new THREE.CanvasTexture(cv);
}
const mistTex = mistTexture();
const mists = [];
{
  const rng = mulberry32(7);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(50, 8),
      new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.16, blending: THREE.AdditiveBlending }));
    m.position.set((rng() - 0.5) * 160, 1 + rng() * 2.5, (rng() - 0.5) * 30);
    m.userData.v = 0.15 + rng() * 0.3; scene.add(m); mists.push(m);
  }
}

// ================= post =================
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.8, 0.85);
composer.addPass(bloom);
const vig = new ShaderPass(VignetteShader); vig.uniforms.offset.value = 1.05; vig.uniforms.darkness.value = 1.15;
composer.addPass(vig);
composer.addPass(new OutputPass());

// ================= steady outboard audio: no wobble, stays on while held =================
const MotorAudio = {
  ctx: null, master: null, motorGain: null, motorOsc1: null, motorOsc2: null,
  washGain: null, muted: false, throttle: 0, audioAcc: 0, nextCroak: 0, nextChirp: 0,
  init() {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const master = ctx.createGain(); master.gain.value = 0.4; master.connect(ctx.destination);
      this.master = master;
      // steady motor: two fixed oscillators through a lowpass, NO lfo anywhere
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 46;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 92;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const mg = ctx.createGain(); mg.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(mg); mg.connect(master);
      o1.start(); o2.start();
      this.motorOsc1 = o1; this.motorOsc2 = o2; this.motorGain = mg;
      // water wash: looped noise, gain follows speed
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
      const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 850; nf.Q.value = 0.5;
      const ng = ctx.createGain(); ng.gain.value = 0.015;
      n.connect(nf); nf.connect(ng); ng.connect(master); n.start();
      this.washGain = ng;
      this.nextCroak = ctx.currentTime + 2; this.nextChirp = ctx.currentTime + 4;
    } catch (e) { /* no audio */ }
  },
  croak(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(65, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.35);
  },
  chirp(t) {
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4200;
      const g = ctx.createGain(); const st = t + i * 0.09;
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.012, st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.06);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st + 0.08);
    }
  },
  update(dt, throttle, speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // smooth toward targets a few times per second: constant while held, gentle release
    this.audioAcc += dt;
    if (this.audioAcc > 0.12) {
      this.audioAcc = 0;
      const tc = this.ctx.currentTime;
      this.motorOsc1.frequency.setTargetAtTime(44 + throttle * 34, tc, 0.25);
      this.motorOsc2.frequency.setTargetAtTime(88 + throttle * 68, tc, 0.25);
      this.motorGain.gain.setTargetAtTime(0.012 + throttle * 0.075, tc, throttle > 0.02 ? 0.3 : 0.8);
      this.washGain.gain.setTargetAtTime(0.012 + speed01 * 0.05, tc, 0.4);
    }
    if (t > this.nextCroak) { this.croak(t); this.nextCroak = t + 2.5 + Math.random() * 4; }
    if (t > this.nextChirp) { this.chirp(t); this.nextChirp = t + 4 + Math.random() * 5; }
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.4;
  },
};

// ================= state / input / HUD =================
const state = { x: -60, z: channelCenter(-60), heading: 0, speed: 0, turn: 0, dist: 0 };
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyC') toggleCabin();
});
addEventListener('keyup', (e) => keys.delete(e.code));
const orbit = { yaw: Math.PI, pitch: 0.30, drag: false, lx: 0, ly: 0 };
let camIdle = 100, cabin = false;
addEventListener('pointerdown', (e) => {
  if (e.target.id !== 'eveningBtn' && e.target.id !== 'muteBtn' && e.target.id !== 'cabinBtn') {
    orbit.drag = true; orbit.lx = e.clientX; orbit.ly = e.clientY;
  }
  MotorAudio.init();
});
addEventListener('pointerup', () => orbit.drag = false);
addEventListener('pointermove', (e) => {
  if (!orbit.drag) return;
  camIdle = 0;
  orbit.yaw += (e.clientX - orbit.lx) * 0.004;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - orbit.ly) * 0.003, 0.03, 0.55);
  orbit.lx = e.clientX; orbit.ly = e.clientY;
});

const MODES = [NIGHT, EVENING, DAY];
const MODE_NAMES = ['night mode', 'evening mode', 'day mode'];
let modeIdx = 0, lampLevel = 1, mistBase = 0.16;
const btn = document.getElementById('eveningBtn');
function applyMode(P) {
  scene.fog.color.copy(P.fog); scene.fog.density = P.fogDensity; renderer.setClearColor(P.fog);
  skyMat.uniforms.uZenith.value.copy(P.zenith); skyMat.uniforms.uHorizon.value.copy(P.horizon);
  skyMat.uniforms.uMoonColor.value.copy(P.moon);
  moonLight.color.copy(P.moonLight); moonLight.intensity = P.moonI;
  hemi.color.copy(P.hemiSky); hemi.groundColor.copy(P.hemiGnd); hemi.intensity = P.hemiI;
  waterMat.uniforms.uFogColor.value.copy(P.fog); waterMat.uniforms.uFogDensity.value = P.fogDensity;
  waterMat.uniforms.uDeep.value.copy(P.deep); waterMat.uniforms.uSky.value.copy(P.sky);
  lantern.color.copy(P.lantern);
  renderer.toneMappingExposure = P.exposure;
  lampLevel = P.lamp;
  if (dynMats.lampGlass) dynMats.lampGlass.emissiveIntensity = P.lampGlass;
  if (dynMats.glass) dynMats.glass.emissiveIntensity = P.lampGlass * 0.6;
  flies.visible = P.flies;
  mistBase = P.mist;
  for (const m of mists) m.material.opacity = P.mist;
  bloom.strength = P.bloom;
  leafMat.emissiveIntensity = P.leafEm; mossMat.emissiveIntensity = P.leafEm;
}
btn.onclick = (e) => {
  e.stopPropagation(); modeIdx = (modeIdx + 1) % 3;
  btn.classList.toggle('on', modeIdx === 1);
  btn.textContent = MODE_NAMES[modeIdx];
  applyMode(MODES[modeIdx]);
};
const muteBtn = document.getElementById('muteBtn');
const cabinBtn = document.getElementById('cabinBtn');
function toggleCabin() {
  cabin = !cabin;
  cabinBtn.classList.toggle('on', cabin);
  camIdle = 0;
}
cabinBtn.onclick = (e) => { e.stopPropagation(); MotorAudio.init(); toggleCabin(); };
function toggleMute() {
  MotorAudio.init();
  MotorAudio.setMuted(!MotorAudio.muted);
  muteBtn.textContent = MotorAudio.muted ? 'unmute' : 'mute';
}
muteBtn.onclick = (e) => { e.stopPropagation(); toggleMute(); };

const PLACES = ['Cypress Cathedral', 'Heron Pond', 'Firefly Hollow', 'Mirror Reach', 'The Drowned Road', 'Owl Water', 'Lantern Deep', 'Moss Veil', 'Egret Rest'];
const locName = document.getElementById('locName');

// ================= main loop =================
updateSegments(state.x);
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const fwd = keys.has('KeyW') || keys.has('ArrowUp'), back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft'), right = keys.has('KeyD') || keys.has('ArrowRight');
  const target = fwd ? 3.4 : back ? -1.5 : 0.9;
  state.speed = THREE.MathUtils.lerp(state.speed, target, dt * 1.0);
  state.turn = THREE.MathUtils.lerp(state.turn, (right ? 1 : 0) - (left ? 1 : 0), dt * 2.2);
  const sf = THREE.MathUtils.clamp(Math.abs(state.speed) / 3.4, 0.15, 1) * Math.sign(state.speed || 1);
  state.heading += state.turn * dt * 0.35 * sf;
  const stepX = Math.cos(state.heading) * state.speed * dt;
  const stepZ = Math.sin(state.heading) * state.speed * dt;
  state.dist += Math.hypot(stepX, stepZ);
  state.x += stepX; // endless: x is unbounded, segments stream in
  const cc = channelCenter(state.x), maxOff = channelHalf(state.x) - 2.2;
  state.z = THREE.MathUtils.clamp(state.z + stepZ, cc - maxOff, cc + maxOff);
  if (keys.has('KeyR')) { state.x = -60; state.z = channelCenter(-60); state.heading = 0; state.speed = 0; }

  updateSegments(state.x);
  for (const sg of segCache.values()) {
    const gs = sg.userData.gators;
    if (!gs) continue;
    for (const g of gs) {
      g.t += dt;
      g.node.userData.tail.rotation.y = Math.sin(g.t * 2.3) * 0.28;
      const dx = g.node.position.x - state.x, dz = g.node.position.z - state.z;
      const want = (dx * dx + dz * dz) < 36 ? 1 : 0;
      g.sub = THREE.MathUtils.lerp(g.sub, want, dt * 0.8);
      g.node.position.y = g.baseY - g.sub * 0.22 + Math.sin(g.t * 1.4) * 0.02;
    }
  }

  boat.position.set(state.x, Math.sin(t * 1.1) * 0.05 + Math.sin(t * 0.6) * 0.03, state.z);
  boat.rotation.y = -state.heading;
  boat.rotation.z = Math.sin(t * 0.9) * 0.02 - state.turn * sf * 0.05;
  boat.rotation.x = Math.sin(t * 0.7) * 0.015;

  lantern.position.set(state.x + Math.cos(state.heading) * 1.9, 1.9, state.z + Math.sin(state.heading) * 1.9);
  lantern.intensity = 28 * lampLevel * (1 + Math.sin(t * 11) * 0.06 + Math.sin(t * 23) * 0.04);
  stern.position.set(state.x - Math.cos(state.heading) * 1.1, 1.6, state.z - Math.sin(state.heading) * 1.1);
  stern.intensity = 8 * lampLevel * (1 + Math.sin(t * 9.3 + 2.0) * 0.08);
  if (dynMats.headSpot) dynMats.headSpot.intensity = 750 * lampLevel * (1 + Math.sin(t * 13.7) * 0.03);

  const fx = Math.cos(state.heading), fz = Math.sin(state.heading);
  // ease the camera back to default 7s after the last drag
  camIdle += dt;
  if (!orbit.drag && camIdle > 7) {
    const k = 1 - Math.pow(0.05, dt);
    const targetYaw = Math.PI + Math.round((orbit.yaw - Math.PI) / (Math.PI * 2)) * Math.PI * 2;
    orbit.yaw += (targetYaw - orbit.yaw) * k;
    orbit.pitch += (0.30 - orbit.pitch) * k;
  }
  if (cabin) {
    // helm view: standing behind the bow, looking over the foredeck
    let yawOff = orbit.yaw - Math.PI;
    yawOff = Math.atan2(Math.sin(yawOff), Math.cos(yawOff));
    const ca = Math.cos(yawOff), sa = Math.sin(yawOff);
    camera.position.set(state.x - fx * 0.5, boat.position.y + 2.75, state.z - fz * 0.5);
    camLook.set(state.x + (fx * ca - fz * sa) * 10, 1.2 - (orbit.pitch - 0.30) * 10, state.z + (fx * sa + fz * ca) * 10);
    camera.lookAt(camLook);
  } else {
  const lx = -fz, lz = fx, ct = Math.cos(orbit.yaw), st = Math.sin(orbit.yaw), cp = Math.cos(orbit.pitch);
  camPos.set(state.x + (fx * ct + lx * st) * 11.0 * cp, 1.9 + orbit.pitch * 9 + Math.sin(t * 0.8) * 0.08, state.z + (fz * ct + lz * st) * 11.0 * cp);
  const gy = bankHeight(camPos.x, camPos.z);
  if (camPos.y < gy + 1.2) camPos.y = gy + 1.2;
  camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
  camLook.set(state.x + fx * 1.2, 1.9, state.z + fz * 1.2);
  camera.lookAt(camLook);
  }

  water.position.x = state.x;
  waterMat.uniforms.uTime.value = t;
  waterMat.uniforms.uBoat.value.set(state.x, state.z);
  waterMat.uniforms.uBoatDir.value.set(fx, fz);
  const speed01 = THREE.MathUtils.clamp(Math.abs(state.speed) / 3.4, 0, 1);
  waterMat.uniforms.uSpeed.value = Math.max(speed01, 0.1);
  waterMat.uniforms.uLampPos.value.copy(lantern.position);
  waterMat.uniforms.uLampLevel.value = lampLevel;
  sky.position.copy(camera.position);
  skyMat.uniforms.uTime.value = t;
  flyMat.uniforms.uTime.value = t;
  flies.position.x = state.x;
  for (const d of dragonflies) {
    const a = t * d.sp + d.seed;
    d.node.position.set(
      state.x + Math.cos(a) * d.r + Math.sin(a * 2.3) * 1.5,
      d.h + Math.sin(t * 3 + d.seed) * 0.25,
      state.z + Math.sin(a * 1.3) * d.r * 0.6 + Math.cos(a * 0.7) * 2);
    d.node.rotation.y = -a;
    d.wings.rotation.z = Math.sin(t * 26 + d.seed) * 0.14;
  }
  for (const b of birds) {
    const a = t * b.sp + b.seed;
    const cxp = state.x + 40, czp = channelCenter(state.x + 40);
    b.node.position.set(
      cxp + Math.cos(a) * b.r,
      b.h + Math.sin(t * 0.5 + b.seed) * 1.5,
      czp + Math.sin(a) * b.r * 0.5);
    b.node.rotation.y = -a;
    b.wings.rotation.z = Math.sin(t * 9 + b.seed) * 0.45;
  }
  for (const f of butterflies) {
    const a = t * f.sp + f.seed;
    f.node.position.set(
      state.x + f.ox * 0.3 + Math.cos(a) * 3 + Math.sin(a * 2.7) * 1.2,
      f.h + Math.sin(t * 5 + f.seed) * 0.3,
      channelCenter(state.x + f.ox * 0.3) + f.oz * 0.4 + Math.sin(a * 1.7) * 2);
    f.node.rotation.y = -a;
    f.wings.rotation.z = Math.sin(t * 14 + f.seed) * 0.35;
  }
  // fish shadows gliding under the surface are composited in the water shader
  gnats.visible = lampLevel > 0.1;
  if (gnats.visible) {
    const pa = gnatGeo.attributes.position;
    for (let i = 0; i < GNATS; i++) {
      const s = gnatSeeds[i];
      const a = t * s[2] + s[0];
      pa.setXYZ(i,
        lantern.position.x + Math.cos(a) * s[1],
        lantern.position.y - 0.4 + Math.sin(t * 2 + s[3]) * 0.4,
        lantern.position.z + Math.sin(a) * s[1]);
    }
    pa.needsUpdate = true;
  }
  for (const m of mists) {
    m.position.x += m.userData.v * dt;
    if (m.position.x - state.x > 95) m.position.x -= 190;
    m.lookAt(camera.position.x, m.position.y, camera.position.z);
    const mdx = m.position.x - camera.position.x, mdz = m.position.z - camera.position.z;
    m.material.opacity = mistBase * THREE.MathUtils.clamp((Math.hypot(mdx, mdz) - 4) / 10, 0, 1);
  }
  const throttle = fwd ? 1 : back ? 0.45 : 0.06;
  MotorAudio.throttle = throttle;
  MotorAudio.update(dt, throttle, speed01);
  locName.textContent = PLACES[Math.floor(state.dist / 160) % PLACES.length];
  updateReflection();
  composer.render();
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  reflectionRT.setSize(Math.max(320, Math.floor(innerWidth / 2)), Math.max(180, Math.floor(innerHeight / 2)));
});
