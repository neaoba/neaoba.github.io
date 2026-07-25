import * as THREE from "three";

const canvas = document.querySelector("#canvas");
const fileInput = document.querySelector("#fileInput");
const video = document.querySelector("#video");
const image = document.querySelector("#image");
const status = document.querySelector("#status");
const scaleMode = document.querySelector("#scaleMode");
const bgrBox = document.querySelector("#bgr");

const defaults = {
  gain: 1.5,
  gamma: 2.2,
  blacklevel: 0.0,
  ambient: 0.0,
  rStrength: 0.75,
  gStrength: 0.75,
  bStrength: 0.75
};

const definitions = [
  ["gain", "Gain", 0.5, 2.0, 0.05],
  ["gamma", "LCD Gamma", 0.5, 5.0, 0.1],
  ["blacklevel", "Black level", 0.0, 0.5, 0.01],
  ["ambient", "Ambient", 0.0, 0.5, 0.01],
  ["rStrength", "R subpixel", 0.0, 1.0, 0.01],
  ["gStrength", "G subpixel", 0.0, 1.0, 0.01],
  ["bStrength", "B subpixel", 0.0, 1.0, 0.01]
];

const sliders = {};
const sliderHost = document.querySelector("#sliders");
for (const [key, label, min, max, step] of definitions) {
  const wrap = document.createElement("div");
  wrap.className = "control";
  wrap.innerHTML = `
    <div class="rangeHead"><label for="${key}">${label}</label><span class="value"></span></div>
    <input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${defaults[key]}">
  `;
  sliderHost.appendChild(wrap);
  const input = wrap.querySelector("input");
  const value = wrap.querySelector(".value");
  input.addEventListener("input", () => {
    value.textContent = Number(input.value).toFixed(step < 0.1 ? 2 : 1);
    uniforms[key].value = Number(input.value);
  });
  input.dispatchEvent(new Event("input"));
  sliders[key] = input;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: true,
  preserveDrawingBuffer: true
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(1);

if (!renderer.capabilities.isWebGL2) {
  throw new Error("この移植版にはWebGL 2が必要です。");
}

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  Source: { value: null },
  SourceSize: { value: new THREE.Vector4(320, 240, 1 / 320, 1 / 240) },
  OutputSize: { value: new THREE.Vector4(960, 720, 1 / 960, 1 / 720) },
  gain: { value: defaults.gain },
  gamma: { value: defaults.gamma },
  blacklevel: { value: defaults.blacklevel },
  ambient: { value: defaults.ambient },
  BGR: { value: 0 },
  rStrength: { value: defaults.rStrength },
  gStrength: { value: defaults.gStrength },
  bStrength: { value: defaults.bStrength }
};

const vertexShader = `#version 300 es
in vec3 position;
in vec2 uv;
out vec2 vTexCoord;

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vTexCoord = uv;
}
`;

const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D Source;
uniform vec4 SourceSize;
uniform vec4 OutputSize;

uniform float gain;
uniform float gamma;
uniform float blacklevel;
uniform float ambient;
uniform float BGR;
uniform float rStrength;
uniform float gStrength;
uniform float bStrength;

in vec2 vTexCoord;
out vec4 FragColor;

const float OUT_GAMMA = 2.2;

float coeffX(int i) {
  if (i == 0) return 1.0;
  if (i == 1) return -2.0 / 3.0;
  if (i == 2) return -1.0 / 5.0;
  if (i == 3) return 4.0 / 7.0;
  if (i == 4) return -1.0 / 9.0;
  if (i == 5) return -2.0 / 11.0;
  return 1.0 / 13.0;
}

float coeffY(int i) {
  if (i == 0) return 1.0;
  if (i == 1) return 0.0;
  if (i == 2) return -4.0 / 5.0;
  if (i == 3) return 2.0 / 7.0;
  if (i == 4) return 4.0 / 9.0;
  if (i == 5) return -4.0 / 11.0;
  return 1.0 / 13.0;
}

float intsmearFunc(float z, bool useY) {
  float z2 = z * z;
  float zn = z;
  float ret = 0.0;
  for (int i = 0; i < 7; ++i) {
    ret += zn * (useY ? coeffY(i) : coeffX(i));
    zn *= z2;
  }
  return ret;
}

float intsmear(float x, float dx, float d, bool useY) {
  float safeDx = max(dx, 0.000001);
  float zl = clamp((x - safeDx * 0.5) / d, -1.0, 1.0);
  float zh = clamp((x + safeDx * 0.5) / d, -1.0, 1.0);
  return d * (intsmearFunc(zh, useY) - intsmearFunc(zl, useY)) / safeDx;
}

vec3 fetchOffset(ivec2 coord, ivec2 offset) {
  ivec2 sizePx = ivec2(SourceSize.xy);
  ivec2 p = clamp(coord + offset, ivec2(0), sizePx - ivec2(1));
  vec3 source = texelFetch(Source, p, 0).rgb;
  return pow(vec3(gain) * source + vec3(blacklevel), vec3(gamma))
       + vec3(ambient);
}

