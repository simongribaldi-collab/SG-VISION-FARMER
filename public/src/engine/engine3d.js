import { BUILDING_CATALOG } from "../data/presets.js";
import { computeSunPosition } from "./weather.js";

// --- Math 3D compacte (mat4 column-major pour WebGL) ---
function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

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

  // R = Ry * Rx * Rz * S
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

function hexToRgb(hex) {
  const clean = (hex || "#4ade80").replace("#", "");
  const num = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return [(num >> 16 & 255) / 255, (num >> 8 & 255) / 255, (num & 255) / 255];
}

function lerpColor(c1, c2, t) {
  const k = Math.max(0, Math.min(1, t));
  return [c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k];
}

// --- Construction des geometries unitaires partagees ---
function createBoxGeometry() {
  // Cube centre X/Z [-0.5..0.5], Y [0..1] pour poser facilement sur le sol
  const faces = [
    // +Y top
    { n: [0, 1, 0], v: [[-0.5, 1, -0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]] },
    // -Y bottom
    { n: [0, -1, 0], v: [[-0.5, 0, 0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5]] },
    // +Z front
    { n: [0, 0, 1], v: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]] },
    // -Z back
    { n: [0, 0, -1], v: [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]] },
    // +X right
    { n: [1, 0, 0], v: [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]] },
    // -X left
    { n: [-1, 0, 0], v: [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]] },
  ];
  const pos = [];
  const norm = [];
  for (const f of faces) {
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      pos.push(...f.v[i]);
      norm.push(...f.n);
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

function createCylinderGeometry(segs = 12) {
  const pos = [];
  const norm = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = Math.cos(a0) * 0.5, z0 = Math.sin(a0) * 0.5;
    const x1 = Math.cos(a1) * 0.5, z1 = Math.sin(a1) * 0.5;
    const nx0 = Math.cos(a0), nz0 = Math.sin(a0);
    const nx1 = Math.cos(a1), nz1 = Math.sin(a1);

    // Side
    pos.push(x0, 0, z0, x1, 0, z1, x1, 1, z1, x0, 0, z0, x1, 1, z1, x0, 1, z0);
    norm.push(nx0, 0, nz0, nx1, 0, nz1, nx1, 0, nz1, nx0, 0, nz0, nx1, 0, nz1, nx0, 0, nz0);
    // Top cap
    pos.push(0, 1, 0, x0, 1, z0, x1, 1, z1);
    norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

function createRoofGeometry() {
  // Prisme triangulaire [-0.5..0.5] X, [0..1] Y, [-0.5..0.5] Z
  const pos = [];
  const norm = [];
  const pushTri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    pos.push(...a, ...b, ...c);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  };
  // Deux pentes sur Z
  pushTri([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0]);
  pushTri([-0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0]);
  pushTri([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0]);
  pushTri([0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0]);
  // Pignons X
  pushTri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0]);
  pushTri([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0]);
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

