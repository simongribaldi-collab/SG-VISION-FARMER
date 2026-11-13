import { BUILDING_CATALOG, generateTerrainHeights } from "../data/presets.js";
import { getCropById } from "./predictor.js";
import { computeSunPosition } from "./weather.js";

// --- Math 3D (mat4 column-major) ---
function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function mat4Transform(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);

  const m00 = (cy * cz + syr * sxr * szr) * sx;
  const m10 = (cx * szr) * sx;
  const m20 = (-syr * cz + cy * sxr * szr) * sx;

  const m01 = (-cy * szr + syr * sxr * cz) * sy;
  const m11 = (cx * cz) * sy;
  const m21 = (syr * szr + cy * sxr * cz) * sy;

  const m02 = (syr * cx) * sz;
  const m12 = (-sxr) * sz;
  const m22 = (cy * cx) * sz;

  return new Float32Array([
    m00, m10, m20, 0,
    m01, m11, m21, 0,
    m02, m12, m22, 0,
    tx, ty, tz, 1,
  ]);
}

function lerpColor(c1, c2, t) {
  const k = Math.max(0, Math.min(1, t));
  return [c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k];
}

// --- Geometries de base ---
function createBoxGeometry() {
  const faces = [
    { n: [0, 1, 0], v: [[-0.5, 1, -0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, 0, 0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5]] },
    { n: [0, 0, 1], v: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]] },
    { n: [1, 0, 0], v: [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]] },
  ];
  const pos = [], norm = [];
  for (const f of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...f.v[i]);
      norm.push(...f.n);
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

function createCylinderGeometry(segs = 14) {
  const pos = [], norm = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = Math.cos(a0) * 0.5, z0 = Math.sin(a0) * 0.5;
    const x1 = Math.cos(a1) * 0.5, z1 = Math.sin(a1) * 0.5;
    const nx0 = Math.cos(a0), nz0 = Math.sin(a0);
    const nx1 = Math.cos(a1), nz1 = Math.sin(a1);
    pos.push(x0, 0, z0, x1, 0, z1, x1, 1, z1, x0, 0, z0, x1, 1, z1, x0, 1, z0);
    norm.push(nx0, 0, nz0, nx1, 0, nz1, nx1, 0, nz1, nx0, 0, nz0, nx1, 0, nz1, nx0, 0, nz0);
    pos.push(0, 1, 0, x0, 1, z0, x1, 1, z1);
    norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

function createConeGeometry(segs = 12) {
  const pos = [], norm = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = Math.cos(a0) * 0.5, z0 = Math.sin(a0) * 0.5;
    const x1 = Math.cos(a1) * 0.5, z1 = Math.sin(a1) * 0.5;
    pos.push(x0, 0, z0, x1, 0, z1, 0, 1, 0);
    norm.push(Math.cos(a0), 0.5, Math.sin(a0), Math.cos(a1), 0.5, Math.sin(a1), 0, 1, 0);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

function createRoofGeometry() {
  const pos = [], norm = [];
  const pushTri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    pos.push(...a, ...b, ...c);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  };
  pushTri([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0]);
  pushTri([-0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0]);
  pushTri([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0]);
  pushTri([0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0]);
  pushTri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0]);
  pushTri([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0]);
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/**
 * Interpole la hauteur du terrain (denivele) en tout point (x, z) du monde 3D.
 */
