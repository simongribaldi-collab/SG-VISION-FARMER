import { BUILDING_CATALOG, generateTerrainHeights } from "../data/presets.js";
import { getCropById } from "./predictor.js";
import { computeSunPosition } from "./weather.js";
import {
  buildTerrainAndHorizonMesh,
  createArchRibGeometry,
  createArchTunnelGeometry,
  createBoxGeometry,
  createConeGeometry,
  createCylinderGeometry,
  createLeafClusterGeometry,
  createRoofGeometry,
  createSkyDomeGeometry,
  createSphereGeometry,
  createTurbineBladeGeometry,
  sampleExtendedTerrainHeight,
} from "./geometries3d.js";
import { createShaderProgram, MAIN_FS, MAIN_VS, SHADOW_FS, SHADOW_VS, SKY_FS, SKY_VS } from "./shaders3d.js";

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

function mat4Ortho(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return new Float32Array([
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
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

function mat3NormalFromMat4(m, out) {
  const a00 = m[0], a10 = m[1], a20 = m[2];
  const a01 = m[4], a11 = m[5], a21 = m[6];
  const a02 = m[8], a12 = m[9], a22 = m[10];

  const c00 = a11 * a22 - a12 * a21;
  const c10 = -(a01 * a22 - a02 * a21);
  const c20 = a01 * a12 - a02 * a11;

  const c01 = -(a10 * a22 - a12 * a20);
  const c11 = a00 * a22 - a02 * a20;
  const c21 = -(a00 * a12 - a02 * a10);

  const c02 = a10 * a21 - a11 * a20;
  const c12 = -(a00 * a21 - a01 * a20);
  const c22 = a00 * a11 - a01 * a10;

  let det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-10) {
    out[0] = 1; out[1] = 0; out[2] = 0;
    out[3] = 0; out[4] = 1; out[5] = 0;
    out[6] = 0; out[7] = 0; out[8] = 1;
    return out;
  }
  const invDet = 1 / det;
  out[0] = c00 * invDet; out[1] = c10 * invDet; out[2] = c20 * invDet;
  out[3] = c01 * invDet; out[4] = c11 * invDet; out[5] = c21 * invDet;
  out[6] = c02 * invDet; out[7] = c12 * invDet; out[8] = c22 * invDet;
  return out;
}

function lerpColor(c1, c2, t) {
  const k = Math.max(0, Math.min(1, t));
  return [c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k];
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
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
  t._version = (t._version || 0) + 1;
}

const MAT = {
  DEFAULT: 0,
  TERRAIN: 1,
  WATER: 2,
  STONE: 3,
  TILE: 4,
  FOLIAGE: 5,
  GLASS: 6,
  SOIL: 7,
  WOOD: 8,
  GRAVEL: 9,
  METAL: 10,
  FUR: 11,
};

export class Farm3DEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.camera = { yaw: 0.62, pitch: 0.41, dist: 39, targetX: 0, targetZ: -1.0 };
    this.overlay = "normal";
    this.selectedId = null;
    this.buildMode = { active: false, type: "bed_open", rot: 0, hoverX: 0, hoverZ: 0, hoverValid: false };
    this.sculptMode = { active: false, tool: "raise", radius: 5.0 };
    this.shadowsEnabled = true;
    this.shadowSupported = false;
    this.shadowSize = 1536;
    this.hitBoxes = [];
    this.arPins = [];
    this.elapsed = 0;
    this.dragging = false;
    this.dragButton = 0;
    this.lastMouse = { x: 0, y: 0 };
    this.dragMoved = false;
    this._didSculpt = false;
    this.terrainCacheKey = "";
    this.lastState = null;
    this._normMatBuf = new Float32Array(9);

    this.gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true });
    if (this.gl) {
      this._initWebGL();
    } else {
      this.ctx2d = canvas.getContext("2d");
    }
    this._bindEvents();
  }

  _initWebGL() {
    const gl = this.gl;

    this.skyProg = createShaderProgram(gl, SKY_VS, SKY_FS, "sky");
    this.shadowProg = createShaderProgram(gl, SHADOW_VS, SHADOW_FS, "shadow");
    this.mainProg = createShaderProgram(gl, MAIN_VS, MAIN_FS, "main");

    this.skyLocs = {
      aPos: gl.getAttribLocation(this.skyProg, "aPos"),
      uProj: gl.getUniformLocation(this.skyProg, "uProj"),
      uView: gl.getUniformLocation(this.skyProg, "uView"),
      uSunDir: gl.getUniformLocation(this.skyProg, "uSunDir"),
      uSunInt: gl.getUniformLocation(this.skyProg, "uSunInt"),
      uRain: gl.getUniformLocation(this.skyProg, "uRain"),
      uTime: gl.getUniformLocation(this.skyProg, "uTime"),
    };

    this.shadowLocs = {
      aPos: gl.getAttribLocation(this.shadowProg, "aPos"),
      uLightVP: gl.getUniformLocation(this.shadowProg, "uLightVP"),
      uModel: gl.getUniformLocation(this.shadowProg, "uModel"),
      uTime: gl.getUniformLocation(this.shadowProg, "uTime"),
      uWindAmt: gl.getUniformLocation(this.shadowProg, "uWindAmt"),
    };

    this.mainLocs = {
      aPos: gl.getAttribLocation(this.mainProg, "aPos"),
      aNorm: gl.getAttribLocation(this.mainProg, "aNorm"),
      uProj: gl.getUniformLocation(this.mainProg, "uProj"),
      uView: gl.getUniformLocation(this.mainProg, "uView"),
      uModel: gl.getUniformLocation(this.mainProg, "uModel"),
      uNormalMat: gl.getUniformLocation(this.mainProg, "uNormalMat"),
      uLightVP: gl.getUniformLocation(this.mainProg, "uLightVP"),
      uEyePos: gl.getUniformLocation(this.mainProg, "uEyePos"),
      uColor: gl.getUniformLocation(this.mainProg, "uColor"),
      uSunDir: gl.getUniformLocation(this.mainProg, "uSunDir"),
      uSunColor: gl.getUniformLocation(this.mainProg, "uSunColor"),
      uSunInt: gl.getUniformLocation(this.mainProg, "uSunInt"),
      uSkyColor: gl.getUniformLocation(this.mainProg, "uSkyColor"),
      uHorizonColor: gl.getUniformLocation(this.mainProg, "uHorizonColor"),
      uEmissive: gl.getUniformLocation(this.mainProg, "uEmissive"),
      uMatType: gl.getUniformLocation(this.mainProg, "uMatType"),
      uTime: gl.getUniformLocation(this.mainProg, "uTime"),
      uRain: gl.getUniformLocation(this.mainProg, "uRain"),
      uWindAmt: gl.getUniformLocation(this.mainProg, "uWindAmt"),
      uShadowsEnabled: gl.getUniformLocation(this.mainProg, "uShadowsEnabled"),
      uShadowTexel: gl.getUniformLocation(this.mainProg, "uShadowTexel"),
      uShadowMap: gl.getUniformLocation(this.mainProg, "uShadowMap"),
      uShowContours: gl.getUniformLocation(this.mainProg, "uShowContours"),
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
      cyl: upload(createCylinderGeometry(20)),
      cone: upload(createConeGeometry(18)),
      sphere: upload(createSphereGeometry(12, 18)),
      roof: upload(createRoofGeometry()),
      arch: upload(createArchTunnelGeometry(16)),
      archRib: upload(createArchRibGeometry(16, 0.045)),
      leafCluster: upload(createLeafClusterGeometry()),
      blade: upload(createTurbineBladeGeometry()),
      skyDome: upload(createSkyDomeGeometry(16, 28)),
      terrain: { posBuf: gl.createBuffer(), normBuf: gl.createBuffer(), count: 0 },
      river: { posBuf: gl.createBuffer(), normBuf: gl.createBuffer(), count: 0 },
      riverBed: { posBuf: gl.createBuffer(), normBuf: gl.createBuffer(), count: 0 },
    };

    // Framebuffer d'ombres 1536x1536 (RGBA8 sans extension requise)
    try {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.shadowSize, this.shadowSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.shadowSize, this.shadowSize);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        this.shadowFbo = fbo;
        this.shadowTex = tex;
        this.shadowDepthRb = rb;
        this.shadowSupported = true;
      } else {
        gl.deleteFramebuffer(fbo);
        gl.deleteRenderbuffer(rb);
        gl.deleteTexture(tex);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    } catch {
      this.shadowSupported = false;
    }

    gl.enable(gl.DEPTH_TEST);
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
    const gSize = (state.farm?.gridSize || 44) + 8;
    const geom = buildTerrainAndHorizonMesh(t.heights, res, gSize);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.terrain.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.terrain.normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom.norm, gl.DYNAMIC_DRAW);
    this.meshes.terrain.count = geom.count;
    t._dirty = false;
  }

  _rebuildRiverMesh(state) {
    const gl = this.gl;
    if (!gl) return;
    const rivers = (state.structures || []).filter((s) => s.type === "river_seg");
    if (!rivers.length) {
      this.meshes.river.count = 0;
      this.meshes.riverBed.count = 0;
      return;
    }

    const H = (x, z) => getTerrainHeight(state, x, z);
    const posW = [], normW = [];
    const posB = [], normB = [];

    const emitRibbonStrip = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        // Eau (CCW vers +Y)
        posW.push(
          a.lx, a.wy, a.lz, a.rx, a.wy, a.rz, b.rx, b.wy, b.rz,
          a.lx, a.wy, a.lz, b.rx, b.wy, b.rz, b.lx, b.wy, b.lz
        );
        for (let k = 0; k < 6; k++) normW.push(0, 1, 0);
        // Lit de galets immerge (legerement plus large et plus bas)
        posB.push(
          a.blx, a.by, a.blz, a.brx, a.by, a.brz, b.brx, b.by, b.brz,
          a.blx, a.by, a.blz, b.brx, b.by, b.brz, b.blx, b.by, b.blz
        );
        for (let k = 0; k < 6; k++) normB.push(0, 1, 0);
      }
    };

    const sorted = [...rivers].sort((a, b) => a.x - b.x);
    const isMergedHorizontal =
      sorted.length >= 2 &&
      sorted.every((r) => Math.abs(r.rot || 0) < 0.2) &&
      sorted.every((r, idx) => idx === 0 || Math.abs((r.x - (r.w || 12) * 0.5) - (sorted[idx - 1].x + (sorted[idx - 1].w || 12) * 0.5)) < 4.5);

    if (isMergedHorizontal) {
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const xMin = first.x - (first.w || 12) * 0.5 - 5.5;
      const xMax = last.x + (last.w || 12) * 0.5 + 5.5;
      const steps = 48;
      const sampleCenterZ = (x) => {
        if (x <= first.x) return first.z - Math.sin(first.rot || 0) * (x - first.x);
        if (x >= last.x) return last.z - Math.sin(last.rot || 0) * (x - last.x);
        for (let j = 0; j < sorted.length - 1; j++) {
          const s0 = sorted[j], s1 = sorted[j + 1];
          if (x >= s0.x && x <= s1.x) {
            const u = (x - s0.x) / Math.max(0.01, s1.x - s0.x);
            const su = u * u * (3 - 2 * u);
            return s0.z + (s1.z - s0.z) * su;
          }
        }
        return first.z;
      };
      const avgD = sorted.reduce((acc, r) => acc + (r.d || 3.2), 0) / sorted.length;
      const halfW = avgD * 0.5;
      const raw = [];
      for (let i = 0; i <= steps; i++) {
        const x = xMin + (i / steps) * (xMax - xMin);
        const cz = sampleCenterZ(x);
        const yc = H(x, cz);
        const yCore = Math.max(yc, H(x, cz - halfW * 0.28), H(x, cz + halfW * 0.28));
        const yL = H(x, cz - halfW);
        const yR = H(x, cz + halfW);
        const bankRise = Math.min(yL, yR) - yc;
        const wy = Math.max(yCore + 0.08, bankRise > 0.12 ? yc + Math.min(0.32, bankRise * 0.72) : yc + 0.1);
        const span = bankRise > 0.12 ? halfW * 1.2 : halfW * 1.06;
        raw.push({ x, cz, wy, yc, span });
      }
      // Lissage 3-points pour une pente d'eau parfaitement continue
      const pts = raw.map((p, i) => {
        const prev = raw[Math.max(0, i - 1)];
        const next = raw[Math.min(raw.length - 1, i + 1)];
        const wy = (prev.wy + p.wy * 2 + next.wy) * 0.25;
        return {
          lx: p.x, lz: p.cz - p.span,
          rx: p.x, rz: p.cz + p.span,
          wy,
          blx: p.x, blz: p.cz - p.span * 1.12,
          brx: p.x, brz: p.cz + p.span * 1.12,
          by: wy - 0.18,
        };
      });
      emitRibbonStrip(pts);
    } else {
      for (const s of sorted) {
        const w = s.w || 12, d = s.d || 3.2, rot = s.rot || 0;
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const steps = 12;
        const halfW = d * 0.5;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const lx = (i / steps - 0.5) * w;
          const cx = s.x + cosR * lx;
          const cz = s.z - sinR * lx;
          const yc = H(cx, cz);
          const wy = yc + 0.06;
          const nx = sinR, nz = cosR;
          pts.push({
            lx: cx - nx * halfW, lz: cz - nz * halfW,
            rx: cx + nx * halfW, rz: cz + nz * halfW,
            wy,
            blx: cx - nx * halfW * 1.15, blz: cz - nz * halfW * 1.15,
            brx: cx + nx * halfW * 1.15, brz: cz + nz * halfW * 1.15,
            by: wy - 0.16,
          });
        }
        emitRibbonStrip(pts);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.river.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(posW), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.river.normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normW), gl.DYNAMIC_DRAW);
    this.meshes.river.count = posW.length / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.riverBed.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(posB), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshes.riverBed.normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normB), gl.DYNAMIC_DRAW);
    this.meshes.riverBed.count = posB.length / 3;
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("mousedown", (e) => {
      this.dragging = true;
      this.dragButton = e.button;
      this.dragMoved = false;
      this._didSculpt = false;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (e.button === 0 && this.sculptMode.active && this.callbacks.onSculptTerrain) {
        const rect = c.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.callbacks.onSculptTerrain(hit[0], hit[2]);
          this._didSculpt = true;
        }
      }
    });

    this._onMouseUp = () => {
      this.dragging = false;
      if (this._didSculpt) {
        this._didSculpt = false;
        this.callbacks.onSculptEnd?.();
      }
    };

    this._onMouseMove = (e) => {
      const rect = c.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
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
            this._didSculpt = true;
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
        this.camera.targetX = Math.max(-28, Math.min(28, this.camera.targetX - (dx * cosY + dy * sinY) * scale));
        this.camera.targetZ = Math.max(-28, Math.min(28, this.camera.targetZ - (-dx * sinY + dy * cosY) * scale));
      } else if (!this.sculptMode.active) {
        this.camera.yaw -= dx * 0.0075;
        this.camera.pitch = Math.max(0.12, Math.min(1.42, this.camera.pitch + dy * 0.0065));
      }
    };

    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("mousemove", this._onMouseMove);

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.dist = Math.max(7, Math.min(105, this.camera.dist * (1 + e.deltaY * 0.001)));
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

  destroy() {
    if (this._onMouseUp) window.removeEventListener("mouseup", this._onMouseUp);
    if (this._onMouseMove) window.removeEventListener("mousemove", this._onMouseMove);
    const gl = this.gl;
    if (gl) {
      if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
      if (this.shadowDepthRb) gl.deleteRenderbuffer(this.shadowDepthRb);
      if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    }
  }

  setCameraPreset(preset) {
    if (preset === "iso") {
      this.camera = { yaw: 0.62, pitch: 0.41, dist: 39, targetX: 0, targetZ: -1.0 };
    } else if (preset === "top") {
      this.camera = { yaw: 0.01, pitch: 1.38, dist: 50, targetX: 0, targetZ: 0 };
    } else if (preset === "ar") {
      this.camera = { yaw: 0.35, pitch: 0.21, dist: 19, targetX: -2, targetZ: -1 };
    } else if (preset === "farmhouse") {
      this.camera = { yaw: 0.38, pitch: 0.42, dist: 21, targetX: -1.5, targetZ: -11.5 };
    }
  }

  _getEye() {
    const { yaw, pitch, dist, targetX, targetZ } = this.camera;
    const baseH = this.lastState ? getTerrainHeight(this.lastState, targetX, targetZ) : 0;
    return [
      targetX + Math.sin(yaw) * Math.cos(pitch) * dist,
      baseH + Math.sin(pitch) * dist,
      targetZ + Math.cos(yaw) * Math.cos(pitch) * dist,
    ];
  }

  _getMatrices() {
    const w = this.canvas.width || 800;
    const h = this.canvas.height || 500;
    const proj = mat4Perspective((44 * Math.PI) / 180, w / h, 0.4, 280);
    const eye = this._getEye();
    const baseH = this.lastState ? getTerrainHeight(this.lastState, this.camera.targetX, this.camera.targetZ) : 0;
    const view = mat4LookAt(eye, [this.camera.targetX, baseH + 0.9, this.camera.targetZ], [0, 1, 0]);
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
    if (!ray) return null;
    if (!this.lastState?.terrain?.heights) {
      if (Math.abs(ray.dir[1]) < 1e-4) return null;
      const t = -ray.origin[1] / ray.dir[1];
      if (t < 0) return null;
      return [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
    }

    let tPrev = 0.5;
    for (let i = 1; i <= 60; i++) {
      const t = i * 2.5;
      const px = ray.origin[0] + ray.dir[0] * t;
      const py = ray.origin[1] + ray.dir[1] * t;
      const pz = ray.origin[2] + ray.dir[2] * t;
      const h = getTerrainHeight(this.lastState, px, pz);
      if (py <= h) {
        let lo = tPrev, hi = t;
        for (let b = 0; b < 6; b++) {
          const mid = (lo + hi) * 0.5;
          const mx = ray.origin[0] + ray.dir[0] * mid;
          const my = ray.origin[1] + ray.dir[1] * mid;
          const mz = ray.origin[2] + ray.dir[2] * mid;
          if (my <= getTerrainHeight(this.lastState, mx, mz)) hi = mid;
          else lo = mid;
        }
        const tf = (lo + hi) * 0.5;
        const fx = ray.origin[0] + ray.dir[0] * tf;
        const fz = ray.origin[2] + ray.dir[2] * tf;
        return [fx, getTerrainHeight(this.lastState, fx, fz), fz];
      }
      tPrev = t;
    }

    if (Math.abs(ray.dir[1]) > 1e-4) {
      const t = -ray.origin[1] / ray.dir[1];
      if (t > 0) return [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
    }
    return null;
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
    this.lastState = state;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const targetW = Math.max(300, Math.round((rect.width || 960) * dpr));
    const targetH = Math.max(200, Math.round((rect.height || 580) * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    if (!this.gl) {
      this._render2DFallback(state);
      return [];
    }

    const gl = this.gl;

    // Soleil saisonnier & meteo du jour simule
    const now = new Date();
    const startYear = new Date(now.getFullYear(), 0, 0);
    const baseDoy = Math.floor((now - startYear) / 86400000);
    const dayOffset = state.simulation?.dayOffset || 0;
    const dayOfYear = ((baseDoy + dayOffset - 1) % 365) + 1;
    const sun = computeSunPosition(state.farm?.location?.lat ?? 45, state.simulation?.hourOfDay ?? 10.5, dayOfYear);

    const daySnap = forecastSnapshot?.daily?.[Math.min(dayOffset, Math.max(0, (forecastSnapshot?.daily?.length || 1) - 1))];
    const rainMm = dayOffset > 0 ? (daySnap?.rainMm || 0) : (state.weather?.current?.rainMm || 0);
    const rainAmt = Math.max(0, Math.min(1, rainMm / 8));

    const sLen = Math.hypot(sun.x, sun.y, sun.z) || 1;
    const sunDir = [sun.x / sLen, sun.y / sLen, sun.z / sLen];
    const elSin = Math.sin((sun.elevationDeg * Math.PI) / 180);
    const skySunDirLen = Math.hypot(sunDir[0], elSin, sunDir[2]) || 1;
    const skySunDir = [sunDir[0] / skySunDirLen, elSin / skySunDirLen, sunDir[2] / skySunDirLen];

    const golden = Math.max(0, Math.min(1, 1 - Math.abs(elSin - 0.12) * 3.0)) * (elSin > -0.08 ? 1 : 0);
    const dayAmt = smoothstep(-0.08, 0.25, elSin);
    const skyColor = lerpColor(
      [0.038, 0.06, 0.12],
      lerpColor([0.14, 0.42, 0.80], [0.24, 0.29, 0.36], rainAmt * 0.75),
      dayAmt
    );
    let dayHoriz = lerpColor([0.48, 0.68, 0.88], [0.42, 0.47, 0.52], rainAmt * 0.7);
    dayHoriz = lerpColor(dayHoriz, [0.95, 0.56, 0.30], golden * 0.62 * (1 - rainAmt * 0.65));
    const horizonColor = lerpColor([0.038, 0.06, 0.11], dayHoriz, dayAmt);
    const sunColor = sun.isDay
      ? lerpColor([1.0, 0.54, 0.24], [1.0, 0.97, 0.90], smoothstep(0.03, 0.42, elSin))
      : [0.35, 0.48, 0.74];

    // Reconstruction du maillage de relief 3D et de la riviere si modifies
    const t = state.terrain;
    const hLast = t?.heights ? t.heights[t.heights.length - 1] : 0;
    const hMid = t?.heights ? t.heights[Math.floor(t.heights.length / 2)] : 0;
    const rivKey = (state.structures || []).filter((s) => s.type === "river_seg").map((r) => `${r.x},${r.z},${r.w},${r.d},${r.rot}`).join("|");
    const tKey = `${state.farm.presetId}_${state.farm.gridSize}_${t?.presetId}_${t?._version || 0}_${t?.heights?.[0]}_${hMid}_${hLast}_${rivKey}`;
    if (!this.meshes.terrain.count || t?._dirty || this.terrainCacheKey !== tKey) {
      this._rebuildTerrainMesh(state);
      this._rebuildRiverMesh(state);
      this.terrainCacheKey = tKey;
    }

    // Collecte des appels de rendu dans les files opaque / translucide
    const opaqueQueue = [];
    const transQueue = [];

    const pushItem = (meshName, model, rgba, emissive = 0, matType = 0, opts = {}) => {
      const m = this.meshes[meshName];
      if (!m || !m.count) return;
      const item = {
        meshName,
        mesh: m,
        model,
        rgba,
        emissive,
        matType,
        windAmt: opts.windAmt || 0,
        castShadow: opts.castShadow !== false,
      };
      if (rgba[3] < 0.985) {
        item.castShadow = opts.castShadow === true;
        transQueue.push(item);
      } else {
        opaqueQueue.push(item);
      }
    };

    const drawMesh = (meshName, x, y, z, rx, ry, rz, sx, sy, sz, rgba, emissive = 0, matType = 0, opts = {}) => {
      pushItem(meshName, mat4Transform(x, y, z, rx, ry, rz, sx, sy, sz), rgba, emissive, matType, opts);
    };

    const makeLocal = (cx, cy, cz, rot = 0) => {
      const baseMat = mat4Transform(cx, cy, cz, 0, rot, 0, 1, 1, 1);
      return (meshName, lx, ly, lz, lrx, lry, lrz, sx, sy, sz, rgba, emissive = 0, matType = 0, opts = {}) => {
        const model = mat4Mul(baseMat, mat4Transform(lx, ly, lz, lrx, lry, lrz, sx, sy, sz));
        pushItem(meshName, model, rgba, emissive, matType, opts);
      };
    };

    // Helper pivot hanche pour pattes animees
    const drawPivotBox = (baseMat, lx, hipY, lz, swingX, w, len, d, rgba, matType = MAT.FUR) => {
      const pivotM = mat4Mul(baseMat, mat4Transform(lx, hipY, lz, swingX, 0, 0, 1, 1, 1));
      const boxM = mat4Mul(pivotM, mat4Transform(0, -len, 0, 0, 0, 0, w, len, d));
      pushItem("box", boxM, rgba, 0, matType, {});
    };

    // Terrain principal + collines d'horizon + ruban riviere continu
    drawMesh("terrain", 0, 0, 0, 0, 0, 0, 1, 1, 1, [0.27, 0.48, 0.21, 1], 0, MAT.TERRAIN, { castShadow: false });
    if (this.meshes.riverBed.count) {
      drawMesh("riverBed", 0, 0, 0, 0, 0, 0, 1, 1, 1, [0.46, 0.41, 0.34, 1], 0, MAT.GRAVEL, { castShadow: false });
    }
    if (this.meshes.river.count) {
      drawMesh("river", 0, 0, 0, 0, 0, 0, 1, 1, 1, [0.06, 0.45, 0.7, 0.9], 0, MAT.WATER, { castShadow: false });
    }

    const H = (x, z) => getTerrainHeight(state, x, z);
    const { proj, view, eye } = this._getMatrices();
    const vp = mat4Mul(proj, view);
    const cssW = rect.width || 960;
    const cssH = rect.height || 580;

    this.hitBoxes = [];
    this.arPins = [];

    const addArPin = (id, label, x, y, z, warn = false) => {
      const pt = this._projectPoint(vp, x, y, z, cssW, cssH);
      if (pt && pt.x > 0 && pt.x < cssW && pt.y > 0 && pt.y < cssH) {
        this.arPins.push({ id, label, x: pt.x, y: pt.y, warn });
      }
    };

    const windSpeed = state.weather?.current?.windKmh || 12;
    const foliageWind = 0.22 + Math.min(1.2, windSpeed * 0.02);
    const nightGlow = sun.isDay ? 0.08 : 0.72;

    // --- 1. Arbres & bosquets de la campagne lointaine ---
    const gSize = (state.farm?.gridSize || 44) + 8;
    const tHeights = state.terrain?.heights || [];
    const tRes = state.terrain?.res || 32;
    for (let i = 0; i < 48; i++) {
      const ang = i * 2.39996 + 0.4;
      const rad = 28 + ((i * 7.3) % 30);
      const tx = Math.cos(ang) * rad;
      const tz = Math.sin(ang) * rad;
      if (Math.max(Math.abs(tx), Math.abs(tz)) < gSize * 0.54) continue;
      if (tz > 7 && tz < 21) continue; // preserve le couloir riviere
      const ty = sampleExtendedTerrainHeight(tHeights, tRes, gSize, tx, tz);
      const sc = 0.9 + ((i * 13) % 7) * 0.14;
      drawMesh("cyl", tx, ty - 0.3, tz, 0, 0, 0, 0.38 * sc, 2.1 * sc, 0.38 * sc, [0.38, 0.25, 0.14, 1], 0, MAT.WOOD);
      const gShade = 0.14 + ((i * 5) % 4) * 0.025;
      drawMesh("sphere", tx, ty + 1.4 * sc, tz, 0, 0, 0, 2.8 * sc, 2.4 * sc, 2.8 * sc, [gShade, 0.46 + (i % 3) * 0.04, 0.18, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
      drawMesh("sphere", tx + 0.6 * sc, ty + 2.2 * sc, tz - 0.4 * sc, 0, 0, 0, 2.1 * sc, 1.9 * sc, 2.1 * sc, [gShade + 0.04, 0.52, 0.2, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
      drawMesh("leafCluster", tx, ty + 1.3 * sc, tz, 0, i * 0.7, 0, 3.0 * sc, 2.6 * sc, 3.0 * sc, [gShade + 0.02, 0.5, 0.19, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
    }

    // --- 2. Rendu detaille des parcelles et cultures en 3D ---
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

    const drawPlotRealistic = (p, snap) => {
      const w = p.w || 7, d = p.d || 2.3, rot = p.rot || 0;
      const baseY = H(p.x, p.z);
      const progress = Math.max(0.14, (snap?.progressPct ?? 55) / 100);
      const tint = getPlotTint(p, snap);
      const crop = getCropById(p.cropId);
      const shape = crop.shape || "leafy_head";
      const isSelected = this.selectedId === p.id;
      const emSel = isSelected ? 0.28 : 0;

      // Butte / Planche de terre travaillee + bordures bois maraicheres + goutte-a-goutte
      const moistRatio = (snap?.moisturePct ?? p.moisturePct) / 100;
      const soilRgb = tint || lerpColor([0.44, 0.31, 0.20], [0.21, 0.14, 0.09], moistRatio);
      drawMesh("box", p.x, baseY - 0.12, p.z, 0, rot, 0, w, 0.34, d, [...soilRgb, 1], emSel, MAT.SOIL, { castShadow: false });

      const localPlot = makeLocal(p.x, baseY, p.z, rot);
      if (p.zone !== "Serre") {
        // Bordures en bois sur planches maraicheres
        localPlot("box", 0, 0.02, d * 0.5 + 0.03, 0, 0, 0, w + 0.08, 0.2, 0.07, [0.46, 0.32, 0.18, 1], 0, MAT.WOOD);
        localPlot("box", 0, 0.02, -d * 0.5 - 0.03, 0, 0, 0, w + 0.08, 0.2, 0.07, [0.46, 0.32, 0.18, 1], 0, MAT.WOOD);
      }

      // Lignes noires de goutte-a-goutte
      const nRows = 3;
      const nCols = Math.max(6, Math.min(10, Math.round(w * 0.9)));
      for (let r = 0; r < nRows; r++) {
        const localZ = ((r + 0.5) / nRows - 0.5) * (d * 0.76);
        localPlot("cyl", w * 0.44, 0.23, localZ, 0, 0, Math.PI / 2, 0.04, w * 0.88, 0.04, [0.14, 0.15, 0.17, 1], 0, MAT.DEFAULT, { castShadow: false });
      }

      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      for (let r = 0; r < nRows; r++) {
        const localZ = ((r + 0.5) / nRows - 0.5) * (d * 0.76);
        for (let c = 0; c < nCols; c++) {
          const jitter = Math.sin(c * 1.9 + r * 3.1) * 0.08;
          const localX = ((c + 0.5) / nCols - 0.5) * (w * 0.86) + jitter;
          const wx = p.x + cosR * localX + sinR * localZ;
          const wz = p.z - sinR * localX + cosR * localZ;
          const py = H(wx, wz) + 0.21;

          if (tint) {
            drawMesh("sphere", wx, py, wz, 0, rot, 0, 0.56, 0.55 * progress + 0.18, 0.5, [...tint, 1], emSel, MAT.FOLIAGE);
            continue;
          }

          if (shape === "staked_fruit") {
            const hPlant = 0.42 + progress * 1.25;
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.06, hPlant + 0.22, 0.06, [0.54, 0.37, 0.21, 1], 0, MAT.WOOD);
            drawMesh("leafCluster", wx, py + 0.06, wz, 0, c * 0.8, 0, 0.68, hPlant * 0.88, 0.68, [0.16, 0.54, 0.2, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.35 });
            drawMesh("sphere", wx, py + hPlant * 0.35, wz, 0, 0, 0, 0.42, hPlant * 0.58, 0.42, [0.18, 0.60, 0.22, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.35 });
            if (progress > 0.42) {
              drawMesh("sphere", wx + 0.13, py + hPlant * 0.55, wz + 0.1, 0, 0, 0, 0.14, 0.14, 0.14, [0.92, 0.16, 0.13, 1], 0.05);
              drawMesh("sphere", wx - 0.12, py + hPlant * 0.38, wz - 0.08, 0, 0, 0, 0.13, 0.13, 0.13, [0.94, 0.24, 0.12, 1], 0.05);
              drawMesh("sphere", wx + 0.04, py + hPlant * 0.72, wz - 0.11, 0, 0, 0, 0.11, 0.11, 0.11, [0.95, 0.42, 0.12, 1], 0.05);
            }
          } else if (shape === "tall_corn") {
            const hCorn = 0.45 + progress * 1.45;
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.09, hCorn, 0.09, [0.22, 0.62, 0.22, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind * 0.8 });
            drawMesh("leafCluster", wx, py + hCorn * 0.32, wz, 0, c + r, 0, 0.78, hCorn * 0.58, 0.78, [0.24, 0.66, 0.23, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind });
            if (progress > 0.52) {
              drawMesh("cyl", wx + 0.08, py + hCorn * 0.54, wz, 0, 0, -0.25, 0.12, 0.26, 0.12, [0.98, 0.82, 0.18, 1], 0.06);
              drawMesh("cone", wx, py + hCorn * 0.96, wz, 0, 0, 0, 0.16, 0.24, 0.16, [0.92, 0.84, 0.45, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
            }
          } else if (shape === "sunflower") {
            const hSun = 0.45 + progress * 1.3;
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.08, hSun, 0.08, [0.2, 0.58, 0.22, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind * 0.7 });
            drawMesh("leafCluster", wx, py + hSun * 0.25, wz, 0, c, 0, 0.58, hSun * 0.5, 0.58, [0.2, 0.62, 0.24, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind * 0.6 });
            if (progress > 0.38) {
              drawMesh("cyl", wx, py + hSun, wz, 0.45, rot, 0, 0.48, 0.07, 0.48, [0.98, 0.8, 0.1, 1], 0.1);
              drawMesh("sphere", wx, py + hSun + 0.01, wz + 0.02, 0.45, rot, 0, 0.24, 0.1, 0.24, [0.28, 0.15, 0.07, 1]);
            }
          } else if (shape === "wheat_golden") {
            const hW = 0.28 + progress * 0.72;
            const colW = lerpColor([0.3, 0.68, 0.22], [0.92, 0.76, 0.24], progress);
            drawMesh("leafCluster", wx, py, wz, 0, rot + c * 0.5, 0, 0.88, hW, 0.55, [...colW, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 1.15 });
          } else if (shape === "root_top") {
            const rootCol = crop.id === "radis" ? [0.92, 0.2, 0.35, 1] : [0.95, 0.46, 0.12, 1];
            drawMesh("sphere", wx, py - 0.03, wz, 0, 0, 0, 0.16, 0.14, 0.16, rootCol);
            drawMesh("leafCluster", wx, py + 0.05, wz, 0, c * 0.9, 0, 0.52, 0.26 + progress * 0.32, 0.52, [0.18, 0.7, 0.25, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.5 });
          } else if (shape === "allium") {
            const bulbCol = crop.id === "oignon" ? [0.88, 0.66, 0.32, 1] : [0.92, 0.94, 0.88, 1];
            drawMesh("sphere", wx, py - 0.02, wz, 0, 0, 0, 0.18, 0.18, 0.18, bulbCol);
            drawMesh("leafCluster", wx, py + 0.08, wz, 0, c * 0.6, 0, 0.36, 0.35 + progress * 0.38, 0.36, [0.14, 0.58, 0.42, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.6 });
          } else if (shape === "berry_mound") {
            drawMesh("leafCluster", wx, py, wz, 0, c * 0.7, 0, 0.55, 0.26 + progress * 0.12, 0.5, [0.16, 0.6, 0.22, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.3 });
            if (progress > 0.35) {
              drawMesh("sphere", wx + 0.12, py + 0.14, wz + 0.08, 0, 0, 0, 0.1, 0.11, 0.1, [0.92, 0.12, 0.22, 1], 0.08);
              drawMesh("sphere", wx - 0.1, py + 0.13, wz - 0.06, 0, 0, 0, 0.09, 0.1, 0.09, [0.96, 0.2, 0.28, 1], 0.08);
            }
          } else if (shape === "trellis_vine") {
            drawMesh("cyl", wx, py, wz, 0, 0, 0, 0.07, 1.25, 0.07, [0.44, 0.29, 0.16, 1], 0, MAT.WOOD);
            drawMesh("box", wx, py + 0.65, wz, 0, rot, 0, 0.95, 0.03, 0.03, [0.6, 0.64, 0.68, 1], 0, MAT.METAL);
            drawMesh("sphere", wx, py + 0.38, wz, 0, rot, 0, 0.75, 0.58, 0.42, [0.18, 0.56, 0.2, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.4 });
            if (progress > 0.45) {
              drawMesh("sphere", wx + 0.1, py + 0.32, wz + 0.14, 0, 0, 0, 0.13, 0.19, 0.13, [0.44, 0.16, 0.66, 1], 0.05);
              drawMesh("sphere", wx - 0.12, py + 0.34, wz - 0.12, 0, 0, 0, 0.12, 0.18, 0.12, [0.48, 0.2, 0.7, 1], 0.05);
            }
          } else if (shape === "sprawling_squash") {
            drawMesh("leafCluster", wx, py, wz, 0, c * 0.7, 0, 0.78, 0.38 + progress * 0.18, 0.74, [0.15, 0.56, 0.21, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.3 });
            drawMesh("sphere", wx + 0.16, py + 0.22, wz, 0, 0, 0, 0.15, 0.13, 0.15, [0.98, 0.82, 0.12, 1], 0.08);
            if (progress > 0.45) {
              drawMesh("cyl", wx - 0.1, py + 0.08, wz + 0.12, Math.PI / 2, c, 0, 0.1, 0.3, 0.1, [0.14, 0.45, 0.18, 1]);
            }
          } else if (shape === "bush_pods") {
            const hBush = 0.25 + progress * 0.42;
            drawMesh("leafCluster", wx, py, wz, 0, c * 0.6, 0, 0.62, hBush, 0.62, [0.18, 0.64, 0.24, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.45 });
            drawMesh("sphere", wx, py + 0.08, wz, 0, 0, 0, 0.44, hBush * 0.78, 0.44, [0.22, 0.68, 0.26, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.4 });
            if (crop.id === "pomme_de_terre" && progress > 0.55) {
              drawMesh("sphere", wx, py + hBush + 0.04, wz, 0, 0, 0, 0.11, 0.09, 0.11, [0.94, 0.92, 0.98, 1], 0.08);
            }
          } else if (shape === "meadow_clover" || shape === "purple_flowers") {
            const hCov = 0.22 + progress * 0.42;
            const colCov = shape === "purple_flowers" ? [0.2, 0.62, 0.26, 1] : [0.22, 0.7, 0.28, 1];
            drawMesh("leafCluster", wx, py, wz, 0, c * 0.9, 0, 0.72, hCov, 0.72, colCov, emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.65 });
            if (shape === "purple_flowers" && progress > 0.35) {
              drawMesh("sphere", wx + 0.06, py + hCov * 0.85, wz, 0, 0, 0, 0.16, 0.16, 0.16, [0.64, 0.36, 0.88, 1], 0.1);
            }
          } else {
            // Laitue / Chou / Epinard : rosettes rondes bien formees
            const headCol = crop.id === "chou"
              ? [0.16, 0.54, 0.34, 1]
              : crop.id === "epinard"
                ? [0.12, 0.58, 0.26, 1]
                : [0.46, 0.82, 0.22, 1];
            const sz = 0.28 + progress * 0.28;
            drawMesh("leafCluster", wx, py, wz, 0, c, 0, sz * 1.4, sz * 0.85, sz * 1.4, headCol, emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.25 });
            drawMesh("sphere", wx, py + 0.02, wz, 0, c, 0, sz * 1.1, sz * 0.82, sz * 1.1, headCol, emSel, MAT.FOLIAGE);
          }
        }
      }

      // Aspersion / irrigation animee
      if (p.irrigationValveOpen) {
        for (let k = -2; k <= 2; k++) {
          const pulse = (this.elapsed * 2.5 + k * 0.2) % 1;
          const lx = k * (w * 0.18);
          const wx = p.x + cosR * lx;
          const wz = p.z - sinR * lx;
          drawMesh("sphere", wx, H(wx, wz) + 0.4 + pulse * 0.75, wz, 0, 0, 0, 0.14, 0.24, 0.14, [0.35, 0.84, 1.0, 0.82], 0.3, MAT.WATER, { castShadow: false });
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

    // --- 3. Rendu anatomique organique des 8 especes d'animaux ---
    const drawAnimal3D = (speciesId, ax, az, yaw, animPhase, seed) => {
      const ay = H(ax, az);
      const legSwing = Math.sin(animPhase) * 0.26;
      const localA = makeLocal(ax, ay, az, yaw);
      const baseMat = mat4Transform(ax, ay, az, 0, yaw, 0, 1, 1, 1);

      if (speciesId === "bovin_lait" || speciesId === "bovin_viande") {
        const isDairy = speciesId === "bovin_lait";
        const bodyCol = isDairy ? [0.95, 0.94, 0.91, 1] : [0.76, 0.54, 0.34, 1];
        // Torse arrondi + croupe + cou + tete + museau + cornes + oreilles + queue
        localA("sphere", 0, 0.42, 0, 0, 0, 0, 0.78, 0.68, 1.46, bodyCol, 0, MAT.FUR);
        if (isDairy) {
          localA("sphere", 0.08, 0.68, -0.18, 0, 0, 0, 0.66, 0.42, 0.58, [0.13, 0.14, 0.16, 1], 0, MAT.FUR);
          localA("sphere", -0.1, 0.6, 0.36, 0, 0, 0, 0.58, 0.38, 0.46, [0.13, 0.14, 0.16, 1], 0, MAT.FUR);
          localA("sphere", 0, 0.36, -0.22, 0, 0, 0, 0.32, 0.18, 0.3, [0.94, 0.76, 0.76, 1]);
        }
        // Cou + tete
        localA("cyl", 0, 0.64, 0.58, 0.55, 0, 0, 0.38, 0.45, 0.4, isDairy ? [0.16, 0.16, 0.18, 1] : bodyCol, 0, MAT.FUR);
        localA("sphere", 0, 0.72, 0.86, 0.18, 0, 0, 0.44, 0.42, 0.48, isDairy ? [0.16, 0.16, 0.18, 1] : bodyCol, 0, MAT.FUR);
        localA("sphere", 0, 0.70, 1.09, 0, 0, 0, 0.32, 0.22, 0.18, [0.94, 0.72, 0.72, 1]);
        localA("cone", -0.18, 1.06, 0.84, 0, 0, 0.48, 0.09, 0.22, 0.09, [0.92, 0.88, 0.76, 1]);
        localA("cone", 0.18, 1.06, 0.84, 0, 0, -0.48, 0.09, 0.22, 0.09, [0.92, 0.88, 0.76, 1]);
        localA("cyl", 0, 0.22, -0.82, 0.24, 0, 0, 0.06, 0.45, 0.06, bodyCol, 0, MAT.FUR);
        // 4 pattes articulees a la hanche
        for (const [lx, lz, s] of [[-0.22, 0.45, 1], [0.22, 0.45, -1], [-0.22, -0.45, -1], [0.22, -0.45, 1]]) {
          drawPivotBox(baseMat, lx, 0.48, lz, legSwing * s, 0.14, 0.48, 0.14, bodyCol);
        }
      } else if (speciesId === "ovin") {
        // Mouton laineux multi-spheres
        const wool = [0.96, 0.94, 0.87, 1];
        localA("sphere", 0, 0.26, 0, 0, 0, 0, 0.62, 0.54, 0.9, wool, 0, MAT.FUR);
        localA("sphere", 0.1, 0.34, 0.15, 0, 0, 0, 0.44, 0.42, 0.5, wool, 0, MAT.FUR);
        localA("sphere", -0.1, 0.32, -0.15, 0, 0, 0, 0.44, 0.42, 0.5, wool, 0, MAT.FUR);
        localA("sphere", 0, 0.42, 0.52, 0.2, 0, 0, 0.28, 0.26, 0.34, [0.2, 0.19, 0.18, 1], 0, MAT.FUR);
        localA("box", -0.17, 0.52, 0.46, 0, 0, 0.4, 0.14, 0.06, 0.08, [0.2, 0.19, 0.18, 1]);
        localA("box", 0.17, 0.52, 0.46, 0, 0, -0.4, 0.14, 0.06, 0.08, [0.2, 0.19, 0.18, 1]);
        for (const [lx, lz, s] of [[-0.17, 0.28, 1], [0.17, 0.28, -1], [-0.17, -0.28, -1], [0.17, -0.28, 1]]) {
          drawPivotBox(baseMat, lx, 0.32, lz, legSwing * s * 0.7, 0.09, 0.32, 0.09, [0.2, 0.19, 0.18, 1]);
        }
      } else if (speciesId === "caprin") {
        // Chevre alpine chamoisee
        const coat = [0.64, 0.44, 0.26, 1];
        localA("sphere", 0, 0.32, 0, 0, 0, 0, 0.44, 0.46, 0.86, coat, 0, MAT.FUR);
        localA("cyl", 0, 0.48, 0.36, 0.38, 0, 0, 0.22, 0.36, 0.22, coat, 0, MAT.FUR);
        localA("sphere", 0, 0.62, 0.54, 0, 0, 0, 0.24, 0.28, 0.32, [0.46, 0.31, 0.18, 1], 0, MAT.FUR);
        localA("cone", -0.09, 0.86, 0.48, -0.45, 0, 0.15, 0.06, 0.24, 0.06, [0.24, 0.21, 0.19, 1]);
        localA("cone", 0.09, 0.86, 0.48, -0.45, 0, -0.15, 0.06, 0.24, 0.06, [0.24, 0.21, 0.19, 1]);
        for (const [lx, lz, s] of [[-0.14, 0.28, 1], [0.14, 0.28, -1], [-0.14, -0.28, -1], [0.14, -0.28, 1]]) {
          drawPivotBox(baseMat, lx, 0.36, lz, legSwing * s * 0.8, 0.08, 0.36, 0.08, [0.32, 0.24, 0.18, 1]);
        }
      } else if (speciesId === "porcin") {
        // Cochon rose/gascon + groin + 4 pattes
        const pigCol = seed % 2 === 0 ? [0.95, 0.68, 0.68, 1] : [0.35, 0.31, 0.29, 1];
        localA("sphere", 0, 0.2, 0, 0, 0, 0, 0.56, 0.48, 0.92, pigCol, 0, MAT.FUR);
        localA("sphere", 0, 0.26, 0.48, 0, 0, 0, 0.38, 0.34, 0.34, pigCol, 0, MAT.FUR);
        localA("cyl", 0, 0.32, 0.66, Math.PI / 2, 0, 0, 0.18, 0.08, 0.16, [0.96, 0.58, 0.6, 1]);
        localA("box", -0.14, 0.5, 0.45, 0.45, 0, 0.3, 0.12, 0.04, 0.14, pigCol, 0, MAT.FUR);
        localA("box", 0.14, 0.5, 0.45, 0.45, 0, -0.3, 0.12, 0.04, 0.14, pigCol, 0, MAT.FUR);
        for (const [lx, lz, s] of [[-0.16, 0.26, 1], [0.16, 0.26, -1], [-0.16, -0.26, -1], [0.16, -0.26, 1]]) {
          drawPivotBox(baseMat, lx, 0.24, lz, legSwing * s * 0.7, 0.09, 0.24, 0.09, pigCol);
        }
      } else if (speciesId === "equin") {
        // Cheval alezan / bai + criniere + queue
        const horseCol = [0.48, 0.28, 0.16, 1];
        localA("sphere", 0, 0.6, 0, 0, 0, 0, 0.68, 0.62, 1.48, horseCol, 0, MAT.FUR);
        localA("cyl", 0, 0.92, 0.62, 0.48, 0, 0, 0.3, 0.66, 0.34, horseCol, 0, MAT.FUR);
        localA("sphere", 0, 1.24, 0.92, 0.4, 0, 0, 0.28, 0.3, 0.48, horseCol, 0, MAT.FUR);
        localA("box", 0, 1.05, 0.58, 0.48, 0, 0, 0.08, 0.62, 0.14, [0.14, 0.1, 0.08, 1], 0, MAT.FUR);
        localA("cyl", 0, 0.28, -0.92, 0.25, 0, 0, 0.12, 0.58, 0.12, [0.14, 0.1, 0.08, 1], 0, MAT.FUR);
        for (const [lx, lz, s] of [[-0.2, 0.5, 1], [0.2, 0.5, -1], [-0.2, -0.5, -1], [0.2, -0.5, 1]]) {
          drawPivotBox(baseMat, lx, 0.68, lz, legSwing * s, 0.12, 0.68, 0.12, [0.36, 0.2, 0.11, 1]);
        }
      } else if (speciesId === "canard") {
        // Canard coureur indien + bec orange
        localA("sphere", 0, 0.12, 0, -0.25, 0, 0, 0.24, 0.42, 0.28, [0.9, 0.86, 0.74, 1], 0, MAT.FUR);
        localA("cyl", 0, 0.44, 0.12, 0, 0, 0, 0.11, 0.22, 0.11, [0.15, 0.45, 0.32, 1], 0, MAT.FUR);
        localA("sphere", 0, 0.58, 0.14, 0, 0, 0, 0.16, 0.16, 0.18, [0.15, 0.48, 0.34, 1], 0, MAT.FUR);
        localA("box", 0, 0.62, 0.26, 0, 0, 0, 0.08, 0.05, 0.16, [0.98, 0.56, 0.1, 1]);
        localA("cyl", -0.06, 0, 0, 0, 0, 0, 0.04, 0.14, 0.04, [0.96, 0.54, 0.1, 1]);
        localA("cyl", 0.06, 0, 0, 0, 0, 0, 0.04, 0.14, 0.04, [0.96, 0.54, 0.1, 1]);
      } else {
        // Poule pondeuse variee (rousse / blanche / noire) + crete + bec
        const peck = Math.max(0, Math.sin(animPhase * 2.3)) * 0.28;
        const henCol = seed % 3 === 0 ? [0.84, 0.42, 0.18, 1] : seed % 3 === 1 ? [0.94, 0.91, 0.84, 1] : [0.24, 0.22, 0.24, 1];
        localA("sphere", 0, 0.1, 0, peck, 0, 0, 0.28, 0.26, 0.38, henCol, 0, MAT.FUR);
        localA("cone", 0, 0.24 + peck * 0.15, -0.18, -0.6, 0, 0, 0.18, 0.18, 0.18, henCol, 0, MAT.FUR);
        localA("sphere", 0, 0.28 - peck * 0.22, 0.2, 0, 0, 0, 0.15, 0.17, 0.17, henCol, 0, MAT.FUR);
        localA("box", 0, 0.42 - peck * 0.22, 0.2, 0, 0, 0, 0.05, 0.09, 0.12, [0.92, 0.12, 0.15, 1]);
        localA("cone", 0, 0.34 - peck * 0.22, 0.29, Math.PI / 2, 0, 0, 0.05, 0.08, 0.05, [0.96, 0.72, 0.14, 1]);
        localA("cyl", -0.06, 0, 0, 0, 0, 0, 0.03, 0.12, 0.03, [0.92, 0.68, 0.14, 1]);
        localA("cyl", 0.06, 0, 0, 0, 0, 0, 0.03, 0.12, 0.03, [0.92, 0.68, 0.14, 1]);
      }
    };

    // --- 4. Rendu des Batiments, Corps de Ferme, Haies, Chemins & Riviere ---
    for (const s of state.structures) {
      const isSel = this.selectedId === s.id;
      const emSel = isSel ? 0.28 : 0;
      const w = s.w || 3, d = s.d || 3, h = s.h || 2.5, rot = s.rot || 0;
      const sy = H(s.x, s.z);
      const localS = makeLocal(s.x, sy, s.z, rot);
      const cosR = Math.cos(rot), sinR = Math.sin(rot);

      const addPlinth = (pw, pd, color = [0.56, 0.53, 0.48, 1]) => {
        localS("box", 0, -1.8, 0, 0, 0, 0, pw + 0.14, 1.92, pd + 0.14, color, 0, MAT.STONE);
      };

      const addWindows = (lz, yLevel, count, spacing, winW = 0.62, winH = 0.85, shutters = true) => {
        for (let k = -(count - 1) / 2; k <= (count - 1) / 2; k += 1) {
          const wx = k * spacing;
          localS("box", wx, yLevel, lz, 0, 0, 0, winW, winH, 0.08, [0.96, 0.86, 0.56, 1], nightGlow, MAT.GLASS);
          localS("box", wx, yLevel - 0.04, lz + 0.04, 0, 0, 0, winW + 0.12, 0.08, 0.12, [0.76, 0.72, 0.66, 1], 0, MAT.STONE);
          if (shutters) {
            localS("box", wx - winW * 0.68, yLevel, lz + 0.02, 0, 0, 0, winW * 0.34, winH, 0.05, [0.36, 0.52, 0.44, 1], 0, MAT.WOOD);
            localS("box", wx + winW * 0.68, yLevel, lz + 0.02, 0, 0, 0, winW * 0.34, winH, 0.05, [0.36, 0.52, 0.44, 1], 0, MAT.WOOD);
          }
        }
      };

      if (s.type === "farmhouse_courtyard") {
        addPlinth(w, d);
        // Cour gravillonnee + puits central en pierre
        localS("box", 0, 0.04, 0.3, 0, 0, 0, w * 0.94, 0.14, d * 0.88, [0.78, 0.72, 0.6, 1], 0, MAT.GRAVEL, { castShadow: false });
        localS("cyl", 0, 0.12, d * 0.14, 0, 0, 0, 1.15, 0.58, 1.15, [0.68, 0.63, 0.56, 1], 0, MAT.STONE);
        localS("cyl", 0, 0.64, d * 0.14, 0, 0, 0, 0.9, 0.08, 0.9, [0.1, 0.46, 0.74, 1], 0, MAT.WATER, { castShadow: false });

        // Corps principal Nord
        const mainH = h * 0.68;
        localS("box", 0, 0.1, -d * 0.26, 0, 0, 0, w, mainH, d * 0.42, [0.84, 0.78, 0.68, 1], emSel, MAT.STONE);
        localS("roof", 0, 0.1 + mainH, -d * 0.26, 0, 0, 0, w + 0.5, h * 0.42, d * 0.48, [0.72, 0.3, 0.18, 1], emSel, MAT.TILE);
        localS("box", 0, 0.1 + mainH + h * 0.4, -d * 0.26, 0, 0, 0, w + 0.52, 0.1, 0.16, [0.62, 0.24, 0.14, 1], 0, MAT.TILE);

        // Cheminee en pierre + fumee animee
        localS("box", -w * 0.28, h * 0.66, -d * 0.26, 0, 0, 0, 0.68, h * 0.52, 0.68, [0.68, 0.6, 0.52, 1], 0, MAT.STONE);
        for (let sm = 0; sm < 3; sm++) {
          const pCycle = (this.elapsed * 0.35 + sm * 0.33) % 1;
          const smokeSz = 0.28 + pCycle * 0.55;
          localS("sphere", -w * 0.28 + Math.sin(this.elapsed + sm) * 0.18, h * 1.18 + pCycle * 1.9, -d * 0.26, 0, 0, 0, smokeSz, smokeSz * 0.8, smokeSz, [0.86, 0.88, 0.9, (1 - pCycle) * 0.36], 0, MAT.DEFAULT, { castShadow: false });
        }

        // Ailes Est et Ouest + toitures canal
        for (const side of [-1, 1]) {
          const ax = side * w * 0.36;
          const wingH = h * 0.54;
          localS("box", ax, 0.1, d * 0.15, 0, 0, 0, w * 0.26, wingH, d * 0.56, [0.82, 0.75, 0.65, 1], emSel, MAT.STONE);
          localS("roof", ax, 0.1 + wingH, d * 0.15, 0, Math.PI / 2, 0, d * 0.6, h * 0.32, w * 0.31, [0.72, 0.3, 0.18, 1], emSel, MAT.TILE);
        }

        // Fenetres facade + porte cochere bois + lanternes nocturnes
        addWindows(-d * 0.045, 0.85, 4, 2.55, 0.6, 0.82, true);
        addWindows(-d * 0.045, 2.05, 5, 1.65, 0.58, 0.78, true);
        localS("box", 0, 0.1, -d * 0.045, 0, 0, 0, 1.5, 2.1, 0.1, [0.42, 0.26, 0.14, 1], 0, MAT.WOOD);
        if (!sun.isDay) {
          localS("sphere", -1.1, 2.2, -d * 0.03, 0, 0, 0, 0.2, 0.22, 0.2, [1.0, 0.82, 0.42, 1], 0.95);
          localS("sphere", 1.1, 2.2, -d * 0.03, 0, 0, 0, 0.2, 0.22, 0.2, [1.0, 0.82, 0.42, 1], 0.95);
        }
      } else if (s.type === "farm_house" || s.type === "stone_barn") {
        addPlinth(w, d);
        const wallCol = s.type === "stone_barn" ? [0.74, 0.67, 0.58, 1] : [0.87, 0.81, 0.71, 1];
        localS("box", 0, 0.05, 0, 0, 0, 0, w, h * 0.68, d, wallCol, emSel, MAT.STONE);
        localS("roof", 0, 0.05 + h * 0.68, 0, 0, 0, 0, w + 0.45, h * 0.42, d + 0.45, [0.7, 0.29, 0.18, 1], emSel, MAT.TILE);
        // Grande porte grange avec traverses bois
        localS("box", 0, 0.05, d * 0.505, 0, 0, 0, w * 0.34, h * 0.52, 0.1, [0.44, 0.27, 0.14, 1], 0, MAT.WOOD);
        localS("box", 0, 0.05 + h * 0.25, d * 0.52, 0, 0, 0, w * 0.35, 0.09, 0.08, [0.3, 0.18, 0.09, 1], 0, MAT.WOOD);
        addWindows(d * 0.505, h * 0.42, 2, w * 0.66, 0.56, 0.72, s.type === "farm_house");
        if (s.type === "stone_barn") {
          // Bottes de foin dorees a cote de la grange
          localS("cyl", w * 0.58, 0.55, d * 0.2 - 0.5, Math.PI / 2, 0.3, 0, 1.1, 1.0, 1.1, [0.88, 0.72, 0.26, 1], 0, MAT.FOLIAGE);
          localS("cyl", w * 0.62, 0.55, -d * 0.2 - 0.5, Math.PI / 2, -0.2, 0, 1.1, 1.0, 1.1, [0.86, 0.7, 0.24, 1], 0, MAT.FOLIAGE);
        }
      } else if (s.type === "farm_shop") {
        addPlinth(w, d);
        localS("box", 0, 0.05, 0, 0, 0, 0, w, h * 0.72, d, [0.92, 0.85, 0.72, 1], emSel, MAT.STONE);
        localS("roof", 0, 0.05 + h * 0.72, 0, 0, 0, 0, w + 0.4, h * 0.35, d + 0.4, [0.76, 0.28, 0.18, 1], emSel, MAT.TILE);
        // Auvent raye rouge/creme + poteaux bois + etals garnis
        for (let i = -2; i <= 2; i++) {
          const stripCol = Math.abs(i) % 2 === 0 ? [0.88, 0.2, 0.2, 1] : [0.96, 0.93, 0.86, 1];
          localS("box", i * (w * 0.18), 1.85, d * 0.66, 0.28, 0, 0, w * 0.185, 0.1, 1.35, stripCol, 0.05);
        }
        localS("cyl", -w * 0.42, 0, d * 0.8, 0, 0, 0, 0.1, 1.65, 0.1, [0.46, 0.3, 0.16, 1], 0, MAT.WOOD);
        localS("cyl", w * 0.42, 0, d * 0.8, 0, 0, 0, 0.1, 1.65, 0.1, [0.46, 0.3, 0.16, 1], 0, MAT.WOOD);
        localS("box", -0.95, 0.04, d * 0.65, 0, 0, 0, 1.35, 0.68, 0.72, [0.54, 0.36, 0.2, 1], 0, MAT.WOOD);
        localS("box", 0.95, 0.04, d * 0.65, 0, 0, 0, 1.35, 0.68, 0.72, [0.54, 0.36, 0.2, 1], 0, MAT.WOOD);
        localS("sphere", -1.1, 0.68, d * 0.65, 0, 0, 0, 0.45, 0.28, 0.45, [0.92, 0.22, 0.16, 1]);
        localS("sphere", -0.65, 0.68, d * 0.65, 0, 0, 0, 0.45, 0.28, 0.45, [0.22, 0.78, 0.28, 1]);
        localS("sphere", 0.75, 0.68, d * 0.65, 0, 0, 0, 0.45, 0.28, 0.45, [0.96, 0.52, 0.14, 1]);
        localS("sphere", 1.15, 0.68, d * 0.65, 0, 0, 0, 0.45, 0.28, 0.45, [0.96, 0.82, 0.16, 1]);
      } else if (s.type === "grain_silo") {
        addPlinth(w, d, [0.58, 0.6, 0.62, 1]);
        localS("cyl", 0, 0.08, 0, 0, 0, 0, w, h * 0.78, d, [0.76, 0.81, 0.86, 1], emSel, MAT.METAL);
        for (let b = 1; b <= 3; b++) {
          localS("cyl", 0, 0.08 + b * h * 0.19, 0, 0, 0, 0, w * 1.03, 0.1, d * 1.03, [0.56, 0.61, 0.66, 1], 0, MAT.METAL);
        }
        localS("cone", 0, 0.08 + h * 0.78, 0, 0, 0, 0, w * 1.06, h * 0.24, d * 1.06, [0.64, 0.7, 0.76, 1], emSel, MAT.METAL);
        localS("cyl", 0, 0.08 + h * 1.0, 0, 0, 0, 0, w * 0.22, 0.38, d * 0.22, [0.5, 0.56, 0.62, 1], 0, MAT.METAL);
        // Echelle laterale & vis de remplissage
        localS("box", w * 0.52, 0.2, 0, 0, 0, 0, 0.12, h * 0.75, 0.45, [0.42, 0.46, 0.5, 1], 0, MAT.METAL);
        localS("cyl", -w * 0.5, 0.3, 0, 0, 0, 0.48, 0.22, h * 0.85, 0.22, [0.62, 0.66, 0.72, 1], 0, MAT.METAL);
      } else if (s.type === "hangar" || s.type === "barn_livestock") {
        addPlinth(w, d);
        const isHangar = s.type === "hangar";
        const wallCol = isHangar ? [0.46, 0.52, 0.58, 1] : [0.68, 0.54, 0.38, 1];
        const matWall = isHangar ? MAT.METAL : MAT.WOOD;
        localS("box", 0, 0.06, 0, 0, 0, 0, w, h * 0.68, d, wallCol, emSel, matWall);
        localS("roof", 0, 0.06 + h * 0.68, 0, 0, 0, 0, w + 0.4, h * 0.42, d + 0.4, isHangar ? [0.36, 0.42, 0.48, 1] : [0.66, 0.28, 0.18, 1], emSel, isHangar ? MAT.METAL : MAT.TILE);
        // Poteaux et grande baie d'entree
        for (const px of [-w * 0.46, 0, w * 0.46]) {
          localS("box", px, 0.06, d * 0.51, 0, 0, 0, 0.24, h * 0.68, 0.24, [0.34, 0.24, 0.14, 1], 0, MAT.WOOD);
        }
        localS("box", 0, 0.06, d * 0.505, 0, 0, 0, w * 0.46, h * 0.56, 0.08, [0.16, 0.18, 0.2, 1], 0, MAT.DEFAULT);
        if (!isHangar) {
          // Ratelier foin exterieur
          localS("box", 0, 0.12, d * 0.62, 0, 0, 0, w * 0.72, 0.55, 0.55, [0.54, 0.36, 0.18, 1], 0, MAT.WOOD);
          localS("box", 0, 0.45, d * 0.62, 0, 0, 0, w * 0.65, 0.32, 0.44, [0.88, 0.74, 0.28, 1], 0, MAT.FOLIAGE);
        }
      } else if (s.type === "coop_mobile" || s.type === "coop_fixed") {
        const lift = s.type === "coop_mobile" ? 0.32 : 0.06;
        if (s.type === "coop_fixed") addPlinth(w, d);
        localS("box", 0, lift, 0, 0, 0, 0, w, h * 0.65, d, [0.82, 0.54, 0.24, 1], emSel, MAT.WOOD);
        localS("roof", 0, lift + h * 0.65, 0, 0, 0, 0, w + 0.3, h * 0.42, d + 0.3, [0.72, 0.26, 0.16, 1], emSel, MAT.TILE);
        // Pondoir lateral + trappe auto + rampe acces
        localS("box", -w * 0.56, lift + 0.2, 0, 0, 0, 0, 0.5, 0.55, d * 0.6, [0.74, 0.48, 0.2, 1], 0, MAT.WOOD);
        localS("box", 0, lift + 0.08, d * 0.51, 0, 0, 0, 0.75, 0.62, 0.1, s.doorOpen ? [0.18, 0.84, 0.38, 1] : [0.88, 0.2, 0.2, 1], 0.25);
        if (s.doorOpen) {
          localS("box", 0, lift * 0.5, d * 0.68, -0.45, 0, 0, 0.65, 0.06, 0.9, [0.58, 0.4, 0.22, 1], 0, MAT.WOOD);
        }
        if (s.type === "coop_mobile") {
          for (const [wx, wz] of [[-w * 0.36, d * 0.48], [w * 0.36, d * 0.48], [-w * 0.36, -d * 0.48], [w * 0.36, -d * 0.48]]) {
            localS("cyl", wx + 0.07, 0.22, wz, 0, 0, Math.PI / 2, 0.44, 0.14, 0.44, [0.18, 0.19, 0.2, 1]);
          }
        }
      } else if (s.type === "paddock") {
        // Prairie cloturee par poteaux bois suivant le denivele + abreuvoir + ratelier
        drawMesh("box", s.x, sy + 0.01, s.z, 0, rot, 0, w, 0.06, d, [0.28, 0.62, 0.24, 1], emSel, MAT.TERRAIN, { castShadow: false });
        const placeFenceSide = (len, fixedCoord, isZ) => {
          const steps = Math.max(2, Math.round(len / 2.2));
          for (let i = 0; i <= steps; i++) {
            const p = (i / steps - 0.5) * len;
            const lx = isZ ? p : fixedCoord;
            const lz = isZ ? fixedCoord : p;
            const wx = s.x + cosR * lx + sinR * lz;
            const wz = s.z - sinR * lx + cosR * lz;
            drawMesh("cyl", wx, H(wx, wz), wz, 0, rot, 0, 0.13, 0.95, 0.13, [0.46, 0.31, 0.18, 1], 0, MAT.WOOD);
          }
          const rx = isZ ? 0 : fixedCoord;
          const rz = isZ ? fixedCoord : 0;
          const mx = s.x + cosR * rx + sinR * rz;
          const mz = s.z - sinR * rx + cosR * rz;
          const my = H(mx, mz);
          drawMesh("box", mx, my + 0.42, mz, 0, rot, 0, isZ ? len : 0.08, 0.08, isZ ? 0.08 : len, [0.54, 0.38, 0.22, 1], 0, MAT.WOOD);
          drawMesh("box", mx, my + 0.76, mz, 0, rot, 0, isZ ? len : 0.08, 0.08, isZ ? 0.08 : len, [0.54, 0.38, 0.22, 1], 0, MAT.WOOD);
        };
        placeFenceSide(w, d * 0.49, true);
        placeFenceSide(w, -d * 0.49, true);
        placeFenceSide(d, w * 0.49, false);
        placeFenceSide(d, -w * 0.49, false);

        // Abreuvoir & boule de foin
        const tx = s.x - cosR * (w * 0.26);
        const tz = s.z + sinR * (w * 0.26);
        drawMesh("box", tx, H(tx, tz), tz, 0, rot, 0, 1.5, 0.38, 0.65, [0.55, 0.6, 0.65, 1], 0, MAT.METAL);
        drawMesh("box", tx, H(tx, tz) + 0.35, tz, 0, rot, 0, 1.36, 0.06, 0.52, [0.1, 0.54, 0.85, 1], 0, MAT.WATER, { castShadow: false });
        const fx = s.x + cosR * (w * 0.28);
        const fz = s.z - sinR * (w * 0.28);
        drawMesh("cyl", fx, H(fx, fz), fz, 0, 0, 0, 1.25, 0.9, 1.25, [0.88, 0.72, 0.26, 1], 0, MAT.FOLIAGE);
      } else if (s.type === "hedge_row") {
        // Haie bocagere orientee selon la grande dimension (w vs d)
        const alongX = w >= d;
        const spanLen = alongX ? w : d;
        const thick = alongX ? d : w;
        const count = Math.max(3, Math.round(spanLen / 1.55));
        for (let k = 0; k < count; k++) {
          const tPos = (count === 1 ? 0 : (k / (count - 1) - 0.5)) * (spanLen - thick * 0.5);
          const lx = alongX ? tPos : Math.sin(k * 2.1) * 0.14;
          const lz = alongX ? Math.sin(k * 2.1) * 0.14 : tPos;
          const bx = s.x + cosR * lx + sinR * lz;
          const bz = s.z - sinR * lx + cosR * lz;
          const by = H(bx, bz);
          const hScale = h * (0.78 + ((k * 37) % 5) * 0.08);
          const bRad = thick * (1.28 + (k % 2) * 0.22);
          const shade = 0.14 + (k % 3) * 0.025;
          drawMesh("sphere", bx, by - 0.1, bz, 0, k, 0, bRad, hScale * 0.88, bRad, [shade, 0.44 + (k % 3) * 0.04, 0.17, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.6 });
          drawMesh("leafCluster", bx, by + hScale * 0.25, bz, 0, k * 1.1, 0, bRad * 1.15, hScale * 0.7, bRad * 1.15, [shade + 0.03, 0.52, 0.19, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind * 0.85 });
          if (k % 4 === 1) {
            // Arbuste / jeune arbre bocager dans la haie
            drawMesh("cyl", bx, by, bz, 0, 0, 0, 0.24, h * 0.9, 0.24, [0.4, 0.26, 0.14, 1], 0, MAT.WOOD);
            drawMesh("sphere", bx, by + h * 0.68, bz, 0, 0, 0, bRad * 1.25, h * 0.72, bRad * 1.25, [0.16, 0.5, 0.2, 1], emSel, MAT.FOLIAGE, { windAmt: foliageWind });
          }
        }
      } else if (s.type === "hedge_tree") {
        // Arbre fruitier / noyer organique multi-houppiers + fruits
        drawMesh("cyl", s.x, sy - 0.2, s.z, 0, 0, 0, 0.42, 1.8, 0.42, [0.42, 0.26, 0.15, 1], 0, MAT.WOOD);
        drawMesh("cyl", s.x - 0.22, sy + 1.2, s.z + 0.1, 0.35, 0, 0.45, 0.18, 1.1, 0.18, [0.42, 0.26, 0.15, 1], 0, MAT.WOOD);
        drawMesh("cyl", s.x + 0.24, sy + 1.25, s.z - 0.15, -0.3, 0, -0.42, 0.18, 1.1, 0.18, [0.42, 0.26, 0.15, 1], 0, MAT.WOOD);
        const puffs = [
          [0, 1.75, 0, 2.5, 2.0, 2.5, [0.16, 0.5, 0.2, 1]],
          [-0.8, 1.55, 0.45, 1.85, 1.55, 1.85, [0.19, 0.56, 0.22, 1]],
          [0.82, 1.6, -0.35, 1.85, 1.6, 1.85, [0.15, 0.47, 0.18, 1]],
          [0.15, 2.65, 0.25, 1.75, 1.45, 1.75, [0.22, 0.6, 0.24, 1]],
          [-0.35, 2.2, -0.65, 1.6, 1.4, 1.6, [0.18, 0.54, 0.21, 1]],
        ];
        for (const [px, py, pz, sx, syC, sz, col] of puffs) {
          drawMesh("sphere", s.x + px, sy + py, s.z + pz, 0, 0, 0, sx, syC, sz, col, emSel, MAT.FOLIAGE, { windAmt: foliageWind });
        }
        drawMesh("leafCluster", s.x, sy + 1.8, s.z, 0, 0.4, 0, 2.7, 2.2, 2.7, [0.2, 0.58, 0.22, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
        // Pommes sur pommier
        if ((s.label || "").toLowerCase().includes("pomm")) {
          for (const [fx, fy, fz] of [[-0.75, 2.1, 0.9], [0.7, 2.25, 0.65], [-0.2, 2.6, -0.8], [0.4, 1.9, -0.75]]) {
            drawMesh("sphere", s.x + fx, sy + fy, s.z + fz, 0, 0, 0, 0.16, 0.16, 0.16, [0.92, 0.18, 0.16, 1], 0.05);
          }
        }
      } else if (s.type === "path_dirt" || s.type === "road_paved") {
        // Chemins segmentes suivant la pente du terrain
        const isRoad = s.type === "road_paved";
        const pathCol = isRoad ? [0.58, 0.59, 0.6, 1] : [0.74, 0.62, 0.43, 1];
        const alongX = w >= d;
        const totalLen = alongX ? w : d;
        const segs = Math.max(2, Math.ceil(totalLen / 3.2));
        const segLen = totalLen / segs + 0.12;
        for (let i = 0; i < segs; i++) {
          const offset = ((i + 0.5) / segs - 0.5) * totalLen;
          const lx = alongX ? offset : 0;
          const lz = alongX ? 0 : offset;
          const wx = s.x + cosR * lx + sinR * lz;
          const wz = s.z - sinR * lx + cosR * lz;
          const wy = H(wx, wz);
          drawMesh("box", wx, wy - 0.03, wz, 0, rot, 0, alongX ? segLen : w, 0.1, alongX ? d : segLen, pathCol, emSel, MAT.GRAVEL, { castShadow: false });
          if (isRoad) {
            const kerbX = alongX ? 0 : w * 0.52;
            const kerbZ = alongX ? d * 0.52 : 0;
            drawMesh("box", wx + cosR * kerbX + sinR * kerbZ, wy - 0.01, wz - sinR * kerbX + cosR * kerbZ, 0, rot, 0, alongX ? segLen : 0.16, 0.14, alongX ? 0.16 : segLen, [0.46, 0.44, 0.4, 1], 0, MAT.STONE, { castShadow: false });
            drawMesh("box", wx - cosR * kerbX - sinR * kerbZ, wy - 0.01, wz + sinR * kerbX - cosR * kerbZ, 0, rot, 0, alongX ? segLen : 0.16, 0.14, alongX ? 0.16 : segLen, [0.46, 0.44, 0.4, 1], 0, MAT.STONE, { castShadow: false });
          }
        }
      } else if (s.type === "stone_wall") {
        const segs = Math.max(2, Math.round(w / 1.8));
        for (let i = 0; i < segs; i++) {
          const lx = ((i + 0.5) / segs - 0.5) * w;
          const wx = s.x + cosR * lx;
          const wz = s.z - sinR * lx;
          const wy = H(wx, wz);
          drawMesh("box", wx, wy - 0.2, wz, 0, rot, 0, w / segs + 0.08, h + 0.2, d, [0.65, 0.61, 0.55, 1], emSel, MAT.STONE);
          drawMesh("box", wx, wy + h - 0.02, wz, 0, rot, 0, w / segs + 0.1, 0.12, d + 0.12, [0.56, 0.52, 0.47, 1], 0, MAT.STONE);
        }
      } else if (s.type === "river_seg") {
        // Galets et roseaux de berge (eau rendue par ruban continu meshes.river)
        const bridges = (state.structures || []).filter((b) => b.type === "bridge");
        for (let k = -2; k <= 2; k++) {
          const bx = s.x + cosR * (k * w * 0.21);
          const bz = s.z - sinR * (k * w * 0.21) + (k % 2 === 0 ? d * 0.6 : -d * 0.6);
          if (bridges.some((b) => Math.hypot(bx - b.x, bz - b.z) < 2.9)) continue;
          const by = H(bx, bz);
          drawMesh("sphere", bx, by - 0.08, bz, 0, k, 0, 0.52, 0.3, 0.45, [0.56, 0.53, 0.48, 1], 0, MAT.STONE);
          if (k % 2 === 0) {
            drawMesh("leafCluster", bx + 0.35, by - 0.04, bz, 0, k, 0, 0.45, 0.78, 0.45, [0.22, 0.56, 0.24, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
          }
        }
      } else if (s.type === "bridge") {
        // Pont en pierre : culées sur berges + tablier ouvert laissant couler l'eau dessous
        localS("box", 0, -0.35, -d * 0.42, 0, 0, 0, w, 0.78, d * 0.22, [0.62, 0.57, 0.5, 1], emSel, MAT.STONE);
        localS("box", 0, -0.35, d * 0.42, 0, 0, 0, w, 0.78, d * 0.22, [0.62, 0.57, 0.5, 1], emSel, MAT.STONE);
        localS("box", 0, 0.24, -d * 0.53, 0, 0, 0, w * 0.96, 0.22, d * 0.14, [0.68, 0.63, 0.54, 1], emSel, MAT.GRAVEL);
        localS("box", 0, 0.24, d * 0.53, 0, 0, 0, w * 0.96, 0.22, d * 0.14, [0.68, 0.63, 0.54, 1], emSel, MAT.GRAVEL);
        localS("box", 0, 0.38, 0, 0, 0, 0, w * 0.98, 0.22, d + 0.16, [0.7, 0.64, 0.55, 1], emSel, MAT.GRAVEL);
        localS("box", -w * 0.44, 0.58, 0, 0, 0, 0, 0.24, 0.56, d + 0.06, [0.58, 0.53, 0.47, 1], emSel, MAT.STONE);
        localS("box", w * 0.44, 0.58, 0, 0, 0, 0, 0.24, 0.56, d + 0.06, [0.58, 0.53, 0.47, 1], emSel, MAT.STONE);
        localS("box", -w * 0.44, 1.14, 0, 0, 0, 0, 0.28, 0.1, d + 0.12, [0.46, 0.31, 0.18, 1], 0, MAT.WOOD);
        localS("box", w * 0.44, 1.14, 0, 0, 0, 0, 0.28, 0.1, d + 0.12, [0.46, 0.31, 0.18, 1], 0, MAT.WOOD);
      } else if (s.type === "pond") {
        localS("cyl", 0, -0.1, 0, 0, 0, 0, w + 0.7, 0.24, d + 0.7, [0.48, 0.44, 0.38, 1], 0, MAT.GRAVEL, { castShadow: false });
        localS("cyl", 0, 0.04, 0, 0, 0, 0, w, 0.16, d, [0.06, 0.46, 0.7, 0.9], emSel, MAT.WATER, { castShadow: false });
        for (let r = 0; r < 6; r++) {
          const ang = (r / 6) * Math.PI * 2 + 0.3;
          const rx = s.x + Math.cos(ang) * (w * 0.46);
          const rz = s.z + Math.sin(ang) * (d * 0.46);
          drawMesh("sphere", rx, H(rx, rz) - 0.05, rz, 0, ang, 0, 0.55, 0.32, 0.5, [0.55, 0.52, 0.47, 1], 0, MAT.STONE);
          if (r % 2 === 0) {
            drawMesh("leafCluster", rx + 0.25, H(rx, rz), rz, 0, r, 0, 0.45, 0.75, 0.45, [0.22, 0.58, 0.24, 1], 0, MAT.FOLIAGE, { windAmt: foliageWind });
          }
        }
      } else if (s.type === "water_tank") {
        addPlinth(w, d, [0.54, 0.56, 0.58, 1]);
        localS("cyl", 0, 0.08, 0, 0, 0, 0, w, h, d, [0.68, 0.76, 0.84, 1], emSel, MAT.METAL);
        localS("cyl", 0, 0.08 + h * 0.35, 0, 0, 0, 0, w * 1.03, 0.12, d * 1.03, [0.12, 0.52, 0.82, 1], 0, MAT.METAL);
        localS("cyl", 0, 0.08 + h, 0, 0, 0, 0, w * 1.05, 0.22, d * 1.05, [0.1, 0.42, 0.7, 1], 0, MAT.METAL);
      } else if (s.type === "well_pump") {
        addPlinth(w, d);
        localS("cyl", 0, 0.05, 0, 0, 0, 0, w * 0.88, 0.88, d * 0.88, [0.68, 0.63, 0.56, 1], emSel, MAT.STONE);
        localS("cyl", 0, 0.75, 0, 0, 0, 0, w * 0.68, 0.08, d * 0.68, [0.08, 0.48, 0.76, 1], 0, MAT.WATER, { castShadow: false });
        localS("cyl", -w * 0.38, 0.85, 0, 0, 0, 0, 0.12, 1.15, 0.12, [0.46, 0.3, 0.16, 1], 0, MAT.WOOD);
        localS("cyl", w * 0.38, 0.85, 0, 0, 0, 0, 0.12, 1.15, 0.12, [0.46, 0.3, 0.16, 1], 0, MAT.WOOD);
        localS("cyl", w * 0.39, 1.38, 0, 0, 0, Math.PI / 2, 0.1, w * 0.78, 0.1, [0.4, 0.25, 0.14, 1], 0, MAT.WOOD);
        localS("roof", 0, 1.92, 0, 0, 0, 0, w + 0.25, 0.62, d + 0.25, [0.72, 0.3, 0.18, 1], emSel, MAT.TILE);
      } else if (s.type === "solar_array") {
        localS("cyl", -w * 0.34, -0.3, 0, 0, 0, 0, 0.18, 1.3, 0.18, [0.64, 0.68, 0.72, 1], 0, MAT.METAL);
        localS("cyl", w * 0.34, -0.3, 0, 0, 0, 0, 0.18, 1.3, 0.18, [0.64, 0.68, 0.72, 1], 0, MAT.METAL);
        localS("box", 0, 1.02, 0, 0.48, 0, 0, w + 0.14, 0.08, d + 0.14, [0.74, 0.78, 0.82, 1], 0, MAT.METAL);
        localS("box", 0, 1.07, 0, 0.48, 0, 0, w, 0.08, d, [0.09, 0.22, 0.56, 1], (sun.isDay ? 0.08 : 0) + emSel, MAT.GLASS);
      } else if (s.type === "wind_turbine") {
        addPlinth(1.8, 1.8, [0.56, 0.58, 0.6, 1]);
        localS("cyl", 0, 0.08, 0, 0, 0, 0, 0.42, h, 0.42, [0.9, 0.93, 0.96, 1], emSel, MAT.METAL);
        localS("box", 0, h - 0.1, 0.08, 0, 0, 0, 0.56, 0.52, 1.15, [0.94, 0.96, 0.98, 1], emSel, MAT.METAL);
        localS("sphere", 0, h + 0.42, -0.25, 0, 0, 0, 0.14, 0.14, 0.14, [0.96, 0.18, 0.18, 1], Math.sin(this.elapsed * 4) > 0 ? 0.9 : 0.1);
        localS("cone", 0, h + 0.16, 0.62, Math.PI / 2, 0, 0, 0.36, 0.36, 0.36, [0.88, 0.92, 0.96, 1], 0, MAT.METAL);
        const spin = this.elapsed * (0.4 + windSpeed * 0.12);
        for (let b = 0; b < 3; b++) {
          const ang = spin + (b * Math.PI * 2) / 3;
          localS("blade", 0, h + 0.16, 0.76, 0, 0, ang, 1.5, 3.1, 1.5, [0.97, 0.98, 1.0, 1], emSel, MAT.METAL);
        }
      } else if (s.type === "weather_station") {
        localS("cyl", 0, -0.2, 0, 0, 0, 0, 0.14, h + 0.2, 0.14, [0.78, 0.83, 0.88, 1], emSel, MAT.METAL);
        localS("box", 0, h * 0.56, 0, 0, 0, 0, 0.52, 0.46, 0.42, [0.95, 0.97, 0.98, 1], 0.05);
        localS("box", 0.32, h * 0.72, 0.12, 0.5, 0, 0, 0.36, 0.04, 0.28, [0.1, 0.24, 0.55, 1], 0, MAT.GLASS);
        localS("box", 0, h - 0.06, 0, 0, this.elapsed * (0.6 + windSpeed * 0.18), 0, 1.15, 0.08, 0.1, [0.22, 0.78, 0.98, 1], 0.2, MAT.METAL);
      } else if (s.type === "compost") {
        for (let b = -1; b <= 1; b++) {
          localS("box", b * 1.25, 0, 0, 0, 0, 0, 1.15, 0.72, d * 0.9, [0.44, 0.29, 0.16, 1], emSel, MAT.WOOD);
          localS("sphere", b * 1.25, 0.32, 0, 0, 0, 0, 0.98, 0.65 - (b + 1) * 0.1, d * 0.78, [0.28 - (b + 1) * 0.04, 0.19, 0.1, 1], 0, MAT.SOIL);
        }
      } else if (s.type === "apiary") {
        localS("box", 0, 0, 0, 0, 0, 0, w * 0.95, 0.25, 0.52, [0.46, 0.31, 0.18, 1], 0, MAT.WOOD);
        for (let r = -1.5; r <= 1.5; r += 1) {
          localS("box", r * 0.76, 0.25, 0, 0, 0, 0, 0.58, 0.68, 0.58, [0.94, 0.8, 0.28, 1], emSel, MAT.WOOD);
          localS("roof", r * 0.76, 0.93, 0, 0, 0, 0, 0.68, 0.18, 0.68, [0.68, 0.72, 0.76, 1], 0, MAT.METAL);
        }
        for (let bee = 0; bee < 4; bee++) {
          const ba = this.elapsed * 3.5 + bee * 1.57;
          localS("sphere", Math.cos(ba) * 1.2, 1.25 + Math.sin(ba * 2) * 0.2, Math.sin(ba) * 0.8 + 0.5, 0, 0, 0, 0.08, 0.08, 0.08, [0.98, 0.85, 0.15, 1], 0.3, MAT.DEFAULT, { castShadow: false });
        }
      }

      this.hitBoxes.push({ kind: "structure", id: s.id, label: s.label, x: s.x, z: s.z, w, d, y0: sy, y1: sy + Math.max(0.8, h), data: s });
      if (s.type !== "path_dirt" && s.type !== "road_paved" && s.type !== "river_seg") {
        addArPin(s.id, s.label, s.x, sy + h + 0.5, s.z, false);
      }
    }

    // --- 5. Tous les lots d'animaux en 3D sur la ferme ---
    const coopStruct = state.structures.find((s) => s.type === "coop_mobile" || s.type === "coop_fixed");
    const padStruct = state.structures.find((s) => s.type === "paddock") || state.structures.find((s) => s.type === "barn_livestock");
    const pondStruct = state.structures.find((s) => s.type === "pond");

    state.livestock.forEach((lot, lotIdx) => {
      const spId = lot.speciesId || (lot.kind === "ponte" ? "ponte" : "bovin_lait");
      let centerX = 8 + lotIdx * 2.5;
      let centerZ = 7;
      let spanX = 3.2, spanZ = 2.2;

      if (spId === "ponte" && coopStruct) {
        centerX = coopStruct.x;
        centerZ = coopStruct.z + 1.5;
        spanX = 2.0; spanZ = 0.8;
      } else if (spId === "canard" && pondStruct) {
        centerX = pondStruct.x + 2.4;
        centerZ = pondStruct.z - 0.4;
        spanX = 1.6; spanZ = 1.0;
      } else if (padStruct) {
        const halfW = Math.max(1.2, (padStruct.w || 10) * 0.5 - 1.15);
        const halfD = Math.max(0.8, (padStruct.d || 4.4) * 0.5 - 0.95);
        const offsetX = lotIdx % 2 === 0 ? -halfW * 0.42 : halfW * 0.42;
        const offsetZ = lotIdx > 2 ? halfD * 0.35 : -halfD * 0.35;
        centerX = padStruct.x + offsetX;
        centerZ = padStruct.z + offsetZ;
        spanX = Math.max(0.8, halfW - Math.abs(offsetX));
        spanZ = Math.max(0.5, halfD - Math.abs(offsetZ));
      }

      const visCount = spId === "ponte" ? Math.min(8, Math.max(3, Math.ceil(lot.count / 80))) : Math.min(5, Math.max(2, Math.ceil(lot.count / 12)));
      for (let i = 0; i < visCount; i++) {
        const phase = this.elapsed * (spId === "ponte" || spId === "canard" ? 1.15 : 0.38) + i * 1.9 + lotIdx;
        const ax = centerX + Math.sin(phase * 0.7 + i) * spanX;
        const az = centerZ + Math.cos(phase * 0.5 + i * 1.3) * spanZ;
        const yaw = Math.atan2(Math.cos(phase * 0.7 + i), -Math.sin(phase * 0.5 + i * 1.3));
        drawAnimal3D(spId, ax, az, yaw, phase * 3.2, i + lotIdx);
      }

      const cy = H(centerX, centerZ);
      this.hitBoxes.push({ kind: "livestock", id: lot.id, label: lot.name, x: centerX, z: centerZ, w: spanX * 2, d: spanZ * 2, y0: cy, y1: cy + 1.6, data: lot });
      addArPin(lot.id, `${lot.name} (${lot.count})`, centerX, cy + 1.8, centerZ, false);
    });

    // --- 6. Robots mobiles 3D detailles ---
    for (const eq of state.equipment) {
      if (!eq.autonomous) continue;
      const rx = eq.x ?? 10;
      const rz = eq.z ?? -6;
      const ry = H(rx, rz);
      const isSel = this.selectedId === eq.id;
      const emSel = isSel ? 0.28 : 0;
      const heading = eq.heading ?? 0;

      if (eq.kind === "drone") {
        const yAlt = ry + (eq.status === "working" ? 4.4 + Math.sin(this.elapsed * 3) * 0.2 : 1.0);
        const locD = makeLocal(rx, yAlt, rz, this.elapsed * 0.45);
        locD("box", 0, 0, 0, 0, 0, 0, 0.48, 0.14, 0.65, [0.16, 0.22, 0.28, 1], emSel, MAT.METAL);
        locD("sphere", 0, -0.06, 0.22, 0, 0, 0, 0.16, 0.14, 0.16, [0.15, 0.78, 0.96, 1], 0.35);
        for (const [ax, az] of [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]]) {
          locD("box", ax * 0.5, 0.04, az * 0.5, 0, Math.atan2(ax, az), 0, 0.07, 0.05, 0.68, [0.3, 0.34, 0.38, 1], 0, MAT.METAL);
          locD("cyl", ax, 0.08, az, 0, this.elapsed * 18, 0, 0.46, 0.02, 0.46, [0.22, 0.86, 0.98, 0.45], 0.2, MAT.DEFAULT, { castShadow: false });
        }
        if (eq.status === "working") {
          drawMesh("cone", rx, ry + 0.1, rz, 0, 0, 0, 2.2, yAlt - ry - 0.1, 2.2, [0.2, 0.95, 0.55, 0.16], 0.4, MAT.DEFAULT, { castShadow: false });
        }
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.8, d: 1.8, y0: ry, y1: yAlt + 0.8, data: eq });
        addArPin(eq.id, `🚁 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, yAlt + 0.8, rz, eq.batteryPct < 25);
      } else if (eq.kind === "tractor") {
        const locT = makeLocal(rx, ry, rz, heading);
        locT("box", 0, 0.34, 0.35, 0, 0, 0, 1.0, 0.75, 1.45, [0.14, 0.58, 0.28, 1], emSel, MAT.METAL);
        locT("box", 0, 0.48, 1.09, 0, 0, 0, 0.82, 0.46, 0.06, [0.14, 0.16, 0.18, 1]);
        locT("box", -0.34, 0.62, 1.1, 0, 0, 0, 0.18, 0.12, 0.06, [1.0, 0.92, 0.68, 1], sun.isDay ? 0.2 : 0.9);
        locT("box", 0.34, 0.62, 1.1, 0, 0, 0, 0.18, 0.12, 0.06, [1.0, 0.92, 0.68, 1], sun.isDay ? 0.2 : 0.9);
        locT("box", 0, 0.95, -0.45, 0, 0, 0, 1.12, 0.92, 1.05, [0.68, 0.86, 0.96, 0.68], emSel, MAT.GLASS);
        locT("box", 0, 1.88, -0.45, 0, 0, 0, 1.18, 0.1, 1.12, [0.14, 0.58, 0.28, 1], emSel, MAT.METAL);
        locT("sphere", 0, 1.98, -0.25, 0, 0, 0, 0.26, 0.14, 0.26, [0.95, 0.72, 0.14, 1], 0.25);
        // Roues avant et grosses roues arriere
        for (const [wx, wz, r, wt] of [[-0.68, 0.78, 0.58, 0.24], [0.68, 0.78, 0.58, 0.24], [-0.74, -0.58, 0.9, 0.34], [0.74, -0.58, 0.9, 0.34]]) {
          locT("cyl", wx + wt * 0.5, r * 0.5, wz, 0, 0, Math.PI / 2, r, wt, r, [0.14, 0.15, 0.17, 1]);
          locT("cyl", wx + wt * 0.45 + (wx > 0 ? 0.03 : -0.03), r * 0.5, wz, 0, 0, Math.PI / 2, r * 0.46, wt * 0.9, r * 0.46, [0.88, 0.78, 0.22, 1]);
        }
        // Outil attelage arriere
        locT("box", 0, 0.22, -1.35, 0, 0, 0, 1.5, 0.24, 0.55, [0.85, 0.26, 0.18, 1], 0, MAT.METAL);
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 2.0, d: 2.8, y0: ry, y1: ry + 2.4, data: eq });
        addArPin(eq.id, `🚜 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, ry + 2.4, rz, eq.batteryPct < 25);
      } else {
        // Rover desherbeur solaire
        const locR = makeLocal(rx, ry, rz, heading);
        locR("box", 0, 0.22, 0, 0, 0, 0, 1.05, 0.34, 1.15, [0.94, 0.62, 0.14, 1], emSel, MAT.METAL);
        locR("box", 0, 0.58, 0, 0.15, 0, 0, 1.08, 0.07, 1.12, [0.09, 0.24, 0.56, 1], 0.12, MAT.GLASS);
        locR("sphere", 0, 0.42, 0.62, 0, 0, 0, 0.18, 0.14, 0.16, [0.18, 0.88, 0.48, 1], 0.45);
        for (const [wx, wz] of [[-0.6, 0.44], [0.6, 0.44], [-0.6, -0.44], [0.6, -0.44]]) {
          locR("cyl", wx + 0.08, 0.2, wz, 0, 0, Math.PI / 2, 0.4, 0.16, 0.4, [0.15, 0.16, 0.18, 1]);
        }
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.5, d: 1.5, y0: ry, y1: ry + 1.4, data: eq });
        addArPin(eq.id, `🤖 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, ry + 1.3, rz, eq.batteryPct < 25);
      }
    }

    // --- 7. Calque Flux Energie & Eau ---
    if (this.overlay === "energy") {
      const solar = state.structures.find((s) => s.type === "solar_array");
      const tank = state.structures.find((s) => s.type === "water_tank");
      if (solar) {
        ghPlots.forEach((g) => {
          const mx = (solar.x + g.x) / 2, mz = (solar.z + g.z) / 2;
          const dist = Math.hypot(g.x - solar.x, g.z - solar.z);
          const ang = Math.atan2(g.x - solar.x, g.z - solar.z);
          drawMesh("box", mx, H(mx, mz) + 2.2, mz, 0, ang, 0, 0.16, 0.16, dist, [0.98, 0.8, 0.16, 0.82], 0.55, MAT.DEFAULT, { castShadow: false });
        });
      }
      if (tank) {
        state.plots.forEach((p) => {
          const mx = (tank.x + p.x) / 2, mz = (tank.z + p.z) / 2;
          const dist = Math.hypot(p.x - tank.x, p.z - tank.z);
          const ang = Math.atan2(p.x - tank.x, p.z - tank.z);
          drawMesh("box", mx, H(mx, mz) + 0.5, mz, 0, ang, 0, 0.14, 0.14, dist, [0.16, 0.72, 0.98, 0.78], 0.45, MAT.DEFAULT, { castShadow: false });
        });
      }
    }

    // --- 8. Serres detaillees (Tunnel courbe + arceaux acier OU Serre verre Venlo) ---
    for (const g of ghPlots) {
      const w = g.w || 8.5, d = g.d || 4.2, rot = g.rot || 0;
      const gy = H(g.x, g.z);
      const isSel = this.selectedId === g.id;
      const isGlass = g.structureStyle === "glass_house" || (w >= 9.5 && d >= 6);
      const ghEm = (!sun.isDay ? 0.35 : 0) + (isSel ? 0.25 : 0);
      const tint = this.overlay === "disease" && g.diseaseRisk > 35
        ? [0.95, 0.35, 0.35, 0.38]
        : isGlass ? [0.76, 0.92, 1.0, 0.32] : [0.72, 0.9, 0.98, 0.34];
      const locG = makeLocal(g.x, gy, g.z, rot);
      const ventTilt = ((g.ventOpeningPct || 20) / 100) * 0.42;

      if (isGlass) {
        // Serre Venlo multi-chapelles vitree avec montants aluminium & ouvrants faitiers
        locG("box", 0, 0.02, 0, 0, 0, 0, w, 2.2, d, tint, ghEm, MAT.GLASS);
        locG("roof", 0, 2.22 + ventTilt * 0.25, 0, ventTilt * 0.55, 0, 0, w + 0.08, 1.25, d + 0.08, [0.8, 0.94, 1.0, 0.38], ghEm, MAT.GLASS);
        for (let m = -2; m <= 2; m++) {
          const mx = (m / 2) * (w * 0.46);
          locG("box", mx, 0.02, d * 0.5, 0, 0, 0, 0.09, 2.22, 0.09, [0.78, 0.82, 0.86, 1], 0, MAT.METAL);
          locG("box", mx, 0.02, -d * 0.5, 0, 0, 0, 0.09, 2.22, 0.09, [0.78, 0.82, 0.86, 1], 0, MAT.METAL);
        }
      } else {
        // Serre tunnel courbe avec arceaux galvanises visibles
        locG("arch", 0, 0.02, 0, 0, Math.PI / 2, 0, d, 2.95, w, tint, ghEm, MAT.GLASS);
        const ribCount = 5;
        for (let r = 0; r < ribCount; r++) {
          const rx = ((r / (ribCount - 1)) - 0.5) * (w * 0.96);
          locG("archRib", rx, 0.02, 0, 0, Math.PI / 2, 0, d + 0.06, 2.98, 0.09, [0.75, 0.79, 0.83, 1], 0, MAT.METAL);
        }
        // Pannes longitudinales & ouvrant lateral plaque sur la voute
        locG("cyl", w * 0.5, 2.94, 0, 0, 0, Math.PI / 2, 0.07, w, 0.07, [0.75, 0.79, 0.83, 1], 0, MAT.METAL);
        if ((g.ventOpeningPct || 0) > 10) {
          locG("box", 0, 2.08, d * 0.34, -0.62 - ventTilt, 0, 0, w * 0.72, 0.05, 0.5, [0.85, 0.95, 1.0, 0.48], ghEm, MAT.GLASS);
        }
      }

      if (!sun.isDay) {
        locG("sphere", -w * 0.25, 2.35, 0, 0, 0, 0, 0.26, 0.22, 0.26, [1.0, 0.85, 0.48, 1], 0.95);
        locG("sphere", w * 0.25, 2.35, 0, 0, 0, 0, 0.26, 0.22, 0.26, [1.0, 0.85, 0.48, 1], 0.95);
      }
    }

    // --- 9. Fantome de construction 3D ou cercle de sculpture ---
    if (this.sculptMode.active && this.buildMode.hoverValid) {
      const hy = H(this.buildMode.hoverX, this.buildMode.hoverZ);
      const r = this.sculptMode.radius * 2;
      drawMesh("cyl", this.buildMode.hoverX, hy + 0.06, this.buildMode.hoverZ, 0, 0, 0, r, 0.14, r, [0.98, 0.68, 0.16, 0.42], 0.45, MAT.DEFAULT, { castShadow: false });
    } else if (this.buildMode.active && this.buildMode.hoverValid) {
      const cat = BUILDING_CATALOG.find((b) => b.type === this.buildMode.type) || BUILDING_CATALOG[0];
      const hy = H(this.buildMode.hoverX, this.buildMode.hoverZ);
      drawMesh("box", this.buildMode.hoverX, hy + 0.04, this.buildMode.hoverZ, 0, this.buildMode.rot, 0, cat.w, cat.h, cat.d, [0.2, 0.95, 0.55, 0.48], 0.4, MAT.DEFAULT, { castShadow: false });
    }

    // --- 10. Pluie 3D ---
    if (rainMm > 0.5) {
      const dropSpan = state.farm?.gridSize || 44;
      const drops = Math.min(95, Math.round(rainMm * 6));
      for (let i = 0; i < drops; i++) {
        const px = ((i * 7.3) % dropSpan) - dropSpan / 2;
        const pz = ((i * 11.7) % dropSpan) - dropSpan / 2;
        const py = 12 - ((this.elapsed * 15 + i * 1.7) % 12);
        drawMesh("box", px, py, pz, 0.08, 0, 0, 0.04, 0.72, 0.04, [0.58, 0.84, 1.0, 0.58], 0.2, MAT.DEFAULT, { castShadow: false });
      }
    }

    // --- Matrices de lumiere directionnelle (Shadow Pass) ---
    const shadowUp = Math.hypot(sunDir[0], sunDir[2]) < 0.02 ? [0, 0, 1] : [0, 1, 0];
    const lightView = mat4LookAt([sunDir[0] * 60, sunDir[1] * 60, sunDir[2] * 60], [0, 0, 0], shadowUp);
    const lightProj = mat4Ortho(-34, 34, -34, 34, 2, 135);
    const lightVP = mat4Mul(lightProj, lightView);
    const shadowsActive = this.shadowsEnabled && this.shadowSupported && sun.elevationDeg > 3;

    // --- PASSE 1 : Shadow Map ---
    if (shadowsActive) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2.0, 4.0);

      gl.useProgram(this.shadowProg);
      gl.uniformMatrix4fv(this.shadowLocs.uLightVP, false, lightVP);
      gl.uniform1f(this.shadowLocs.uTime, this.elapsed);

      let lastBuf = null;
      for (let i = 0; i < opaqueQueue.length; i++) {
        const it = opaqueQueue[i];
        if (!it.castShadow) continue;
        if (lastBuf !== it.mesh.posBuf) {
          gl.bindBuffer(gl.ARRAY_BUFFER, it.mesh.posBuf);
          gl.vertexAttribPointer(this.shadowLocs.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.enableVertexAttribArray(this.shadowLocs.aPos);
          lastBuf = it.mesh.posBuf;
        }
        gl.uniformMatrix4fv(this.shadowLocs.uModel, false, it.model);
        gl.uniform1f(this.shadowLocs.uWindAmt, it.windAmt);
        gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
      }

      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // --- PASSE 2 : Dome Celeste + Scene Principale ---
    gl.viewport(0, 0, targetW, targetH);
    gl.clearColor(horizonColor[0], horizonColor[1], horizonColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 2a. Sky Dome
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    const skyMesh = this.meshes.skyDome;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyMesh.posBuf);
    gl.vertexAttribPointer(this.skyLocs.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.skyLocs.aPos);
    gl.uniformMatrix4fv(this.skyLocs.uProj, false, proj);
    gl.uniformMatrix4fv(this.skyLocs.uView, false, view);
    gl.uniform3fv(this.skyLocs.uSunDir, new Float32Array(skySunDir));
    gl.uniform1f(this.skyLocs.uSunInt, sun.intensity);
    gl.uniform1f(this.skyLocs.uRain, rainAmt);
    gl.uniform1f(this.skyLocs.uTime, this.elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, skyMesh.count);

    // 2b. Opaque & Transparent Geometry
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(this.mainProg);
    gl.uniformMatrix4fv(this.mainLocs.uProj, false, proj);
    gl.uniformMatrix4fv(this.mainLocs.uView, false, view);
    gl.uniformMatrix4fv(this.mainLocs.uLightVP, false, lightVP);
    gl.uniform3fv(this.mainLocs.uEyePos, new Float32Array(eye));
    gl.uniform3fv(this.mainLocs.uSunDir, new Float32Array(sunDir));
    gl.uniform3fv(this.mainLocs.uSunColor, new Float32Array(sunColor));
    gl.uniform1f(this.mainLocs.uSunInt, sun.isDay ? sun.intensity : 0.16);
    gl.uniform3fv(this.mainLocs.uSkyColor, new Float32Array(skyColor));
    gl.uniform3fv(this.mainLocs.uHorizonColor, new Float32Array(horizonColor));
    gl.uniform1f(this.mainLocs.uTime, this.elapsed);
    gl.uniform1f(this.mainLocs.uRain, rainAmt);
    gl.uniform1f(this.mainLocs.uShadowsEnabled, shadowsActive ? 1.0 : 0.0);
    gl.uniform1f(this.mainLocs.uShadowTexel, 1.0 / this.shadowSize);
    gl.uniform1f(this.mainLocs.uShowContours, this.sculptMode.active ? 1.0 : 0.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex || null);
    gl.uniform1i(this.mainLocs.uShadowMap, 0);

    opaqueQueue.sort((a, b) => (a.meshName < b.meshName ? -1 : a.meshName > b.meshName ? 1 : 0));
    transQueue.sort((a, b) => {
      const da = Math.pow(a.model[12] - eye[0], 2) + Math.pow(a.model[13] - eye[1], 2) + Math.pow(a.model[14] - eye[2], 2);
      const db = Math.pow(b.model[12] - eye[0], 2) + Math.pow(b.model[13] - eye[1], 2) + Math.pow(b.model[14] - eye[2], 2);
      return db - da;
    });

    let boundMesh = null;
    const drawMainList = (list) => {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (boundMesh !== it.mesh) {
          gl.bindBuffer(gl.ARRAY_BUFFER, it.mesh.posBuf);
          gl.vertexAttribPointer(this.mainLocs.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.enableVertexAttribArray(this.mainLocs.aPos);
          gl.bindBuffer(gl.ARRAY_BUFFER, it.mesh.normBuf);
          gl.vertexAttribPointer(this.mainLocs.aNorm, 3, gl.FLOAT, false, 0, 0);
          gl.enableVertexAttribArray(this.mainLocs.aNorm);
          boundMesh = it.mesh;
        }
        gl.uniformMatrix4fv(this.mainLocs.uModel, false, it.model);
        gl.uniformMatrix3fv(this.mainLocs.uNormalMat, false, mat3NormalFromMat4(it.model, this._normMatBuf));
        gl.uniform4fv(this.mainLocs.uColor, new Float32Array(it.rgba));
        gl.uniform1f(this.mainLocs.uEmissive, it.emissive);
        gl.uniform1f(this.mainLocs.uMatType, it.matType);
        gl.uniform1f(this.mainLocs.uWindAmt, it.windAmt);
        gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
      }
    };

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    drawMainList(opaqueQueue);

    gl.enable(gl.BLEND);
    gl.depthMask(false);
    drawMainList(transQueue);
    gl.depthMask(true);

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