void main() {
  vec2 texelSize = SourceSize.zw;
  vec2 range = OutputSize.zw;

  vec3 cred   = pow(vec3(rStrength, 0.0, 0.0), vec3(OUT_GAMMA));
  vec3 cgreen = pow(vec3(0.0, gStrength, 0.0), vec3(OUT_GAMMA));
  vec3 cblue  = pow(vec3(0.0, 0.0, bStrength), vec3(OUT_GAMMA));

  ivec2 tli = ivec2(floor(vTexCoord / texelSize - vec2(0.4999)));

  float subpix = (vTexCoord.x / texelSize.x - 0.4999 - float(tli.x)) * 3.0;
  float rsubpix = range.x / texelSize.x * 3.0;

  vec3 lcol = vec3(
    intsmear(subpix + 1.0, rsubpix, 1.5, false),
    intsmear(subpix,       rsubpix, 1.5, false),
    intsmear(subpix - 1.0, rsubpix, 1.5, false)
  );

  vec3 rcol = vec3(
    intsmear(subpix - 2.0, rsubpix, 1.5, false),
    intsmear(subpix - 3.0, rsubpix, 1.5, false),
    intsmear(subpix - 4.0, rsubpix, 1.5, false)
  );

  if (BGR > 0.5) {
    lcol = lcol.bgr;
    rcol = rcol.bgr;
  }

  subpix = vTexCoord.y / texelSize.y - 0.4999 - float(tli.y);
  rsubpix = range.y / texelSize.y;

  float tcol = intsmear(subpix,       rsubpix, 0.63, true);
  float bcol = intsmear(subpix - 1.0, rsubpix, 0.63, true);

  vec3 topLeft     = fetchOffset(tli, ivec2(0, 0)) * lcol * tcol;
  vec3 bottomRight = fetchOffset(tli, ivec2(1, 1)) * rcol * bcol;
  vec3 bottomLeft  = fetchOffset(tli, ivec2(0, 1)) * lcol * bcol;
  vec3 topRight    = fetchOffset(tli, ivec2(1, 0)) * rcol * tcol;

  vec3 averageColor = topLeft + bottomRight + bottomLeft + topRight;

  // Equivalent to mat3(cred, cgreen, cblue) * averageColor.
  averageColor = cred * averageColor.r
               + cgreen * averageColor.g
               + cblue * averageColor.b;

  FragColor = vec4(pow(max(averageColor, vec3(0.0)), vec3(1.0 / OUT_GAMMA)), 1.0);
}
`;

const material = new THREE.RawShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  glslVersion: THREE.GLSL3,
  depthTest: false,
  depthWrite: false
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

let sourceWidth = 320;
let sourceHeight = 240;
let currentTexture = null;
let objectURL = null;

function setTexture(texture, width, height, label) {
  if (currentTexture) currentTexture.dispose();
  currentTexture = texture;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  uniforms.Source.value = texture;
  sourceWidth = width;
  sourceHeight = height;
  uniforms.SourceSize.value.set(width, height, 1 / width, 1 / height);
  status.textContent = `${label} — ${width}×${height}`;
  resizeOutput();
}

function resizeOutput() {
  const value = scaleMode.value;
  let width;
  let height;

  if (value === "fit") {
    const viewer = document.querySelector(".viewer");
    const maxW = Math.max(1, viewer.clientWidth - 32);
    const maxH = Math.max(1, viewer.clientHeight - 32);
    const scale = Math.max(1 / Math.max(sourceWidth, sourceHeight),
      Math.min(maxW / sourceWidth, maxH / sourceHeight));
    width = Math.max(1, Math.floor(sourceWidth * scale));
    height = Math.max(1, Math.floor(sourceHeight * scale));
  } else {
    const scale = Number(value);
    width = sourceWidth * scale;
    height = sourceHeight * scale;
  }

  renderer.setSize(width, height, false);
  uniforms.OutputSize.value.set(width, height, 1 / width, 1 / height);
}

function makeSampleTexture() {
  const w = 320;
  const h = 240;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#ef476f");
  g.addColorStop(.33, "#ffd166");
  g.addColorStop(.66, "#06d6a0");
  g.addColorStop(1, "#118ab2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#06131d";
  ctx.fillRect(16, 16, 288, 54);
  ctx.fillStyle = "#f5fbff";
  ctx.font = "bold 31px monospace";
  ctx.fillText("LCD GRID V2", 31, 53);

  for (let y = 92; y < 220; y += 32) {
    for (let x = 28; x < 300; x += 32) {
      ctx.fillStyle = ((x + y) / 32) % 2 ? "#101820" : "#f2f6f8";
      ctx.fillRect(x, y, 24, 24);
    }
  }
  return { texture: new THREE.CanvasTexture(c), width: w, height: h };
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(file);

  if (file.type.startsWith("video/")) {
    image.hidden = true;
    video.hidden = true;
    video.src = objectURL;
    await video.play();
    const texture = new THREE.VideoTexture(video);
    setTexture(texture, video.videoWidth, video.videoHeight, file.name);
  } else {
    video.pause();
    image.src = objectURL;
    await image.decode();
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    setTexture(texture, image.naturalWidth, image.naturalHeight, file.name);
  }
});

scaleMode.addEventListener("change", resizeOutput);
window.addEventListener("resize", () => {
  if (scaleMode.value === "fit") resizeOutput();
});
bgrBox.addEventListener("change", () => {
  uniforms.BGR.value = bgrBox.checked ? 1 : 0;
});

document.querySelector("#defaults").addEventListener("click", () => {
  for (const [key] of definitions) {
    sliders[key].value = defaults[key];
    sliders[key].dispatchEvent(new Event("input"));
  }
  bgrBox.checked = false;
  bgrBox.dispatchEvent(new Event("change"));
});

document.querySelector("#savePng").addEventListener("click", () => {
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.download = "lcd-grid-v2.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
});

const sample = makeSampleTexture();
setTexture(sample.texture, sample.width, sample.height, "サンプル");

function animate() {
  requestAnimationFrame(animate);
  if (currentTexture?.isVideoTexture) currentTexture.needsUpdate = true;
  renderer.render(scene, camera);
}
animate();