export class Farm3DEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.camera = { yaw: 0.72, pitch: 0.62, dist: 38, targetX: 0, targetZ: 0 };
    this.overlay = "normal"; // normal | moisture | health | disease | energy | ar
    this.selectedId = null;
    this.buildMode = { active: false, type: "bed_open", rot: 0, hoverX: 0, hoverZ: 0, hoverValid: false };
    this.hitBoxes = [];
    this.arPins = [];
    this.elapsed = 0;
    this.dragging = false;
    this.dragButton = 0;
    this.lastMouse = { x: 0, y: 0 };
    this.dragMoved = false;

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
    const fsSrc = `
      precision mediump float;
      varying vec3 vNorm;
      varying vec3 vWorldPos;
      uniform vec4 uColor;
      uniform vec3 uSunDir;
      uniform float uSunInt;
      uniform vec3 uSkyColor;
      uniform float uEmissive;
      void main() {
        vec3 n = normalize(vNorm);
        float diff = max(dot(n, normalize(uSunDir)), 0.0);
        float hemi = 0.5 + 0.5 * n.y;
        vec3 amb = mix(vec3(0.14, 0.17, 0.16), uSkyColor * 0.55, hemi);
        vec3 lit = uColor.rgb * (amb + diff * uSunInt * 0.95 + uEmissive);
        float dist = length(vWorldPos.xz);
        float fog = clamp((dist - 55.0) / 55.0, 0.0, 0.65);
        vec3 finalRgb = mix(lit, uSkyColor * 0.65, fog);
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
      cyl: upload(createCylinderGeometry(12)),
      roof: upload(createRoofGeometry()),
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("mousedown", (e) => {
      this.dragging = true;
      this.dragButton = e.button;
      this.dragMoved = false;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });
    window.addEventListener("mousemove", (e) => {
      const rect = c.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      if (this.buildMode.active) {
        const hit = this._rayToGround(nx, ny);
        if (hit) {
          this.buildMode.hoverX = Math.round(hit[0] * 2) / 2;
          this.buildMode.hoverZ = Math.round(hit[2] * 2) / 2;
          this.buildMode.hoverValid = true;
        }
      }

      if (!this.dragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (this.dragButton === 2 || e.shiftKey) {
        // Pan terrain
        const scale = this.camera.dist * 0.0018;
        const cosY = Math.cos(this.camera.yaw);
        const sinY = Math.sin(this.camera.yaw);
        this.camera.targetX -= (dx * cosY + dy * sinY) * scale;
        this.camera.targetZ -= (-dx * sinY + dy * cosY) * scale;
      } else {
        this.camera.yaw -= dx * 0.0075;
        this.camera.pitch = Math.max(0.18, Math.min(1.42, this.camera.pitch + dy * 0.0065));
      }
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.dist = Math.max(10, Math.min(95, this.camera.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });

    c.addEventListener("click", (e) => {
      if (this.dragMoved) return;
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
      this.camera = { yaw: 0.72, pitch: 0.62, dist: 38, targetX: 0, targetZ: 0 };
    } else if (preset === "top") {
      this.camera = { yaw: 0.01, pitch: 1.38, dist: 46, targetX: 0, targetZ: 0 };
    } else if (preset === "ar") {
      this.camera = { yaw: 0.35, pitch: 0.24, dist: 19, targetX: -2, targetZ: -2 };
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
    const proj = mat4Perspective((46 * Math.PI) / 180, w / h, 0.5, 220);
    const eye = this._getEye();
    const view = mat4LookAt(eye, [this.camera.targetX, 0.8, this.camera.targetZ], [0, 1, 0]);
    return { proj, view, eye };
  }

  _invert4(m) {
    // Inversion standard 4x4 pour raycasting ecran -> monde
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
      ? lerpColor([0.22, 0.34, 0.45], [0.46, 0.72, 0.92], sun.intensity * (rainMm > 1 ? 0.45 : 1))
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

    const drawMesh = (meshName, x, y, z, rx, ry, rz, sx, sy, sz, rgba, emissive = 0) => {
      const m = this.meshes[meshName];
      gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf);
      gl.vertexAttribPointer(this.locs.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locs.aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.normBuf);
      gl.vertexAttribPointer(this.locs.aNorm, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locs.aNorm);

      gl.uniformMatrix4fv(this.locs.uModel, false, mat4Transform(x, y, z, rx, ry, rz, sx, sy, sz));
      gl.uniform4fv(this.locs.uColor, new Float32Array(rgba));
      gl.uniform1f(this.locs.uEmissive, emissive);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    };

    const gSize = state.farm.gridSize || 36;
    // Terrain principal
    drawMesh("box", 0, -0.45, 0, 0, 0, 0, gSize + 6, 0.45, gSize + 6, [0.22, 0.36, 0.19, 1]);
    // Allée centrale ferme
    drawMesh("box", -2.8, 0.01, 0, 0, 0, 0, 1.8, 0.03, gSize, [0.46, 0.43, 0.38, 1]);
    // Lignes de repere grille
    for (let i = -gSize / 2; i <= gSize / 2; i += 4) {
      drawMesh("box", i, 0.005, 0, 0, 0, 0, 0.04, 0.01, gSize, [0.28, 0.44, 0.24, 0.45]);
      drawMesh("box", 0, 0.005, i, 0, 0, 0, gSize, 0.01, 0.04, [0.28, 0.44, 0.24, 0.45]);
    }

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

    // 1) Dessin des Planches & Serres (en premier les opaques, serres translucides a la fin)
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

    const drawPlotCrops = (p, snap) => {
      const w = p.w || 6, d = p.d || 2.2, rot = p.rot || 0;
      const progress = (snap?.progressPct ?? 50) / 100;
      const cropHeight = Math.max(0.14, (p.zone === "Serre" ? 1.4 : 0.85) * (0.25 + progress * 0.9));
      const tint = getPlotTint(p, snap);
      const soilColor = tint ? [...tint, 1] : [0.36, 0.24, 0.16, 1];
      const isSelected = this.selectedId === p.id;

      // Planche de sol
      drawMesh("box", p.x, 0.02, p.z, 0, rot, 0, w, 0.24, d, soilColor, isSelected ? 0.35 : 0);

      // Rangs de cultures
      const rows = p.zone === "Serre" ? 4 : 3;
      const cropRgb = tint || lerpColor([0.28, 0.68, 0.22], [0.16, 0.82, 0.32], progress);
      for (let r = 0; r < rows; r++) {
        const localZ = ((r + 0.5) / rows - 0.5) * (d * 0.74);
        const rx = p.x + Math.sin(rot) * localZ;
        const rz = p.z + Math.cos(rot) * localZ;
        drawMesh("box", rx, 0.26, rz, 0, rot, 0, w * 0.9, cropHeight, d * 0.16, [...cropRgb, 1], 0);
      }

      // Gouttes / jet d'irrigation actif
      if (p.irrigationValveOpen) {
        for (let k = -2; k <= 2; k++) {
          const pulse = ((this.elapsed * 2.5 + k * 0.2) % 1);
          const lx = k * (w * 0.18);
          const wx = p.x + Math.cos(rot) * lx;
          const wz = p.z - Math.sin(rot) * lx;
          drawMesh("cyl", wx, 0.35 + pulse * 0.7, wz, 0, 0, 0, 0.14, 0.25, 0.14, [0.22, 0.78, 1.0, 0.85], 0.3);
        }
      }

      this.hitBoxes.push({ kind: "plot", id: p.id, label: p.name, x: p.x, z: p.z, w, d, y0: 0, y1: p.zone === "Serre" ? 3.2 : 1.4, data: p });
      addArPin(
        p.id,
        `${p.id} · ${snap?.moisturePct ?? p.moisturePct}% eau · ${snap?.progressPct ?? 50}%`,
        p.x,
        p.zone === "Serre" ? 3.5 : 1.4,
        p.z,
        (snap?.moisturePct ?? p.moisturePct) < 38 || (snap?.diseaseRisk ?? p.diseaseRisk) > 45
      );
    };

    opaquePlots.forEach((p) => drawPlotCrops(p, snapMap.get(p.id)));
    ghPlots.forEach((p) => drawPlotCrops(p, snapMap.get(p.id)));

    // 2) Structures & Amenagements 3D
    const windSpeed = state.weather.current.windKmh || 12;
    for (const s of state.structures) {
      const isSel = this.selectedId === s.id;
      const em = isSel ? 0.35 : 0;
      const w = s.w || 3, d = s.d || 3, h = s.h || 2.5, rot = s.rot || 0;

      if (s.type === "hangar" || s.type === "barn_livestock") {
        const wallCol = s.type === "hangar" ? [0.45, 0.51, 0.58, 1] : [0.68, 0.63, 0.54, 1];
        drawMesh("box", s.x, 0, s.z, 0, rot, 0, w, h * 0.7, d, wallCol, em);
        drawMesh("roof", s.x, h * 0.7, s.z, 0, rot, 0, w + 0.3, h * 0.45, d + 0.3, [0.62, 0.25, 0.2, 1], em);
      } else if (s.type === "coop_mobile" || s.type === "coop_fixed") {
        drawMesh("box", s.x, 0.2, s.z, 0, rot, 0, w, h * 0.65, d, [0.92, 0.62, 0.22, 1], em);
        drawMesh("roof", s.x, 0.2 + h * 0.65, s.z, 0, rot, 0, w + 0.2, h * 0.4, d + 0.2, [0.76, 0.28, 0.16, 1], em);
        // Trappe indicatrice (vert ouverte, rouge fermee)
        drawMesh("box", s.x, 0.2, s.z + d * 0.51, 0, rot, 0, 0.7, 0.6, 0.1, s.doorOpen ? [0.2, 0.9, 0.4, 1] : [0.9, 0.2, 0.2, 1], 0.25);
        // Poules animees devant le poulailler
        if (s.doorOpen) {
          for (let k = 0; k < 5; k++) {
            const cx = s.x + Math.sin(this.elapsed * 0.9 + k * 1.4) * (w * 0.8);
            const cz = s.z + d * 0.8 + Math.cos(this.elapsed * 1.1 + k * 2.1) * 1.3;
            drawMesh("box", cx, 0.05, cz, 0, k, 0, 0.32, 0.28, 0.42, [0.96, 0.9, 0.75, 1], 0);
          }
        }
      } else if (s.type === "paddock") {
        drawMesh("box", s.x, 0.02, s.z, 0, rot, 0, w, 0.1, d, [0.26, 0.68, 0.32, 1], em);
        // Piquets cloture + quelques vaches stylisees
        for (let k = -1; k <= 1; k += 2) {
          drawMesh("box", s.x + k * w * 0.48, 0, s.z, 0, 0, 0, 0.12, 0.8, d, [0.45, 0.32, 0.2, 1], 0);
        }
        for (let v = 0; v < 3; v++) {
          const vx = s.x + Math.sin(this.elapsed * 0.35 + v * 2) * (w * 0.3);
          const vz = s.z + Math.cos(this.elapsed * 0.25 + v) * (d * 0.25);
          drawMesh("box", vx, 0.25, vz, 0, v * 0.8, 0, 0.75, 0.65, 1.3, [0.9, 0.88, 0.82, 1], 0);
        }
      } else if (s.type === "solar_array") {
        drawMesh("box", s.x, 0, s.z, 0, rot, 0, w * 0.85, 0.8, 0.25, [0.55, 0.6, 0.65, 1], 0);
        drawMesh("box", s.x, 0.95, s.z, 0.48, rot, 0, w, 0.12, d, [0.1, 0.24, 0.56, 1], sun.isDay ? 0.2 + em : em);
      } else if (s.type === "wind_turbine") {
        drawMesh("cyl", s.x, 0, s.z, 0, 0, 0, 0.38, h, 0.38, [0.9, 0.94, 0.98, 1], em);
        const spin = this.elapsed * (0.4 + windSpeed * 0.12);
        for (let b = 0; b < 3; b++) {
          const ang = spin + (b * Math.PI * 2) / 3;
          drawMesh("box", s.x, h - 0.2, s.z + 0.35, 0, 0, ang, 0.18, 2.8, 0.08, [0.98, 0.98, 1, 1], 0.1);
        }
      } else if (s.type === "weather_station") {
        drawMesh("cyl", s.x, 0, s.z, 0, 0, 0, 0.18, h, 0.18, [0.78, 0.85, 0.92, 1], em);
        drawMesh("box", s.x, h * 0.55, s.z, 0, 0, 0, 0.55, 0.45, 0.4, [0.96, 0.98, 1, 1], 0.1);
        drawMesh("box", s.x, h - 0.1, s.z, 0, this.elapsed * (0.5 + windSpeed * 0.2), 0, 1.2, 0.1, 0.12, [0.22, 0.78, 0.98, 1], 0.25);
      } else if (s.type === "water_tank") {
        drawMesh("cyl", s.x, 0, s.z, 0, 0, 0, w, h, d, [0.12, 0.58, 0.86, 1], em);
        drawMesh("cyl", s.x, h, s.z, 0, 0, 0, w * 1.05, 0.25, d * 1.05, [0.08, 0.38, 0.64, 1], 0);
      } else if (s.type === "pond") {
        drawMesh("box", s.x, 0.01, s.z, 0, rot, 0, w + 0.6, 0.14, d + 0.6, [0.42, 0.36, 0.28, 1], 0);
        drawMesh("box", s.x, 0.08, s.z, 0, rot, 0, w, 0.12, d, [0.06, 0.52, 0.82, 0.9], em);
      } else if (s.type === "compost") {
        drawMesh("box", s.x, 0, s.z, 0, rot, 0, w, h * 0.75, d, [0.34, 0.22, 0.12, 1], em);
      } else if (s.type === "apiary") {
        for (let r = -1; r <= 1; r++) {
          drawMesh("box", s.x + r * 0.9, 0, s.z, 0, rot, 0, 0.6, 0.85, 0.6, [0.96, 0.82, 0.24, 1], em);
        }
      } else if (s.type === "hedge_tree") {
        drawMesh("cyl", s.x, 0, s.z, 0, 0, 0, 0.45, 1.5, 0.45, [0.44, 0.28, 0.16, 1], 0);
        drawMesh("cyl", s.x, 1.3, s.z, 0, 0, 0, 2.2, 2.5, 2.2, [0.13, 0.52, 0.22, 1], em);
      }

      this.hitBoxes.push({ kind: "structure", id: s.id, label: s.label, x: s.x, z: s.z, w, d, y0: 0, y1: h, data: s });
      addArPin(s.id, s.label, s.x, h + 0.5, s.z, false);
    }

    // 3) Robots mobiles 3D
    for (const eq of state.equipment) {
      if (!eq.autonomous) continue;
      const rx = eq.x ?? 10;
      const rz = eq.z ?? -6;
      const isSel = this.selectedId === eq.id;

      if (eq.kind === "drone") {
        const yAlt = eq.status === "working" ? 4.4 + Math.sin(this.elapsed * 3) * 0.2 : 1.0;
        drawMesh("box", rx, yAlt, rz, 0, this.elapsed * 0.5, 0, 1.1, 0.22, 1.1, [0.18, 0.82, 0.96, 1], 0.35 + (isSel ? 0.3 : 0));
        if (eq.status === "working") {
          // Rayon scan NDVI vers la culture
          drawMesh("cyl", rx, 0.2, rz, 0, 0, 0, 1.6, yAlt - 0.2, 1.6, [0.2, 0.95, 0.55, 0.18], 0.4);
        }
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.8, d: 1.8, y0: 0, y1: 5.0, data: eq });
        addArPin(eq.id, `🚁 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, yAlt + 0.8, rz, eq.batteryPct < 25);
      } else if (eq.kind === "tractor") {
        drawMesh("box", rx, 0.25, rz, 0, 0, 0, 1.6, 1.2, 2.4, [0.14, 0.65, 0.35, 1], isSel ? 0.35 : 0.1);
        drawMesh("box", rx, 1.45, rz - 0.2, 0, 0, 0, 1.2, 0.9, 1.2, [0.75, 0.9, 0.98, 0.75], 0.15);
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 2.0, d: 2.6, y0: 0, y1: 2.5, data: eq });
        addArPin(eq.id, `🚜 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, 2.6, rz, eq.batteryPct < 25);
      } else {
        // Rover solaire
        drawMesh("box", rx, 0.15, rz, 0, 0, 0, 1.1, 0.45, 1.2, [0.95, 0.65, 0.15, 1], isSel ? 0.35 : 0.15);
        drawMesh("box", rx, 0.62, rz, 0, 0, 0, 1.0, 0.08, 1.0, [0.1, 0.25, 0.55, 1], 0.2);
        this.hitBoxes.push({ kind: "robot", id: eq.id, label: eq.name, x: rx, z: rz, w: 1.5, d: 1.5, y0: 0, y1: 1.4, data: eq });
        addArPin(eq.id, `🤖 ${eq.name} (${Math.round(eq.batteryPct)}%)`, rx, 1.3, rz, eq.batteryPct < 25);
      }
    }

    // 4) Calque Flux Energie & Eau (Faisceaux 3D)
    if (this.overlay === "energy") {
      const solar = state.structures.find((s) => s.type === "solar_array");
      const tank = state.structures.find((s) => s.type === "water_tank");
      if (solar) {
        ghPlots.forEach((g) => {
          const mx = (solar.x + g.x) / 2, mz = (solar.z + g.z) / 2;
          const dist = Math.hypot(g.x - solar.x, g.z - solar.z);
          const ang = Math.atan2(g.x - solar.x, g.z - solar.z);
          drawMesh("box", mx, 2.2, mz, 0, ang, 0, 0.16, 0.16, dist, [0.98, 0.8, 0.16, 0.82], 0.55);
        });
      }
      if (tank) {
        state.plots.forEach((p) => {
          const mx = (tank.x + p.x) / 2, mz = (tank.z + p.z) / 2;
          const dist = Math.hypot(p.x - tank.x, p.z - tank.z);
          const ang = Math.atan2(p.x - tank.x, p.z - tank.z);
          drawMesh("box", mx, 0.5, mz, 0, ang, 0, 0.14, 0.14, dist, [0.16, 0.72, 0.98, 0.78], 0.45);
        });
      }
    }

    // 5) Enveloppes translucides des serres + ouvrants de toit animes (rendues en dernier pour l'alpha!)
    for (const g of ghPlots) {
      const w = g.w || 8, d = g.d || 4.2, rot = g.rot || 0;
      const isSel = this.selectedId === g.id;
      const nightGlow = !sun.isDay ? 0.35 : 0;
      const tint = this.overlay === "disease" && g.diseaseRisk > 35 ? [0.95, 0.35, 0.35, 0.42] : [0.68, 0.9, 0.98, 0.34];
      drawMesh("box", g.x, 0.05, g.z, 0, rot, 0, w, 2.0, d, tint, nightGlow + (isSel ? 0.25 : 0));
      const ventTilt = ((g.ventOpeningPct || 20) / 100) * 0.42;
      drawMesh("roof", g.x, 2.05 + ventTilt * 0.4, g.z, ventTilt, rot, 0, w + 0.1, 1.0, d + 0.1, [0.75, 0.92, 1.0, 0.42], nightGlow);
    }

    // 6) Fantome de construction 3D
    if (this.buildMode.active && this.buildMode.hoverValid) {
      const cat = BUILDING_CATALOG.find((b) => b.type === this.buildMode.type) || BUILDING_CATALOG[0];
      drawMesh(
        "box",
        this.buildMode.hoverX,
        0.04,
        this.buildMode.hoverZ,
        0,
        this.buildMode.rot,
        0,
        cat.w,
        cat.h,
        cat.d,
        [0.2, 0.95, 0.55, 0.48],
        0.4
      );
    }

    // 7) Particules de pluie en direct
    if (rainMm > 0.5) {
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