export function getTerrainHeight(state, worldX, worldZ) {
  const t = state?.terrain;
  if (!t || !Array.isArray(t.heights) || !t.res) return 0;
  const gSize = (state.farm?.gridSize || 44) + 8;
  const res = t.res;
  const fx = ((worldX / gSize) + 0.5) * res;
  const fz = ((worldZ / gSize) + 0.5) * res;
  const x0 = Math.max(0, Math.min(res - 1, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(res - 1, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const tz = Math.max(0, Math.min(1, fz - z0));

  const stride = res + 1;
  const h00 = t.heights[z0 * stride + x0] || 0;
  const h10 = t.heights[z0 * stride + x0 + 1] || 0;
  const h01 = t.heights[(z0 + 1) * stride + x0] || 0;
  const h11 = t.heights[(z0 + 1) * stride + x0 + 1] || 0;

  return (
    h00 * (1 - tx) * (1 - tz) +
    h10 * tx * (1 - tz) +
    h01 * (1 - tx) * tz +
    h11 * tx * tz
  );
}

/**
 * Modifie le denivele au pinceau 3D (raise, lower, flatten, smooth).
 */
export function sculptTerrainAt(state, worldX, worldZ, tool = "raise", radius = 4.5, strength = 0.28) {
  if (!state.terrain || !Array.isArray(state.terrain.heights)) {
    state.terrain = generateTerrainHeights("valley_river", 32);
  }
  const t = state.terrain;
  const res = t.res;
  const stride = res + 1;
  const gSize = (state.farm?.gridSize || 44) + 8;
  const centerH = getTerrainHeight(state, worldX, worldZ);

  for (let gz = 0; gz <= res; gz++) {
    for (let gx = 0; gx <= res; gx++) {
      const vx = ((gx / res) - 0.5) * gSize;
      const vz = ((gz / res) - 0.5) * gSize;
      const dist = Math.hypot(vx - worldX, vz - worldZ);
      if (dist > radius) continue;

      const falloff = Math.cos((dist / radius) * (Math.PI / 2));
      const idx = gz * stride + gx;
      const cur = t.heights[idx] || 0;

      if (tool === "raise") {
        t.heights[idx] = Number(Math.min(6.5, cur + strength * falloff).toFixed(2));
      } else if (tool === "lower") {
        t.heights[idx] = Number(Math.max(-3.0, cur - strength * falloff).toFixed(2));
      } else if (tool === "flatten") {
        t.heights[idx] = Number((cur + (centerH - cur) * 0.35 * falloff).toFixed(2));
      } else if (tool === "smooth") {
        let sum = cur, cnt = 1;
        if (gx > 0) { sum += t.heights[idx - 1]; cnt++; }
        if (gx < res) { sum += t.heights[idx + 1]; cnt++; }
        if (gz > 0) { sum += t.heights[idx - stride]; cnt++; }
        if (gz < res) { sum += t.heights[idx + stride]; cnt++; }
        const avg = sum / cnt;
        t.heights[idx] = Number((cur + (avg - cur) * 0.5 * falloff).toFixed(2));
      }
    }
  }
  t._dirty = true;
}

export class Farm3DEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.camera = { yaw: 0.65, pitch: 0.56, dist: 42, targetX: 0, targetZ: 0 };
    this.overlay = "normal";
    this.selectedId = null;
    this.buildMode = { active: false, type: "bed_open", rot: 0, hoverX: 0, hoverZ: 0, hoverValid: false };
    this.sculptMode = { active: false, tool: "raise", radius: 5.0 };
    this.hitBoxes = [];
    this.arPins = [];
    this.elapsed = 0;
    this.dragging = false;
    this.dragButton = 0;
    this.lastMouse = { x: 0, y: 0 };
    this.dragMoved = false;
    this.terrainCacheKey = "";

    this.gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (this.gl) {
      this._initWebGL();
    } else {
      this.ctx2d = canvas.getContext("2d");
    }
    this._bindEvents();
  }

  _initWebGL() {
    const gl = this.gl;
    const vsSrc = `
      attribute vec3 aPos;
      attribute vec3 aNorm;
      uniform mat4 uProj;
      uniform mat4 uView;
      uniform mat4 uModel;
      varying vec3 vNorm;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = uModel * vec4(aPos, 1.0);
        vWorldPos = wp.xyz;
        vNorm = normalize(mat3(uModel) * aNorm);
        gl_Position = uProj * uView * wp;
      }
    `;
    // Fragment shader enrichi : textures procedurales terrain/courbes de niveau, eau animee, pierre/tuile, feuillage
    const fsSrc = `
      precision mediump float;
      varying vec3 vNorm;
      varying vec3 vWorldPos;
      uniform vec4 uColor;
      uniform vec3 uSunDir;
      uniform float uSunInt;
      uniform vec3 uSkyColor;
      uniform float uEmissive;
      uniform float uMatType;
      uniform float uTime;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        vec3 n = normalize(vNorm);
        vec3 baseCol = uColor.rgb;
        float spec = 0.0;

        if (uMatType > 0.5 && uMatType < 1.5) {
          // 1.0 = Terrain avec herbe procedurale, pente roche/terre et courbes topographiques
          float n1 = sin(vWorldPos.x * 1.7) * cos(vWorldPos.z * 1.7) * 0.04;
          float n2 = (hash2(floor(vWorldPos.xz * 3.0)) - 0.5) * 0.05;
          float slope = 1.0 - clamp(n.y, 0.0, 1.0);
          vec3 rockCol = vec3(0.42, 0.36, 0.28);
          baseCol = mix(baseCol + n1 + n2, rockCol, clamp(slope * 2.6, 0.0, 0.85));
          // Courbes de niveau subtiles tous les 0.8m d'altitude
          float contour = abs(fract(vWorldPos.y * 1.25) - 0.5);
          if (contour < 0.04 && abs(vWorldPos.y) > 0.15) {
            baseCol *= 0.88;
          }
        } else if (uMatType > 1.5 && uMatType < 2.5) {
          // 2.0 = Eau vive (riviere, bassin) avec vaguelettes et reflets solaires
          float wave = sin(vWorldPos.x * 3.8 + uTime * 3.2) * cos(vWorldPos.z * 3.2 - uTime * 2.4) * 0.06;
          baseCol += vec3(wave * 0.5, wave * 0.8, wave);
          spec = pow(max(dot(n, normalize(uSunDir + vec3(0.0, 0.8, 0.2))), 0.0), 24.0) * 0.45;
        } else if (uMatType > 2.5 && uMatType < 3.5) {
          // 3.0 = Pierre de taille & Toiture tuiles
          float brick = step(0.12, fract(vWorldPos.y * 3.2 + step(0.5, fract(vWorldPos.x * 1.5)) * 0.5));
          float mortar = step(0.08, fract((vWorldPos.x + vWorldPos.z) * 2.2));
          baseCol *= (0.9 + 0.1 * brick * mortar);
        } else if (uMatType > 3.5 && uMatType < 4.5) {
          // 4.0 = Feuillage / Cultures / Haies
          float leaf = sin(vWorldPos.x * 6.0 + vWorldPos.y * 4.0) * cos(vWorldPos.z * 6.0) * 0.07;
          baseCol += vec3(leaf * 0.4, leaf, leaf * 0.2);
        } else if (uMatType > 4.5) {
          // 5.0 = Verre / Panneau Solaire
          spec = pow(max(dot(n, normalize(uSunDir + vec3(0.1, 0.9, 0.1))), 0.0), 18.0) * 0.4;
        }

        float diff = max(dot(n, normalize(uSunDir)), 0.0);
        float hemi = 0.5 + 0.5 * n.y;
        vec3 amb = mix(vec3(0.16, 0.19, 0.18), uSkyColor * 0.58, hemi);
        vec3 lit = baseCol * (amb + diff * uSunInt * 0.95 + uEmissive) + vec3(spec * uSunInt);

        float dist = length(vWorldPos.xz);
        float fog = clamp((dist - 62.0) / 58.0, 0.0, 0.65);
        vec3 finalRgb = mix(lit, uSkyColor * 0.7, fog);
        gl_FragColor = vec4(finalRgb, uColor.a);
      }
    `;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    this.prog = prog;

    this.locs = {
      aPos: gl.getAttribLocation(prog, "aPos"),
      aNorm: gl.getAttribLocation(prog, "aNorm"),
      uProj: gl.getUniformLocation(prog, "uProj"),
      uView: gl.getUniformLocation(prog, "uView"),
      uModel: gl.getUniformLocation(prog, "uModel"),
      uColor: gl.getUniformLocation(prog, "uColor"),
      uSunDir: gl.getUniformLocation(prog, "uSunDir"),
      uSunInt: gl.getUniformLocation(prog, "uSunInt"),
      uSkyColor: gl.getUniformLocation(prog, "uSkyColor"),
      uEmissive: gl.getUniformLocation(prog, "uEmissive"),
      uMatType: gl.getUniformLocation(prog, "uMatType"),
      uTime: gl.getUniformLocation(prog, "uTime"),
    };

    const upload = (geom) => {
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, geom.pos, gl.STATIC_DRAW);
      const normBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, geom.norm, gl.STATIC_DRAW);
      return { posBuf, normBuf, count: geom.count };
    };

    this.meshes = {
      box: upload(createBoxGeometry()),
      cyl: upload(createCylinderGeometry(14)),
      cone: upload(createConeGeometry(12)),
      roof: upload(createRoofGeometry()),
      terrain: { posBuf: gl.createBuffer(), normBuf: gl.createBuffer(), count: 0 },
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _rebuildTerrainMesh(state) {
    const gl = this.gl;
    if (!gl) return;
    if (!state.terrain || !Array.isArray(state.terrain.heights)) {
      state.terrain = generateTerrainHeights("valley_river", 32);
    }
    const t = state.terrain;
    const res = t.res || 32;
    const stride = res + 1;
    const gSize = (state.farm?.gridSize || 44) + 8;

    const getV = (gx, gz) => {
      const x = ((gx / res) - 0.5) * gSize;
      const z = ((gz / res) - 0.5) * gSize;
      const y = t.heights[gz * stride + gx] || 0;
      return [x, y, z];
    };

    const getN = (gx, gz) => {
      const hL = t.heights[gz * stride + Math.max(0, gx - 1)] || 0;
      const hR = t.heights[gz * stride + Math.min(res, gx + 1)] || 0;
      const hD = t.heights[Math.max(0, gz - 1) * stride + gx] || 0;
      const hU = t.heights[Math.min(res, gz + 1) * stride + gx] || 0;
      const step = (gSize / res) * 2;
      let nx = hL - hR;
      let ny = step;
      let nz = hD - hU;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    };

    const pos = [];
    const norm = [];
    for (let gz = 0; gz < res; gz++) {
      for (let gx = 0; gx < res; gx++) {
        const v00 = getV(gx, gz), v10 = getV(gx + 1, gz);
        const v01 = getV(gx, gz + 1), v11 = getV(gx + 1, gz + 1);
        const n00 = getN(gx, gz), n10 = getN(gx + 1, gz);
        const n01 = getN(gx, gz + 1), n11 = getN(gx + 1, gz + 1);

        pos.push(...v00, ...v01, ...v11, ...v00, ...v11, ...v10);
        norm.push(...n00, ...n01, ...n11, ...n00, ...n11, ...n10);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.terrain.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.terrain.normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norm), gl.DYNAMIC_DRAW);
    this.meshes.terrain.count = pos.length / 3;
    t._dirty = false;
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("mousedown", (e) => {
      this.dragging = true;
      this.dragButton = e.button;
      this.dragMoved = false;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (e.button === 0 && this.sculptMode.active && this.callbacks.onSculptTerrain) {
        const rect = c.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        const hit = this._rayToGround(nx, ny);
        if (hit) this.callbacks.onSculptTerrain(hit[0], hit[2]);
      }
    });
    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });
    window.addEventListener("mousemove", (e) => {
      const rect = c.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      if (this.buildMode.active || this.sculptMode.active) {
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.buildMode.hoverX = Math.round(hit[0] * 2) / 2;
          this.buildMode.hoverZ = Math.round(hit[2] * 2) / 2;
          this.buildMode.hoverValid = true;
          if (this.dragging && this.dragButton === 0 && this.sculptMode.active && this.callbacks.onSculptTerrain) {
            this.callbacks.onSculptTerrain(hit[0], hit[2]);
            return;
          }
        }
      }

      if (!this.dragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (this.dragButton === 2 || e.shiftKey) {
        const scale = this.camera.dist * 0.0018;
        const cosY = Math.cos(this.camera.yaw);
        const sinY = Math.sin(this.camera.yaw);
        this.camera.targetX -= (dx * cosY + dy * sinY) * scale;
        this.camera.targetZ -= (-dx * sinY + dy * cosY) * scale;
      } else if (!this.sculptMode.active) {
        this.camera.yaw -= dx * 0.0075;
        this.camera.pitch = Math.max(0.16, Math.min(1.42, this.camera.pitch + dy * 0.0065));
      }
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.dist = Math.max(9, Math.min(105, this.camera.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });

    c.addEventListener("click", (e) => {
      if (this.dragMoved || this.sculptMode.active) return;
      const rect = c.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      if (this.buildMode.active && this.callbacks.onPlaceBuilding) {
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.callbacks.onPlaceBuilding({
            type: this.buildMode.type,
            x: Math.round(hit[0] * 2) / 2,
            z: Math.round(hit[2] * 2) / 2,
            rot: this.buildMode.rot,
          });
        }
        return;
      }

      const picked = this._pickObject(nx, ny);
      this.selectedId = picked ? picked.id : null;
      if (this.callbacks.onSelect) {
        this.callbacks.onSelect(picked);
      }
    });
  }

  setCameraPreset(preset) {
    if (preset === "iso") {
      this.camera = { yaw: 0.65, pitch: 0.56, dist: 42, targetX: 0, targetZ: 0 };
    } else if (preset === "top") {
      this.camera = { yaw: 0.01, pitch: 1.38, dist: 50, targetX: 0, targetZ: 0 };
    } else if (preset === "ar") {
      this.camera = { yaw: 0.35, pitch: 0.22, dist: 20, targetX: -2, targetZ: -2 };
    }
  }

  _getEye() {
    const { yaw, pitch, dist, targetX, targetZ } = this.camera;
    return [
      targetX + Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      targetZ + Math.cos(yaw) * Math.cos(pitch) * dist,
    ];
  }

  _getMatrices() {
    const w = this.canvas.width || 800;
    const h = this.canvas.height || 500;
    const proj = mat4Perspective((45 * Math.PI) / 180, w / h, 0.5, 240);
    const eye = this._getEye();
    const view = mat4LookAt(eye, [this.camera.targetX, 0.8, this.camera.targetZ], [0, 1, 0]);
    return { proj, view, eye };
  }

  _invert4(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
    inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
    inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
    inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
    inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
    inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
    inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
    inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
    inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
    inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
    inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
    inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
    inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
    inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
    inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
    inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
    let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
    if (Math.abs(det) < 1e-8) return null;
    det = 1 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  }

  _screenRay(nx, ny) {
    const { proj, view, eye } = this._getMatrices();
    const vp = mat4Mul(proj, view);
    const inv = this._invert4(vp);
    if (!inv) return null;

    const mulPt = (x, y, z) => {
      const rx = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
      const ry = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
      const rz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
      const rw = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
      return [rx / rw, ry / rw, rz / rw];
    };
    const far = mulPt(nx, ny, 1);
    let dx = far[0] - eye[0], dy = far[1] - eye[1], dz = far[2] - eye[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return { origin: eye, dir: [dx / len, dy / len, dz / len] };
  }

  _rayToGround(nx, ny) {
    const ray = this._screenRay(nx, ny);
    if (!ray || Math.abs(ray.dir[1]) < 1e-4) return null;
    const t = -ray.origin[1] / ray.dir[1];
    if (t < 0) return null;
    return [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
  }

  _pickObject(nx, ny) {
    const ray = this._screenRay(nx, ny);
    if (!ray) return null;
    let best = null;
    let bestDist = Infinity;

    for (const box of this.hitBoxes) {
      const min = [box.x - box.w / 2, box.y0, box.z - box.d / 2];
      const max = [box.x + box.w / 2, box.y1, box.z + box.d / 2];
      let tmin = -Infinity, tmax = Infinity;
      for (let i = 0; i < 3; i++) {
        const invD = 1 / (Math.abs(ray.dir[i]) < 1e-6 ? 1e-6 : ray.dir[i]);
        let t0 = (min[i] - ray.origin[i]) * invD;
        let t1 = (max[i] - ray.origin[i]) * invD;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);
      }
      if (tmax >= Math.max(0, tmin) && tmin < bestDist) {
        bestDist = tmin;
        best = box;
      }
    }
    return best;
  }

  _projectPoint(vp, x, y, z, w, h) {
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (cw <= 0.1) return null;
    return {
      x: ((cx / cw) * 0.5 + 0.5) * w,
      y: ((-cy / cw) * 0.5 + 0.5) * h,
    };
  }

  render(state, forecastSnapshot, dt = 0.016) {
    this.elapsed += dt;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const targetW = Math.max(300, Math.round(rect.width * dpr));
    const targetH = Math.max(200, Math.round(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    if (!this.gl) {
      this._render2DFallback(state);
      return [];
    }

    const gl = this.gl;
    const sun = computeSunPosition(state.farm.location.lat, state.simulation.hourOfDay);
    const rainMm = state.weather.current.rainMm || 0;
    const sky = sun.isDay
      ? lerpColor([0.24, 0.36, 0.48], [0.48, 0.74, 0.94], sun.intensity * (rainMm > 1 ? 0.45 : 1))
      : [0.05, 0.08, 0.14];

    gl.viewport(0, 0, targetW, targetH);
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.prog);
    const { proj, view } = this._getMatrices();
    gl.uniformMatrix4fv(this.locs.uProj, false, proj);
    gl.uniformMatrix4fv(this.locs.uView, false, view);
    gl.uniform3fv(this.locs.uSunDir, new Float32Array([sun.x, sun.y, sun.z]));
    gl.uniform1f(this.locs.uSunInt, sun.intensity);
    gl.uniform3fv(this.locs.uSkyColor, new Float32Array(sky));
    gl.uniform1f(this.locs.uTime, this.elapsed);

    const drawMesh = (meshName, x, y, z, rx, ry, rz, sx, sy, sz, rgba, emissive = 0, matType = 0) => {
      const m = this.meshes[meshName];
      if (!m || !m.count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf);
      gl.vertexAttribPointer(this.locs.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locs.aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.normBuf);
      gl.vertexAttribPointer(this.locs.aNorm, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locs.aNorm);

      gl.uniformMatrix4fv(this.locs.uModel, false, mat4Transform(x, y, z, rx, ry, rz, sx, sy, sz));
      gl.uniform4fv(this.locs.uColor, new Float32Array(rgba));
      gl.uniform1f(this.locs.uEmissive, emissive);
      gl.uniform1f(this.locs.uMatType, matType);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    };

    // Reconstruction du maillage de relief 3D si modifie
    const tKey = `${state.farm.presetId}_${state.terrain?.presetId}_${state.terrain?.heights?.[0]}`;
    if (!this.meshes.terrain.count || state.terrain?._dirty || this.terrainCacheKey !== tKey) {
      this._rebuildTerrainMesh(state);
      this.terrainCacheKey = tKey;
    }

    // Rendu du Terrain 3D avec denivele reel
    drawMesh("terrain", 0, 0, 0, 0, 0, 0, 1, 1, 1, [0.27, 0.46, 0.22, 1], 0, 1.0);

    const H = (x, z) => getTerrainHeight(state, x, z);

    this.hitBoxes = [];
    this.arPins = [];
    const vp = mat4Mul(proj, view);
    const cssW = rect.width;
    const cssH = rect.height;

    const addArPin = (id, label, x, y, z, warn = false) => {
      const pt = this._projectPoint(vp, x, y, z, cssW, cssH);
      if (pt && pt.x > 0 && pt.x < cssW && pt.y > 0 && pt.y < cssH) {
        this.arPins.push({ id, label, x: pt.x, y: pt.y, warn });
      }
    };

    const snapMap = new Map((forecastSnapshot?.plotSnapshots || []).map((s) => [s.id, s]));
    const opaquePlots = state.plots.filter((p) => p.zone !== "Serre");
    const ghPlots = state.plots.filter((p) => p.zone === "Serre");

    const getPlotTint = (p, snap) => {
      const moist = snap?.moisturePct ?? p.moisturePct;
      const health = snap?.healthPct ?? p.healthPct;
      const risk = snap?.diseaseRisk ?? p.diseaseRisk;
      if (this.overlay === "moisture") {
        return moist < 35 ? [0.92, 0.32, 0.22] : moist < 60 ? [0.28, 0.78, 0.38] : [0.14, 0.58, 0.95];
      }
      if (this.overlay === "health") {
        return health > 82 ? [0.16, 0.82, 0.36] : health > 65 ? [0.9, 0.72, 0.2] : [0.9, 0.25, 0.25];
      }
      if (this.overlay === "disease") {
        return risk > 50 ? [0.95, 0.22, 0.35] : risk > 25 ? [0.95, 0.65, 0.15] : [0.22, 0.75, 0.45];
      }
      return null;
    };

    // --- Rendu detaille de chaque culture en 3D selon son espece ---
    const drawPlotRealistic = (p, snap) => {
      const w = p.w || 7, d = p.d || 2.3, rot = p.rot || 0;
      const baseY = H(p.x, p.z);
      const progress = Math.max(0.15, (snap?.progressPct ?? 55) / 100);
      const tint = getPlotTint(p, snap);
      const crop = getCropById(p.cropId);
      const shape = crop.shape || "leafy_head";
      const isSelected = this.selectedId === p.id;

      // Butte / Planche de terre brune humide ou seche
      const moistRatio = (snap?.moisturePct ?? p.moisturePct) / 100;
      const soilRgb = tint || lerpColor([0.46, 0.33, 0.22], [0.26, 0.17, 0.11], moistRatio);
      drawMesh("box", p.x, baseY - 0.05, p.z, 0, rot, 0, w, 0.26, d, [...soilRgb, 1], isSelected ? 0.35 : 0, 0);

      const nCols = 6;
      const nRows = p.zone === "Serre" ? 3 : 3;

      for (let r = 0; r < nRows; r++) {
        const localZ = ((r + 0.5) / nRows - 0.5) * (d * 0.76);
        for (let c = 0; c < nCols; c++) {
          const localX = ((c + 0.5) / nCols - 0.5) * (w * 0.84);
          const wx = p.x + Math.cos(rot) * localX + Math.sin(rot) * localZ;
          const wz = p.z - Math.sin(rot) * localX + Math.cos(rot) * localZ;
          const py = H(wx, wz) + 0.21;

          if (tint) {
            drawMesh("box", wx, py, wz, 0, rot, 0, 0.5, 0.55 * progress, 0.45, [...tint, 1], 0, 4.0);
            continue;
          }

          if (shape === "staked_fruit") {
            // Tomate sur tuteur bois + feuillage + fruits rouges
            const hPlant = (0.5 + progress * 1.15);
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.07, hPlant + 0.2, 0.07, [0.55, 0.38, 0.22, 1]);
            drawMesh("cone", wx, py + 0.1, wz, 0, c, 0, 0.58, hPlant, 0.58, [0.16, 0.58, 0.22, 1], 0, 4.0);
            if (progress > 0.45) {
              drawMesh("box", wx + 0.14, py + hPlant * 0.55, wz + 0.1, 0, 0, 0, 0.15, 0.15, 0.15, [0.92, 0.18, 0.15, 1], 0.1);
              drawMesh("box", wx - 0.12, py + hPlant * 0.35, wz - 0.08, 0, 0, 0, 0.14, 0.14, 0.14, [0.95, 0.28, 0.12, 1], 0.1);
            }
          } else if (shape === "tall_corn") {
            // Mais haut + feuilles + epi jaune
            const hCorn = 0.45 + progress * 1.35;
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.12, hCorn, 0.12, [0.22, 0.62, 0.24, 1], 0, 4.0);
            drawMesh("box", wx, py + hCorn * 0.45, wz, 0, c + r, 0.3, 0.65, 0.1, 0.18, [0.26, 0.68, 0.25, 1], 0, 4.0);
            if (progress > 0.5) {
              drawMesh("cyl", wx + 0.09, py + hCorn * 0.55, wz, 0, 0, -0.25, 0.13, 0.28, 0.13, [0.98, 0.82, 0.16, 1], 0.08);
            }
          } else if (shape === "sunflower") {
            // Tournesol : haute tige + disque floral jaune et coeur brun
            const hSun = 0.4 + progress * 1.2;
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.1, hSun, 0.1, [0.2, 0.58, 0.22, 1]);
            if (progress > 0.4) {
              drawMesh("cyl", wx, py + hSun, wz, 0.4, 0, 0, 0.48, 0.08, 0.48, [0.98, 0.8, 0.1, 1], 0.15);
              drawMesh("cyl", wx, py + hSun + 0.03, wz + 0.02, 0.4, 0, 0, 0.24, 0.09, 0.24, [0.32, 0.18, 0.08, 1]);
            }
          } else if (shape === "wheat_golden") {
            // Ble dore dense
            const hW = 0.3 + progress * 0.65;
            const colW = lerpColor([0.32, 0.68, 0.24], [0.92, 0.76, 0.22], progress);
            drawMesh("box", wx, py, wz, 0, rot, Math.sin(this.elapsed * 2 + c) * 0.06, 0.85, hW, 0.48, [...colW, 1], 0, 4.0);
          } else if (shape === "root_top") {
            // Carotte / Radis : collet orange/rouge + fanes dressees
            const rootCol = crop.id === "radis" ? [0.92, 0.2, 0.35, 1] : [0.96, 0.48, 0.12, 1];
            drawMesh("cyl", wx, py - 0.04, wz, 0, 0, 0, 0.18, 0.14, 0.18, rootCol);
            drawMesh("cone", wx, py + 0.08, wz, 0, c, 0, 0.38, 0.25 + progress * 0.25, 0.38, [0.2, 0.72, 0.28, 1], 0, 4.0);
          } else if (shape === "allium") {
            // Poireau / Oignon : fut blanc + feuilles dressees vert-bleute
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.16, 0.22, 0.16, [0.92, 0.94, 0.88, 1]);
            drawMesh("cone", wx, py + 0.2, wz, 0, 0, 0, 0.32, 0.35 + progress * 0.3, 0.32, [0.14, 0.56, 0.42, 1], 0, 4.0);
          } else if (shape === "berry_mound") {
            // Fraises sur paillage + fruits rouges
            drawMesh("box", wx, py, wz, 0, rot, 0, 0.48, 0.24, 0.44, [0.18, 0.62, 0.24, 1], 0, 4.0);
            drawMesh("box", wx + 0.12, py + 0.18, wz + 0.08, 0, 0, 0, 0.11, 0.11, 0.11, [0.92, 0.12, 0.22, 1], 0.12);
          } else if (shape === "trellis_vine") {
            // Vigne palissee sur piquets + grappes violettes
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.09, 1.15, 0.09, [0.45, 0.3, 0.18, 1]);
            drawMesh("box", wx, py + 0.45, wz, 0, rot, 0, 0.9, 0.55, 0.32, [0.18, 0.58, 0.22, 1], 0, 4.0);
            if (progress > 0.45) {
              drawMesh("box", wx + 0.1, py + 0.35, wz + 0.14, 0, 0, 0, 0.14, 0.2, 0.14, [0.46, 0.18, 0.68, 1], 0.08);
            }
          } else if (shape === "sprawling_squash") {
            // Courgette : larges feuilles + fleurs jaunes + courgettes
            drawMesh("box", wx, py, wz, 0, c * 0.7, 0, 0.68, 0.28, 0.62, [0.16, 0.56, 0.22, 1], 0, 4.0);
            drawMesh("box", wx + 0.15, py + 0.26, wz, 0, 0, 0, 0.14, 0.12, 0.14, [0.98, 0.82, 0.12, 1], 0.1);
          } else {
            // Laitue / Chou / Epinard : pommes rondes bien distinctes
            const headCol = crop.id === "chou" ? [0.16, 0.54, 0.32, 1] : [0.45, 0.82, 0.22, 1];
            const sz = 0.28 + progress * 0.26;
            drawMesh("cyl", wx, py, wz, 0, c, 0, sz * 1.35, sz * 0.9, sz * 1.35, headCol, 0, 4.0);
          }
        }
      }

      // Gouttes / aspersion d'irrigation
      if (p.irrigationValveOpen) {
        for (let k = -2; k <= 2; k++) {
          const pulse = (this.elapsed * 2.5 + k * 0.2) % 1;
          const lx = k * (w * 0.18);
          const wx = p.x + Math.cos(rot) * lx;
          const wz = p.z - Math.sin(rot) * lx;
          drawMesh("cyl", wx, H(wx, wz) + 0.4 + pulse * 0.75, wz, 0, 0, 0, 0.14, 0.28, 0.14, [0.22, 0.8, 1.0, 0.85], 0.35);
        }
      }

      this.hitBoxes.push({ kind: "plot", id: p.id, label: p.name, x: p.x, z: p.z, w, d, y0: baseY, y1: baseY + (p.zone === "Serre" ? 3.4 : 1.8), data: p });
      addArPin(
        p.id,
        `${crop.icon} ${p.id} · ${snap?.moisturePct ?? p.moisturePct}% eau · ${snap?.progressPct ?? 55}%`,
        p.x,
        baseY + (p.zone === "Serre" ? 3.5 : 1.6),
        p.z,
        (snap?.moisturePct ?? p.moisturePct) < 38 || (snap?.diseaseRisk ?? p.diseaseRisk) > 45
      );
    };

    opaquePlots.forEach((p) => drawPlotRealistic(p, snapMap.get(p.id)));
    ghPlots.forEach((p) => drawPlotRealistic(p, snapMap.get(p.id)));

    // --- Rendu anatomique 3D des differentes especes d'animaux ---
    const drawAnimal3D = (speciesId, ax, az, yaw, animPhase) => {
      const ay = H(ax, az);
      const legSwing = Math.sin(animPhase) * 0.22;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const off = (lx, lz) => [ax + cosY * lx + sinY * lz, az - sinY * lx + cosY * lz];

      if (speciesId === "bovin_lait" || speciesId === "bovin_viande") {
        const isDairy = speciesId === "bovin_lait";
        const bodyCol = isDairy ? [0.95, 0.95, 0.93, 1] : [0.76, 0.52, 0.32, 1];
        // Corps principal
        drawMesh("box", ax, ay + 0.38, az, 0, yaw, 0, 0.72, 0.62, 1.38, bodyCol);
        if (isDairy) {
          // Taches pie-noir sur le dos
          drawMesh("box", ax, ay + 0.68, az - 0.15, 0, yaw, 0, 0.74, 0.34, 0.55, [0.14, 0.15, 0.17, 1]);
          drawMesh("box", ax, ay + 0.55, az + 0.32, 0, yaw, 0, 0.74, 0.32, 0.42, [0.14, 0.15, 0.17, 1]);
        }
        // Tete + museau rose + cornes
        const [hx, hz] = off(0, 0.82);
        drawMesh("box", hx, ay + 0.62, hz, 0.15, yaw, 0, 0.46, 0.44, 0.48, isDairy ? [0.16, 0.16, 0.18, 1] : bodyCol);
        const [mx, mz] = off(0, 1.06);
        drawMesh("box", mx, ay + 0.58, mz, 0, yaw, 0, 0.36, 0.22, 0.16, [0.94, 0.72, 0.72, 1]);
        drawMesh("box", hx, ay + 1.04, hz, 0, yaw, 0, 0.68, 0.1, 0.1, [0.92, 0.88, 0.76, 1]);
        // 4 pattes
        for (const [lx, lz, s] of [[-0.24, 0.46, 1], [0.24, 0.46, -1], [-0.24, -0.46, -1], [0.24, -0.46, 1]]) {
          const [px, pz] = off(lx, lz);
          drawMesh("box", px, ay, pz, legSwing * s, yaw, 0, 0.15, 0.42, 0.15, bodyCol);
        }
      } else if (speciesId === "ovin") {
        // Mouton / Brebis : toison laineuse bouffante + tete sombre
        drawMesh("box", ax, ay + 0.24, az, 0, yaw, 0, 0.58, 0.48, 0.86, [0.95, 0.93, 0.86, 1]);
        const [hx, hz] = off(0, 0.52);
        drawMesh("box", hx, ay + 0.38, hz, 0.2, yaw, 0, 0.3, 0.28, 0.34, [0.22, 0.2, 0.19, 1]);
        for (const [lx, lz] of [[-0.18, 0.28], [0.18, 0.28], [-0.18, -0.28], [0.18, -0.28]]) {
          const [px, pz] = off(lx, lz);
          drawMesh("box", px, ay, pz, 0, yaw, 0, 0.1, 0.28, 0.1, [0.22, 0.2, 0.19, 1]);
        }
      } else if (speciesId === "caprin") {
        // Chevre chamoisee + cornes dressees
        drawMesh("box", ax, ay + 0.28, az, 0, yaw, 0, 0.42, 0.44, 0.82, [0.64, 0.45, 0.28, 1]);
        const [hx, hz] = off(0, 0.5);
        drawMesh("box", hx, ay + 0.52, hz, 0, yaw, 0, 0.26, 0.32, 0.3, [0.52, 0.36, 0.22, 1]);
        drawMesh("box", hx, ay + 0.82, hz - 0.05, -0.35, yaw, 0, 0.24, 0.26, 0.07, [0.25, 0.22, 0.2, 1]);
      } else if (speciesId === "porcin") {
        // Cochon rose/bicolore + groin
        drawMesh("box", ax, ay + 0.18, az, 0, yaw, 0, 0.54, 0.44, 0.86, [0.95, 0.68, 0.68, 1]);
        const [hx, hz] = off(0, 0.5);
        drawMesh("box", hx, ay + 0.22, hz, 0, yaw, 0, 0.38, 0.34, 0.32, [0.96, 0.62, 0.64, 1]);
      } else if (speciesId === "equin") {
        // Cheval de trait
        drawMesh("box", ax, ay + 0.52, az, 0, yaw, 0, 0.68, 0.62, 1.42, [0.46, 0.28, 0.16, 1]);
        const [hx, hz] = off(0, 0.78);
        drawMesh("box", hx, ay + 0.88, hz, 0.35, yaw, 0, 0.34, 0.62, 0.42, [0.42, 0.24, 0.14, 1]);
        for (const [lx, lz] of [[-0.22, 0.5], [0.22, 0.5], [-0.22, -0.5], [0.22, -0.5]]) {
          const [px, pz] = off(lx, lz);
          drawMesh("box", px, ay, pz, 0, yaw, 0, 0.14, 0.55, 0.14, [0.36, 0.2, 0.12, 1]);
        }
      } else if (speciesId === "canard") {
        // Canard coureur indien dresse + bec orange
        drawMesh("cyl", ax, ay + 0.08, az, -0.25, yaw, 0, 0.24, 0.42, 0.28, [0.88, 0.84, 0.72, 1]);
        const [hx, hz] = off(0, 0.14);
        drawMesh("cyl", hx, ay + 0.44, hz, 0, yaw, 0, 0.16, 0.22, 0.16, [0.16, 0.46, 0.32, 1]);
        const [bx, bz] = off(0, 0.26);
        drawMesh("box", bx, ay + 0.52, bz, 0, yaw, 0, 0.1, 0.07, 0.18, [0.98, 0.58, 0.12, 1]);
      } else {
        // Poule pondeuse rousse/blanche + crete rouge + picorage
        const peck = Math.max(0, Math.sin(animPhase * 2.5)) * 0.25;
        drawMesh("box", ax, ay + 0.1, az, peck, yaw, 0, 0.28, 0.26, 0.38, [0.84, 0.42, 0.18, 1]);
        const [hx, hz] = off(0, 0.2);
        drawMesh("box", hx, ay + 0.28 - peck * 0.2, hz, 0, yaw, 0, 0.16, 0.18, 0.18, [0.86, 0.44, 0.2, 1]);
        drawMesh("box", hx, ay + 0.44 - peck * 0.2, hz, 0, yaw, 0, 0.06, 0.09, 0.12, [0.92, 0.12, 0.15, 1]);
      }
    };

    // --- Rendu des Batiments, Corps de Ferme, Haies, Chemins & Riviere ---
    const windSpeed = state.weather.current.windKmh || 12;
    for (const s of state.structures) {
      const isSel = this.selectedId === s.id;
      const em = isSel ? 0.35 : 0;
      const w = s.w || 3, d = s.d || 3, h = s.h || 2.5, rot = s.rot || 0;
      const sy = H(s.x, s.z);

      if (s.type === "farmhouse_courtyard") {
        // Corps de ferme traditionnel en U : aile principale nord + 2 ailes laterales + cour gravier + toit tuiles + cheminee
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w, 0.12, d, [0.76, 0.68, 0.54, 1], 0);
        // Corps principal
        drawMesh("box", s.x, sy + 0.1, s.z - d * 0.26, 0, rot, 0, w, h * 0.68, d * 0.42, [0.85, 0.78, 0.68, 1], em, 3.0);
        drawMesh("roof", s.x, sy + 0.1 + h * 0.68, s.z - d * 0.26, 0, rot, 0, w + 0.4, h * 0.38, d * 0.46, [0.74, 0.3, 0.18, 1], em, 3.0);
        // Cheminee pierre
        drawMesh("box", s.x - w * 0.28, sy + h * 0.7, s.z - d * 0.26, 0, rot, 0, 0.65, h * 0.45, 0.65, [0.68, 0.58, 0.48, 1], 0, 3.0);
        // Aile gauche & droite
        drawMesh("box", s.x - w * 0.36, sy + 0.1, s.z + d * 0.15, 0, rot, 0, w * 0.26, h * 0.54, d * 0.58, [0.82, 0.75, 0.65, 1], em, 3.0);
        drawMesh("roof", s.x - w * 0.36, sy + 0.1 + h * 0.54, s.z + d * 0.15, 0, rot + Math.PI / 2, 0, d * 0.62, h * 0.3, w * 0.3, [0.74, 0.3, 0.18, 1], em, 3.0);
        drawMesh("box", s.x + w * 0.36, sy + 0.1, s.z + d * 0.15, 0, rot, 0, w * 0.26, h * 0.54, d * 0.58, [0.82, 0.75, 0.65, 1], em, 3.0);
        drawMesh("roof", s.x + w * 0.36, sy + 0.1 + h * 0.54, s.z + d * 0.15, 0, rot + Math.PI / 2, 0, d * 0.62, h * 0.3, w * 0.3, [0.74, 0.3, 0.18, 1], em, 3.0);
        // Fenetres illuminees
        const winEm = sun.isDay ? 0.15 : 0.65;
        for (let k = -2; k <= 2; k++) {
          drawMesh("box", s.x + k * 1.6, sy + 1.8, s.z - d * 0.04, 0, rot, 0, 0.65, 0.85, 0.08, [0.98, 0.85, 0.45, 1], winEm);
        }
      } else if (s.type === "farm_house" || s.type === "stone_barn") {
        const wallCol = s.type === "stone_barn" ? [0.74, 0.67, 0.58, 1] : [0.88, 0.82, 0.72, 1];
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w, h * 0.68, d, wallCol, em, 3.0);
        drawMesh("roof", s.x, sy + h * 0.68, s.z, 0, rot, 0, w + 0.35, h * 0.38, d + 0.35, [0.72, 0.29, 0.18, 1], em, 3.0);
        // Grande porte grange en bois
        drawMesh("box", s.x, sy, s.z + d * 0.51, 0, rot, 0, w * 0.32, h * 0.5, 0.1, [0.42, 0.26, 0.14, 1], 0);
      } else if (s.type === "farm_shop") {
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w, h * 0.72, d, [0.92, 0.85, 0.7, 1], em, 3.0);
        drawMesh("roof", s.x, sy + h * 0.72, s.z, 0, rot, 0, w + 0.3, h * 0.32, d + 0.3, [0.78, 0.26, 0.18, 1], em);
        // Auvent + etals de legumes colores
        drawMesh("box", s.x, sy + 1.65, s.z + d * 0.62, 0.25, rot, 0, w * 0.9, 0.12, 1.2, [0.92, 0.22, 0.22, 1], 0.15);
        drawMesh("box", s.x - 1.0, sy, s.z + d * 0.65, 0, rot, 0, 1.2, 0.75, 0.7, [0.22, 0.78, 0.32, 1], 0.1);
        drawMesh("box", s.x + 1.0, sy, s.z + d * 0.65, 0, rot, 0, 1.2, 0.75, 0.7, [0.95, 0.38, 0.16, 1], 0.1);
      } else if (s.type === "grain_silo") {
        drawMesh("cyl", s.x, sy, s.z, 0, 0, 0, w, h * 0.78, d, [0.78, 0.83, 0.88, 1], em, 5.0);
        drawMesh("cone", s.x, sy + h * 0.78, s.z, 0, 0, 0, w * 1.06, h * 0.24, d * 1.06, [0.64, 0.7, 0.76, 1], em, 5.0);
      } else if (s.type === "hangar" || s.type === "barn_livestock") {
        const wallCol = s.type === "hangar" ? [0.42, 0.49, 0.56, 1] : [0.72, 0.65, 0.54, 1];
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w, h * 0.7, d, wallCol, em, 3.0);
        drawMesh("roof", s.x, sy + h * 0.7, s.z, 0, rot, 0, w + 0.3, h * 0.42, d + 0.3, [0.58, 0.24, 0.2, 1], em, 3.0);
      } else if (s.type === "coop_mobile" || s.type === "coop_fixed") {
        drawMesh("box", s.x, sy + 0.2, s.z, 0, rot, 0, w, h * 0.65, d, [0.88, 0.58, 0.22, 1], em, 3.0);
        drawMesh("roof", s.x, sy + 0.2 + h * 0.65, s.z, 0, rot, 0, w + 0.25, h * 0.4, d + 0.25, [0.74, 0.26, 0.16, 1], em, 3.0);
        drawMesh("box", s.x, sy + 0.2, s.z + d * 0.51, 0, rot, 0, 0.7, 0.6, 0.1, s.doorOpen ? [0.2, 0.9, 0.4, 1] : [0.9, 0.2, 0.2, 1], 0.25);
      } else if (s.type === "paddock") {
        drawMesh("box", s.x, sy + 0.02, s.z, 0, rot, 0, w, 0.08, d, [0.3, 0.66, 0.28, 1], em, 1.0);
        // Clotures bois tout autour du paddock
        drawMesh("box", s.x, sy + 0.45, s.z + d * 0.49, 0, rot, 0, w, 0.1, 0.1, [0.52, 0.36, 0.2, 1]);
        drawMesh("box", s.x, sy + 0.45, s.z - d * 0.49, 0, rot, 0, w, 0.1, 0.1, [0.52, 0.36, 0.2, 1]);
        drawMesh("box", s.x + w * 0.49, sy + 0.45, s.z, 0, rot, 0, 0.1, 0.1, d, [0.52, 0.36, 0.2, 1]);
        drawMesh("box", s.x - w * 0.49, sy + 0.45, s.z, 0, rot, 0, 0.1, 0.1, d, [0.52, 0.36, 0.2, 1]);
      } else if (s.type === "hedge_row") {
        // Haie bocagere multi-buissons dense
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w, h * 0.75, d, [0.14, 0.46, 0.18, 1], em, 4.0);
        for (let k = -1; k <= 1; k++) {
          const bx = s.x + Math.cos(rot) * k * (w * 0.28);
          const bz = s.z - Math.sin(rot) * k * (w * 0.28);
          drawMesh("cone", bx, H(bx, bz) + h * 0.35, bz, 0, k, 0, d * 1.35, h * 0.75, d * 1.35, [0.16, 0.54, 0.22, 1], em, 4.0);
        }
      } else if (s.type === "hedge_tree") {
        drawMesh("cyl", s.x, sy, s.z, 0, 0, 0, 0.45, 1.5, 0.45, [0.44, 0.28, 0.16, 1], 0);
        drawMesh("cone", s.x, sy + 1.2, s.z, 0, 0, 0, 2.5, 2.2, 2.5, [0.15, 0.54, 0.22, 1], em, 4.0);
        drawMesh("cone", s.x, sy + 2.3, s.z, 0, 0.5, 0, 1.9, 1.8, 1.9, [0.2, 0.62, 0.25, 1], em, 4.0);
      } else if (s.type === "path_dirt" || s.type === "road_paved") {
        const pathCol = s.type === "road_paved" ? [0.44, 0.47, 0.52, 1] : [0.74, 0.62, 0.44, 1];
        drawMesh("box", s.x, sy + 0.02, s.z, 0, rot, 0, w, 0.08, d, pathCol, em, 3.0);
      } else if (s.type === "stone_wall") {
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w, h, d, [0.64, 0.6, 0.55, 1], em, 3.0);
      } else if (s.type === "river_seg") {
        // Riviere avec berges en galets et eau animee
        drawMesh("box", s.x, sy - 0.06, s.z, 0, rot, 0, w + 0.4, 0.14, d + 0.8, [0.58, 0.54, 0.46, 1], 0, 3.0);
        drawMesh("box", s.x, sy + 0.02, s.z, 0, rot, 0, w, 0.14, d, [0.06, 0.52, 0.84, 0.92], em, 2.0);
      } else if (s.type === "bridge") {
        drawMesh("box", s.x, sy + 0.15, s.z, 0, rot, 0, w, 0.35, d, [0.64, 0.56, 0.48, 1], em, 3.0);
        drawMesh("box", s.x - w * 0.44, sy + 0.5, s.z, 0, rot, 0, 0.22, 0.65, d, [0.55, 0.38, 0.22, 1], em);
        drawMesh("box", s.x + w * 0.44, sy + 0.5, s.z, 0, rot, 0, 0.22, 0.65, d, [0.55, 0.38, 0.22, 1], em);
      } else if (s.type === "solar_array") {
        drawMesh("box", s.x, sy, s.z, 0, rot, 0, w * 0.85, 0.9, 0.25, [0.55, 0.6, 0.65, 1], 0);
        drawMesh("box", s.x, sy + 1.0, s.z, 0.48, rot, 0, w, 0.12, d, [0.1, 0.24, 0.58, 1], sun.isDay ? 0.18 + em : em, 5.0);
      } else if (s.type === "wind_turbine") {
        drawMesh("cyl", s.x, sy, s.z, 0, 0, 0, 0.38, h, 0.38, [0.9, 0.94, 0.98, 1], em);
        const spin = this.elapsed * (0.4 + windSpeed * 0.12);
        for (let b = 0; b < 3; b++) {
          const ang = spin + (b * Math.PI * 2) / 3;
          drawMesh("box", s.x, sy + h - 0.2, s.z + 0.35, 0, 0, ang, 0.18, 2.8, 0.08, [0.98, 0.98, 1, 1], 0.1);
        }
      } else if (s.type === "weather_station") {
        drawMesh("cyl", s.x, sy, s.z, 0, 0, 0, 0.18, h, 0.18, [0.78, 0.85, 0.92, 1], em);
        drawMesh("box", s.x, sy + h * 0.55, s.z, 0, 0, 0, 0.55, 0.45, 0.4, [0.96, 0.98, 1, 1], 0.1);
        drawMesh("box", s.x, sy + h - 0.1, s.z, 0, this.elapsed * (0.5 + windSpeed * 0.2), 0, 1.2, 0.1, 0.12, [0.22, 0.78, 0.98, 1], 0.25);
      } else if (s.type === "water_tank" || s.type === "well_pump") {
        drawMesh("cyl", s.x, sy, s.z, 0, 0, 0, w, h, d, [0.12, 0.58, 0.86, 1], em, 5.0);
        drawMesh("cyl", s.x, sy + h, s.z, 0, 0, 0, w * 1.05, 0.25, d * 1.05, [0.08, 0.38, 0.64, 1], 0);
      } else if (s.type === "pond") {
        drawMesh("box", s.x, sy + 0.01, s.z, 0, rot, 0, w + 0.6, 0.14, d + 0.6, [0.46, 0.4, 0.32, 1], 0);
        drawMesh("box", s.x, sy + 0.08, s.z, 0, rot, 0, w, 0.12, d, [0.06, 0.54, 0.86, 0.92], em, 2.0);
      } else if (s.type === "compost") {
        drawMesh("cone", s.x, sy, s.z, 0, rot, 0, w, h, d, [0.36, 0.23, 0.13, 1], em);
      } else if (s.type === "apiary") {
        for (let r = -1; r <= 1; r++) {
          drawMesh("box", s.x + r * 0.95, sy, s.z, 0, rot, 0, 0.65, 0.88, 0.65, [0.96, 0.82, 0.24, 1], em);
          drawMesh("roof", s.x + r * 0.95, sy + 0.88, s.z, 0, rot, 0, 0.75, 0.25, 0.75, [0.7, 0.35, 0.15, 1], em);
        }
      }

      this.hitBoxes.push({ kind: "structure", id: s.id, label: s.label, x: s.x, z: s.z, w, d, y0: sy, y1: sy + Math.max(0.8, h), data: s });
      if (s.type !== "path_dirt" && s.type !== "road_paved" && s.type !== "river_seg") {
        addArPin(s.id, s.label, s.x, sy + h + 0.5, s.z, false);
      }
    }

    // --- Rendu de tous les lots d'animaux en 3D sur la ferme ---
    const coopStruct = state.structures.find((s) => s.type === "coop_mobile" || s.type === "coop_fixed");
    const padStruct = state.structures.find((s) => s.type === "paddock") || state.structures.find((s) => s.type === "barn_livestock");
    const pondStruct = state.structures.find((s) => s.type === "pond");

    state.livestock.forEach((lot, lotIdx) => {
      const spId = lot.speciesId || (lot.kind === "ponte" ? "ponte" : "bovin_lait");
      let centerX = 8 + lotIdx * 2.5;
      let centerZ = 7;
      let spanX = 3.6, spanZ = 2.6;

      if (spId === "ponte" && coopStruct) {
        centerX = coopStruct.x;
        centerZ = coopStruct.z + 2.8;
        spanX = 3.2; spanZ = 2.0;
      } else if (spId === "canard" && pondStruct) {
        centerX = pondStruct.x + 2.8;
        centerZ = pondStruct.z - 1.5;
        spanX = 2.5; spanZ = 2.0;
      } else if (padStruct) {
        centerX = padStruct.x + (lotIdx % 2 === 0 ? -1.8 : 2.2);
        centerZ = padStruct.z + (lotIdx > 2 ? 1.5 : -0.8);
        spanX = 3.8; spanZ = 2.2;
      }

      const visCount = spId === "ponte" ? Math.min(8, Math.max(3, Math.ceil(lot.count / 80))) : Math.min(5, Math.max(2, Math.ceil(lot.count / 12)));
      for (let i = 0; i < visCount; i++) {
        const phase = this.elapsed * (spId === "ponte" || spId === "canard" ? 1.2 : 0.42) + i * 1.9 + lotIdx;
        const ax = centerX + Math.sin(phase * 0.7 + i) * spanX;
        const az = centerZ + Math.cos(phase * 0.5 + i * 1.3) * spanZ;
        const yaw = Math.atan2(Math.cos(phase * 0.7 + i), -Math.sin(phase * 0.5 + i * 1.3));
        drawAnimal3D(spId, ax, az, yaw, phase * 3);
      }

      addArPin(lot.id, `${lot.name} (${lot.count})`, centerX, H(centerX, centerZ) + 1.8, centerZ, false);
    });

    // --- Robots mobiles 3D ---
    for (const eq of state.equipment) {
      if (!eq.autonomous) continue;
      const rx = eq.x ?? 10;
      const rz = eq.z ?? -6;
      const ry = H(rx, rz);
      const isSel = this.selectedId === eq.id;

      if (eq.kind === "drone") {
        const yAlt = ry + (eq.status === "working" ? 4.4 + Math.sin(this.elapsed * 3) * 0.2 : 1.0);
        drawMesh("box", rx, yAlt, rz, 0, this.elapsed * 0.5, 0, 1.1, 0.22, 1.1, [0.18, 0.82, 0.96, 1], 0.35 + (isSel ? 0.3 : 0));
        if (eq.status === "working") {
          drawMesh("cone", rx, ry + 0.1, rz, 0, 0, 0, 2.2, yAlt - ry - 0.1, 2.2, [0.2, 0.95, 0.55, 0.16], 0.4);
        }
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.8, d: 1.8, y0: ry, y1: yAlt + 0.8, data: eq });
        addArPin(eq.id, `🚁 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, yAlt + 0.8, rz, eq.batteryPct < 25);
      } else if (eq.kind === "tractor") {
        drawMesh("box", rx, ry + 0.25, rz, 0, 0, 0, 1.6, 1.1, 2.4, [0.14, 0.65, 0.35, 1], isSel ? 0.35 : 0.1);
        drawMesh("box", rx, ry + 1.35, rz - 0.2, 0, 0, 0, 1.2, 0.9, 1.2, [0.75, 0.9, 0.98, 0.78], 0.15, 5.0);
        // Roues tracteur RTK
        for (const [wx, wz] of [[-0.85, 0.7], [0.85, 0.7], [-0.85, -0.7], [0.85, -0.7]]) {
          drawMesh("cyl", rx + wx, ry, rz + wz, 0, 0, Math.PI / 2, 0.7, 0.28, 0.7, [0.15, 0.16, 0.18, 1]);
        }
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 2.0, d: 2.6, y0: ry, y1: ry + 2.5, data: eq });
        addArPin(eq.id, `🚜 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, ry + 2.6, rz, eq.batteryPct < 25);
      } else {
        drawMesh("box", rx, ry + 0.15, rz, 0, 0, 0, 1.1, 0.45, 1.2, [0.95, 0.65, 0.15, 1], isSel ? 0.35 : 0.15);
        drawMesh("box", rx, ry + 0.62, rz, 0, 0, 0, 1.05, 0.08, 1.05, [0.1, 0.25, 0.55, 1], 0.2, 5.0);
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.5, d: 1.5, y0: ry, y1: ry + 1.4, data: eq });
        addArPin(eq.id, `🤖 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, ry + 1.3, rz, eq.batteryPct < 25);
      }
    }

    // --- Calque Flux Energie & Eau ---
    if (this.overlay === "energy") {
      const solar = state.structures.find((s) => s.type === "solar_array");
      const tank = state.structures.find((s) => s.type === "water_tank");
      if (solar) {
        ghPlots.forEach((g) => {
          const mx = (solar.x + g.x) / 2, mz = (solar.z + g.z) / 2;
          const dist = Math.hypot(g.x - solar.x, g.z - solar.z);
          const ang = Math.atan2(g.x - solar.x, g.z - solar.z);
          drawMesh("box", mx, H(mx, mz) + 2.2, mz, 0, ang, 0, 0.16, 0.16, dist, [0.98, 0.8, 0.16, 0.82], 0.55);
        });
      }
      if (tank) {
        state.plots.forEach((p) => {
          const mx = (tank.x + p.x) / 2, mz = (tank.z + p.z) / 2;
          const dist = Math.hypot(p.x - tank.x, p.z - tank.z);
          const ang = Math.atan2(p.x - tank.x, p.z - tank.z);
          drawMesh("box", mx, H(mx, mz) + 0.5, mz, 0, ang, 0, 0.14, 0.14, dist, [0.16, 0.72, 0.98, 0.78], 0.45);
        });
      }
    }

    // --- Enveloppes translucides des serres (rendues en dernier) ---
    for (const g of ghPlots) {
      const w = g.w || 8.5, d = g.d || 4.2, rot = g.rot || 0;
      const gy = H(g.x, g.z);
      const isSel = this.selectedId === g.id;
      const nightGlow = !sun.isDay ? 0.35 : 0;
      const tint = this.overlay === "disease" && g.diseaseRisk > 35 ? [0.95, 0.35, 0.35, 0.42] : [0.68, 0.9, 0.98, 0.34];
      drawMesh("box", g.x, gy + 0.05, g.z, 0, rot, 0, w, 2.0, d, tint, nightGlow + (isSel ? 0.25 : 0), 5.0);
      const ventTilt = ((g.ventOpeningPct || 20) / 100) * 0.42;
      drawMesh("roof", g.x, gy + 2.05 + ventTilt * 0.4, g.z, ventTilt, rot, 0, w + 0.1, 1.0, d + 0.1, [0.75, 0.92, 1.0, 0.42], nightGlow, 5.0);
    }

    // --- Fantome de construction 3D ou cercle de sculpture du terrain ---
    if (this.sculptMode.active && this.buildMode.hoverValid) {
      const hy = H(this.buildMode.hoverX, this.buildMode.hoverZ);
      const r = this.sculptMode.radius * 2;
      drawMesh("cyl", this.buildMode.hoverX, hy + 0.05, this.buildMode.hoverZ, 0, 0, 0, r, 0.15, r, [0.98, 0.68, 0.16, 0.42], 0.45);
    } else if (this.buildMode.active && this.buildMode.hoverValid) {
      const cat = BUILDING_CATALOG.find((b) => b.type === this.buildMode.type) || BUILDING_CATALOG[0];
      const hy = H(this.buildMode.hoverX, this.buildMode.hoverZ);
      drawMesh("box", this.buildMode.hoverX, hy + 0.04, this.buildMode.hoverZ, 0, this.buildMode.rot, 0, cat.w, cat.h, cat.d, [0.2, 0.95, 0.55, 0.48], 0.4);
    }

    // --- Pluie 3D ---
    if (rainMm > 0.5) {
      const gSize = state.farm.gridSize || 44;
      const drops = Math.min(80, Math.round(rainMm * 6));
      for (let i = 0; i < drops; i++) {
        const px = ((i * 7.3) % gSize) - gSize / 2;
        const pz = ((i * 11.7) % gSize) - gSize / 2;
        const py = 12 - ((this.elapsed * 14 + i * 1.7) % 12);
        drawMesh("box", px, py, pz, 0, 0, 0, 0.05, 0.65, 0.05, [0.55, 0.82, 1.0, 0.6], 0.2);
      }
    }

    return this.arPins;
  }

  _render2DFallback(state) {
    const ctx = this.ctx2d;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = "#10211c";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "14px sans-serif";
    ctx.fillText(`Vue 2D Repli — ${state.farm.name} (${state.plots.length} planches)`, 24, 34);
  }
}
