import * as THREE from "../../vendor/three/three.module.min.js";
import { sampleExtendedTerrainHeight } from "./geometries3d.js";
import { getCropById } from "./predictor.js";

function hexFromRgba(r, g, b) {
  const c = new THREE.Color(r, g, b);
  return c.getHex();
}

function makeRoofGeoPbr() {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const norm = [];
  const uv = [];
  const pushTri = (a, b, c, uva, uvb, uvc) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    pos.push(...a, ...b, ...c);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uv.push(...uva, ...uvb, ...uvc);
  };
  // Versant Sud (+Z) et Nord (-Z)
  pushTri([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [0, 0], [1, 0], [1, 1]);
  pushTri([-0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0], [0, 0], [1, 1], [0, 1]);
  pushTri([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0, 0], [1, 0], [1, 1]);
  pushTri([0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0], [0, 0], [1, 1], [0, 1]);
  // Pignons Est / Ouest
  pushTri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [0, 0], [1, 0], [0.5, 1]);
  pushTri([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], [0, 0], [1, 0], [0.5, 1]);

  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeArchTunnelGeoPbr(segs = 18) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const norm = [];
  const uv = [];
  const pt = (i) => {
    const a = (i / segs) * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = -ca, ny = 0.5 * sa;
    const l = Math.hypot(nx, ny) || 1;
    return { x: -0.5 * ca, y: sa, u: i / segs, nx: nx / l, ny: ny / l };
  };
  for (let i = 0; i < segs; i++) {
    const p0 = pt(i), p1 = pt(i + 1);
    pos.push(
      p0.x, p0.y, -0.5, p1.x, p1.y, -0.5, p1.x, p1.y, 0.5,
      p0.x, p0.y, -0.5, p1.x, p1.y, 0.5, p0.x, p0.y, 0.5
    );
    norm.push(
      p0.nx, p0.ny, 0, p1.nx, p1.ny, 0, p1.nx, p1.ny, 0,
      p0.nx, p0.ny, 0, p1.nx, p1.ny, 0, p0.nx, p0.ny, 0
    );
    uv.push(
      0, p0.u, 0, p1.u, 1, p1.u,
      0, p0.u, 1, p1.u, 1, p0.u
    );
    // Pignon avant (+Z) & arriere (-Z)
    pos.push(0, 0, 0.5, p1.x, p1.y, 0.5, p0.x, p0.y, 0.5);
    norm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    uv.push(0.5, 0, p1.u, p1.y, p0.u, p0.y);

    pos.push(0, 0, -0.5, p0.x, p0.y, -0.5, p1.x, p1.y, -0.5);
    norm.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
    uv.push(0.5, 0, p0.u, p0.y, p1.u, p1.y);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeArchRibGeoPbr(segs = 18, thickness = 0.048) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const norm = [];
  const uv = [];
  const rIn = 1 - thickness;
  const pushQuad = (a, b, c, d) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) norm.push(nx, ny, nz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI;
    const a1 = ((i + 1) / segs) * Math.PI;
    const ox0 = -0.5 * Math.cos(a0), oy0 = Math.sin(a0);
    const ox1 = -0.5 * Math.cos(a1), oy1 = Math.sin(a1);
    const ix0 = -0.5 * rIn * Math.cos(a0), iy0 = rIn * Math.sin(a0);
    const ix1 = -0.5 * rIn * Math.cos(a1), iy1 = rIn * Math.sin(a1);
    pushQuad([ix0, iy0, 0.5], [ox0, oy0, 0.5], [ox1, oy1, 0.5], [ix1, iy1, 0.5]);
    pushQuad([ox0, oy0, -0.5], [ix0, iy0, -0.5], [ix1, iy1, -0.5], [ox1, oy1, -0.5]);
    pushQuad([ox0, oy0, -0.5], [ox1, oy1, -0.5], [ox1, oy1, 0.5], [ox0, oy0, 0.5]);
    pushQuad([ix0, iy0, 0.5], [ix1, iy1, 0.5], [ix1, iy1, -0.5], [ix0, iy0, -0.5]);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeLeafClusterGeoPbr() {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const norm = [];
  const uv = [];
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const p = (lx, ly) => [lx * ca, ly, lx * sa];
    const pts = [p(-0.22, 0), p(0.22, 0), p(0.5, 0.55), p(0, 1), p(-0.5, 0.55)];
    const uvs = [[0.28, 0], [0.72, 0], [1, 0.55], [0.5, 1], [0, 0.55]];
    const nF = [-sa * 0.45, 0.89, ca * 0.45];
    for (const [ia, ib, ic] of [[0, 1, 2], [0, 2, 3], [0, 3, 4]]) {
      pos.push(...pts[ia], ...pts[ib], ...pts[ic]);
      norm.push(...nF, ...nF, ...nF);
      uv.push(...uvs[ia], ...uvs[ib], ...uvs[ic]);
    }
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeTurbineBladeGeoPbr() {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const norm = [];
  const uv = [];
  const push = (a, b, c) => {
    pos.push(...a, ...b, ...c);
    norm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    uv.push(0, 0, 1, 0, 0.5, 1);
  };
  push([-0.14, 0, 0.04], [0.14, 0, -0.04], [0.05, 1, -0.02]);
  push([-0.14, 0, 0.04], [0.05, 1, -0.02], [-0.03, 1, 0.02]);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeGrassTuftGeoPbr() {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const norm = [];
  const uv = [];
  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI) / 3;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const lean = 0.09;
    const baseW = 0.055;
    const a = [-ca * baseW, 0, -sa * baseW];
    const b = [ca * baseW, 0, sa * baseW];
    const tip = [-sa * lean, 1.0, ca * lean];
    pos.push(...a, ...b, ...tip);
    norm.push(-sa * 0.25, 0.96, ca * 0.25, -sa * 0.25, 0.96, ca * 0.25, -sa * 0.25, 0.96, ca * 0.25);
    uv.push(0, 0, 1, 0, 0.5, 1);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export function createSharedGeometries() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    boxCentered: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0),
    cylCentered: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
    cone: new THREE.ConeGeometry(0.5, 1, 20).translate(0, 0.5, 0),
    sphere: new THREE.SphereGeometry(0.5, 20, 14).translate(0, 0.5, 0),
    sphereCentered: new THREE.SphereGeometry(0.5, 20, 14),
    roof: makeRoofGeoPbr(),
    arch: makeArchTunnelGeoPbr(18),
    archRib: makeArchRibGeoPbr(18, 0.048),
    leafCluster: makeLeafClusterGeoPbr(),
    turbineBlade: makeTurbineBladeGeoPbr(),
    grassTuft: makeGrassTuftGeoPbr(),
  };
}

export function disposeSharedGeometries(geos) {
  Object.values(geos).forEach((g) => g.dispose?.());
}

function addPart(parent, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, shadow = true, renderOrder = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  if (rx || ry || rz) {
    m.rotation.set(rx, ry, rz, "YXZ");
  }
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (renderOrder) m.renderOrder = renderOrder;
  parent.add(m);
  return m;
}

export function buildTerrainMeshPbr(state, mats) {
  const gridSize = (state.farm?.gridSize || 44) + 8;
  const half = gridSize * 0.5;
  const heights = state.terrain?.heights || [];
  const rawRes = state.terrain?.res || 32;

  const subRes = 72;
  const outerRings = 9;
  const totalRes = subRes + outerRings * 2;
  const outerDist = 175;
  const hGrid = [];
  const xCoords = [];
  const zCoords = [];

  for (let ix = 0; ix <= totalRes; ix++) {
    let vx;
    if (ix < outerRings) {
      const t = (outerRings - ix) / outerRings;
      vx = -half - Math.pow(t, 1.85) * (outerDist - half);
    } else if (ix > totalRes - outerRings) {
      const t = (ix - (totalRes - outerRings)) / outerRings;
      vx = half + Math.pow(t, 1.85) * (outerDist - half);
    } else {
      const u = (ix - outerRings) / subRes;
      vx = -half + u * gridSize;
    }
    xCoords.push(vx);
  }
  for (let iz = 0; iz <= totalRes; iz++) zCoords.push(xCoords[iz]);

  for (let gz = 0; gz <= totalRes; gz++) {
    const vz = zCoords[gz];
    for (let gx = 0; gx <= totalRes; gx++) {
      hGrid.push(sampleExtendedTerrainHeight(heights, rawRes, gridSize, xCoords[gx], vz));
    }
  }

  const pos = [];
  const norm = [];
  const col = [];
  const uv = [];
  const N = totalRes + 1;

  const vNorm = (gx, gz) => {
    const xl = Math.max(0, gx - 1), xr = Math.min(totalRes, gx + 1);
    const zd = Math.max(0, gz - 1), zu = Math.min(totalRes, gz + 1);
    const hl = hGrid[gz * N + xl], hr = hGrid[gz * N + xr];
    const hd = hGrid[zd * N + gx], hu = hGrid[zu * N + gx];
    const dx = Math.max(0.1, xCoords[xr] - xCoords[xl]);
    const dz = Math.max(0.1, zCoords[zu] - zCoords[zd]);
    let nx = -(hr - hl) / dx;
    let ny = 1.0;
    let nz = -(hu - hd) / dz;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };

  const vColor = (wx, wz, y, n) => {
    const slope = 1.0 - n[1];
    const dist = Math.hypot(wx, wz);
    const wave = 0.5 + 0.5 * Math.sin(wx * 0.14 + wz * 0.11);
    let r = 0.28 + wave * 0.07;
    let g = 0.52 + wave * 0.08;
    let b = 0.18 + wave * 0.03;
    if (y > 2.2) {
      const hi = Math.min(1, (y - 2.2) / 9);
      r += hi * 0.12;
      g -= hi * 0.03;
      b -= hi * 0.03;
    }
    if (slope > 0.09) {
      const rockMix = Math.min(1, (slope - 0.09) * 3.8);
      r = r * (1 - rockMix) + 0.48 * rockMix;
      g = g * (1 - rockMix) + 0.44 * rockMix;
      b = b * (1 - rockMix) + 0.36 * rockMix;
    }
    if (dist > half + 4) {
      const farMix = Math.min(0.42, (dist - half - 4) / 110);
      r = r * (1 - farMix) + 0.32 * farMix;
      g = g * (1 - farMix) + 0.48 * farMix;
      b = b * (1 - farMix) + 0.26 * farMix;
    }
    return [r, g, b];
  };

  for (let gz = 0; gz < totalRes; gz++) {
    for (let gx = 0; gx < totalRes; gx++) {
      // Ordre CCW vers +Y (visible vue de dessus)
      const idx = [
        [gx, gz], [gx, gz + 1], [gx + 1, gz + 1],
        [gx, gz], [gx + 1, gz + 1], [gx + 1, gz],
      ];
      for (const [cx, cz] of idx) {
        const vx = xCoords[cx];
        const vz = zCoords[cz];
        const vy = hGrid[cz * N + cx];
        const n = vNorm(cx, cz);
        const vc = vColor(vx, vz, vy, n);
        pos.push(vx, vy, vz);
        norm.push(n[0], n[1], n[2]);
        col.push(vc[0], vc[1], vc[2]);
        uv.push(vx / 48 + 0.5, vz / 48 + 0.5);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));

  const mesh = new THREE.Mesh(geo, mats.base.terrain);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function buildRiverPbr(state, mats, H) {
  const group = new THREE.Group();
  const rivers = (state.structures || []).filter((s) => s.type === "river_seg");
  if (!rivers.length) return group;

  const posW = [], normW = [], uvW = [];
  const posB = [], normB = [], uvB = [];

  const emitStrip = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const u0 = i / Math.max(1, pts.length - 1);
      const u1 = (i + 1) / Math.max(1, pts.length - 1);
      posW.push(
        a.lx, a.wy, a.lz, a.rx, a.wy, a.rz, b.rx, b.wy, b.rz,
        a.lx, a.wy, a.lz, b.rx, b.wy, b.rz, b.lx, b.wy, b.lz
      );
      for (let k = 0; k < 6; k++) normW.push(0, 1, 0);
      uvW.push(u0, 0, u0, 1, u1, 1, u0, 0, u1, 1, u1, 0);

      posB.push(
        a.blx, a.by, a.blz, a.brx, a.by, a.brz, b.brx, b.by, b.brz,
        a.blx, a.by, a.blz, b.brx, b.by, b.brz, b.blx, b.by, b.blz
      );
      for (let k = 0; k < 6; k++) normB.push(0, 1, 0);
      uvB.push(u0 * 4, 0, u0 * 4, 1, u1 * 4, 1, u0 * 4, 0, u1 * 4, 1, u1 * 4, 0);
    }
  };

  const sorted = [...rivers].sort((a, b) => a.x - b.x);
  const isMergedHorizontal =
    sorted.length >= 2 &&
    sorted.every((r) => Math.abs(r.rot || 0) < 0.2) &&
    sorted.every((r, idx) => idx === 0 || Math.abs((r.x - (r.w || 12) * 0.5) - (sorted[idx - 1].x + (sorted[idx - 1].w || 12) * 0.5)) < 4.5);

  if (isMergedHorizontal) {
    const first = sorted[0], last = sorted[sorted.length - 1];
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
      raw.push({ x, cz, wy, span });
    }
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
        by: wy - 0.16,
      };
    });
    emitStrip(pts);
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
        const wy = H(cx, cz) + 0.08;
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
      emitStrip(pts);
    }
  }

  const bedGeo = new THREE.BufferGeometry();
  bedGeo.setAttribute("position", new THREE.Float32BufferAttribute(posB, 3));
  bedGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normB, 3));
  bedGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvB, 2));
  const bedMesh = new THREE.Mesh(bedGeo, mats.base.gravel);
  bedMesh.receiveShadow = true;
  group.add(bedMesh);

  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute("position", new THREE.Float32BufferAttribute(posW, 3));
  wGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normW, 3));
  wGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvW, 2));
  const wMesh = new THREE.Mesh(wGeo, mats.base.water);
  wMesh.receiveShadow = true;
  wMesh.renderOrder = 2;
  group.add(wMesh);

  return group;
}

export function buildInstancedGrassPbr(state, geos, mats, H) {
  const blockers = [];
  for (const p of state.plots || []) {
    const r = p.rot || 0;
    const ew = (Math.abs(Math.cos(r)) * (p.w || 7) + Math.abs(Math.sin(r)) * (p.d || 2.3)) * 0.5 + 0.45;
    const ed = (Math.abs(Math.sin(r)) * (p.w || 7) + Math.abs(Math.cos(r)) * (p.d || 2.3)) * 0.5 + 0.45;
    blockers.push([p.x, p.z, ew, ed]);
  }
  for (const s of state.structures || []) {
    if (s.type === "paddock" || s.type === "hedge_tree") continue;
    const r = s.rot || 0;
    const ew = (Math.abs(Math.cos(r)) * (s.w || 3) + Math.abs(Math.sin(r)) * (s.d || 3)) * 0.5 + 0.5;
    const ed = (Math.abs(Math.sin(r)) * (s.w || 3) + Math.abs(Math.cos(r)) * (s.d || 3)) * 0.5 + 0.5;
    blockers.push([s.x, s.z, ew, ed]);
  }

  const gridSize = state.farm?.gridSize || 44;
  const span = gridSize * 0.58;
  const maxTufts = 2200;
  const matrices = [];
  const colors = [];
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();

  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let attempt = 0; attempt < maxTufts * 2 && matrices.length < maxTufts; attempt++) {
    const gx = (rnd() * 2 - 1) * span;
    const gz = (rnd() * 2 - 1) * span;
    let blocked = false;
    for (let b = 0; b < blockers.length; b++) {
      const bl = blockers[b];
      if (Math.abs(gx - bl[0]) < bl[2] && Math.abs(gz - bl[1]) < bl[3]) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const gy = H(gx, gz);
    dummy.position.set(gx, gy - 0.02, gz);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    const sc = 0.8 + rnd() * 0.75;
    const hy = 0.16 + rnd() * 0.22;
    dummy.scale.set(sc * 1.15, hy, sc * 1.15);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());

    const shade = 0.82 + rnd() * 0.36;
    c.setRGB(0.20 * shade, 0.46 * shade, 0.12 * shade);
    colors.push(c.clone());
  }

  const inst = new THREE.InstancedMesh(geos.grassTuft, mats.base.grassBlade, Math.max(1, matrices.length));
  for (let i = 0; i < matrices.length; i++) {
    inst.setMatrixAt(i, matrices[i]);
    inst.setColorAt(i, colors[i]);
  }
  inst.count = matrices.length;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.receiveShadow = true;
  inst.castShadow = false;
  return inst;
}

export function buildPerimeterTreesPbr(state, geos, mats) {
  const group = new THREE.Group();
  const gSize = (state.farm?.gridSize || 44) + 8;
  const tHeights = state.terrain?.heights || [];
  const tRes = state.terrain?.res || 32;
  const rivers = (state.structures || []).filter((s) => s.type === "river_seg");
  const riverZ = rivers.length ? rivers[0].z : null;

  for (let i = 0; i < 46; i++) {
    const ang = i * 2.39996 + 0.4;
    const rad = 28 + ((i * 7.3) % 30);
    const tx = Math.cos(ang) * rad;
    const tz = Math.sin(ang) * rad;
    if (Math.max(Math.abs(tx), Math.abs(tz)) < gSize * 0.54) continue;
    if (riverZ !== null && Math.abs(tz - riverZ) < 6.5) continue;

    const ty = sampleExtendedTerrainHeight(tHeights, tRes, gSize, tx, tz);
    const sc = 0.9 + ((i * 13) % 7) * 0.14;
    const tg = new THREE.Group();
    tg.position.set(tx, ty, tz);

    addPart(tg, geos.cyl, mats.base.bark, 0, -0.3, 0, 0.4 * sc, 2.2 * sc, 0.4 * sc);
    const gCol = hexFromRgba(0.16 + (i % 3) * 0.03, 0.43 + (i % 3) * 0.04, 0.14);
    const leafMat = mats.getVariant("foliage", gCol);
    const leafMatLt = mats.getVariant("foliage", 0x347f2b);
    addPart(tg, geos.sphere, leafMat, 0, 1.45 * sc, 0, 2.85 * sc, 2.45 * sc, 2.85 * sc);
    addPart(tg, geos.sphere, leafMatLt, 0.6 * sc, 2.25 * sc, -0.4 * sc, 2.1 * sc, 1.9 * sc, 2.1 * sc);
    addPart(tg, geos.leafCluster, leafMatLt, 0, 1.35 * sc, 0, 3.05 * sc, 2.65 * sc, 3.05 * sc, 0, i * 0.7, 0);
    group.add(tg);
  }
  return group;
}

export function buildCadastralParcelsPbr(state, geos, mats, H) {
  const group = new THREE.Group();
  const arPins = [];
  const parcels = state.farm?.cadastralParcels || [];
  const lineMat = mats.getVariant("standard", 0xfacc15, { emissive: 0.25, emissiveColor: 0xeab308 });
  const stakeMat = mats.getVariant("metalSmooth", 0xfde047, { emissive: 0.2, emissiveColor: 0xeab308 });

  for (const parcel of parcels) {
    const pts = parcel.points || [];
    if (pts.length < 3) continue;
    let sumX = 0, sumZ = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      sumX += x0; sumZ += z0;
      const dx = x1 - x0, dz = z1 - z0;
      const edgeLen = Math.hypot(dx, dz);
      if (edgeLen < 0.1) continue;
      const edgeRot = Math.atan2(-dz, dx);
      const segs = Math.max(1, Math.ceil(edgeLen / 4.5));
      for (let sIdx = 0; sIdx < segs; sIdx++) {
        const t = (sIdx + 0.5) / segs;
        const mx = x0 + dx * t;
        const mz = z0 + dz * t;
        addPart(group, geos.box, lineMat, mx, H(mx, mz) + 0.03, mz, edgeLen / segs + 0.1, 0.07, 0.22, 0, edgeRot, 0, false);
      }
      addPart(group, geos.cyl, stakeMat, x0, H(x0, z0), z0, 0.22, 0.36, 0.22);
    }
    const cx = sumX / pts.length;
    const cz = sumZ / pts.length;
    arPins.push({ id: `CAD-${parcel.id}`, label: `🟨 ${parcel.label || parcel.id}`, x: cx, y: H(cx, cz) + 2.4, z: cz, warn: false });
  }
  return { group, arPins };
}

function getPlotTintHex(p, snap, overlay) {
  const moist = snap?.moisturePct ?? p.moisturePct;
  const health = snap?.healthPct ?? p.healthPct;
  const risk = snap?.diseaseRisk ?? p.diseaseRisk;
  if (overlay === "moisture") return moist < 35 ? 0xe84d35 : moist < 60 ? 0x45c761 : 0x2494f2;
  if (overlay === "health") return health > 82 ? 0x29d15c : health > 65 ? 0xe6b833 : 0xe64040;
  if (overlay === "disease") return risk > 50 ? 0xf23859 : risk > 25 ? 0xf2a626 : 0x38bf73;
  return null;
}

export function buildPlotsAndCropsPbr(state, snapMap, geos, mats, overlay, selectedId, sunIsDay, H) {
  const group = new THREE.Group();
  const animItems = [];
  const hitBoxes = [];
  const arPins = [];

  for (const p of state.plots || []) {
    const w = p.w || 7, d = p.d || 2.3, rot = p.rot || 0;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const baseY = H(p.x, p.z);
    const snap = snapMap.get(p.id);
    const progress = Math.max(0.14, (snap?.progressPct ?? 55) / 100);
    const tintHex = getPlotTintHex(p, snap, overlay);
    const crop = getCropById(p.cropId);
    const shape = crop.shape || "leafy_head";
    const isSel = selectedId === p.id;
    const emSel = isSel ? 0.28 : 0;

    const plotRoot = new THREE.Group();
    plotRoot.position.set(p.x, baseY, p.z);
    plotRoot.rotation.y = rot;
    group.add(plotRoot);

    const moistRatio = (snap?.moisturePct ?? p.moisturePct) / 100;
    const cDry = new THREE.Color(0.76, 0.56, 0.39);
    const cWet = new THREE.Color(0.38, 0.27, 0.18);
    const soilColorHex = tintHex ?? cDry.lerp(cWet, moistRatio).getHex();
    const soilMat = mats.getVariant("soil", soilColorHex, { emissive: emSel });
    addPart(plotRoot, geos.box, soilMat, 0, -0.1, 0, w, 0.32, d, 0, 0, 0, false);

    if (p.zone !== "Serre") {
      const woodMat = mats.getVariant("wood", 0xc8a882);
      addPart(plotRoot, geos.box, woodMat, 0, 0.02, d * 0.5 + 0.03, w + 0.08, 0.2, 0.07);
      addPart(plotRoot, geos.box, woodMat, 0, 0.02, -d * 0.5 - 0.03, w + 0.08, 0.2, 0.07);
    }

    const dripMat = mats.getVariant("standard", 0x1e2024);
    const nRows = 3;
    const nCols = Math.max(6, Math.min(10, Math.round(w * 0.9)));
    for (let r = 0; r < nRows; r++) {
      const localZ = ((r + 0.5) / nRows - 0.5) * (d * 0.76);
      addPart(plotRoot, geos.cylCentered, dripMat, 0, 0.23, localZ, 0.04, w * 0.88, 0.04, 0, 0, Math.PI / 2, false);
    }

    const foliageGreen = mats.getVariant("foliage", 0x45a33b, { emissive: emSel });
    const foliageDeep = mats.getVariant("foliage", 0x2e822a, { emissive: emSel });
    const foliageGold = mats.getVariant("foliage", 0xe6bf33, { emissive: emSel });
    const cropRgbHex = new THREE.Color(crop.color || "#ef4444").getHex();
    const fruitMat = mats.getVariant("standard", cropRgbHex, { emissive: emSel + 0.04 });

    for (let r = 0; r < nRows; r++) {
      const localZ = ((r + 0.5) / nRows - 0.5) * (d * 0.76);
      for (let c = 0; c < nCols; c++) {
        const jitter = Math.sin(c * 1.9 + r * 3.1) * 0.08;
        const localX = ((c + 0.5) / nCols - 0.5) * (w * 0.86) + jitter;
        const wx = p.x + cosR * localX + sinR * localZ;
        const wz = p.z - sinR * localX + cosR * localZ;
        const pyLocal = H(wx, wz) - baseY + 0.21;

        if (tintHex !== null) {
          const ovMat = mats.getVariant("foliage", tintHex, { emissive: emSel + 0.1 });
          addPart(plotRoot, geos.sphere, ovMat, localX, pyLocal, localZ, 0.54, 0.52 * progress + 0.18, 0.48);
          continue;
        }

        if (shape === "staked_fruit") {
          const hCrop = (0.65 + progress * 1.15) * (crop.heightM / 1.8);
          const stakeMat = mats.getVariant("wood", 0xb88c58);
          addPart(plotRoot, geos.cyl, stakeMat, localX, pyLocal, localZ, 0.045, hCrop * 1.08, 0.045);
          addPart(plotRoot, geos.leafCluster, foliageGreen, localX, pyLocal + 0.04, localZ, 0.58, hCrop * 0.9, 0.58, 0, c * 1.1 + r, 0);
          addPart(plotRoot, geos.sphere, foliageDeep, localX, pyLocal + hCrop * 0.25, localZ, 0.42, hCrop * 0.65, 0.42);
          if (progress > 0.45) {
            const fSz = 0.13 + progress * 0.08;
            addPart(plotRoot, geos.sphere, fruitMat, localX + 0.16, pyLocal + hCrop * 0.55, localZ + 0.12, fSz, fSz, fSz);
            addPart(plotRoot, geos.sphere, fruitMat, localX - 0.14, pyLocal + hCrop * 0.38, localZ - 0.12, fSz * 0.9, fSz * 0.9, fSz * 0.9);
          }
        } else if (shape === "tall_stalk") {
          const hCrop = 0.7 + progress * 1.45;
          addPart(plotRoot, geos.cyl, foliageGreen, localX, pyLocal, localZ, 0.09, hCrop, 0.09);
          addPart(plotRoot, geos.leafCluster, foliageGreen, localX, pyLocal + hCrop * 0.25, localZ, 0.56, hCrop * 0.62, 0.56, 0, c * 0.9, 0);
          if (progress > 0.65) {
            addPart(plotRoot, geos.cone, foliageGold, localX, pyLocal + hCrop * 0.92, localZ, 0.16, 0.26, 0.16);
          }
        } else if (shape === "sunflower") {
          const hCrop = 0.75 + progress * 1.35;
          addPart(plotRoot, geos.cyl, foliageGreen, localX, pyLocal, localZ, 0.1, hCrop, 0.1);
          addPart(plotRoot, geos.leafCluster, foliageGreen, localX, pyLocal + hCrop * 0.22, localZ, 0.44, hCrop * 0.48, 0.44, 0, r * 1.2, 0);
          const flCol = progress > 0.4 ? 0xfacc15 : 0x52b838;
          addPart(plotRoot, geos.cylCentered, mats.getVariant("standard", flCol, { emissive: 0.06 + emSel }), localX, pyLocal + hCrop, localZ, 0.46, 0.1, 0.46, Math.PI / 2.6, 0, 0);
          addPart(plotRoot, geos.sphereCentered, mats.getVariant("standard", 0x3b2410), localX, pyLocal + hCrop, localZ + 0.05, 0.22, 0.22, 0.1);
        } else if (shape === "vine_trellis") {
          const hV = 1.2 + progress * 0.42;
          if (c % 3 === 0) {
            addPart(plotRoot, geos.cyl, mats.getVariant("wood", 0x8a613a), localX, pyLocal, localZ, 0.08, hV + 0.25, 0.08);
          }
          addPart(plotRoot, geos.leafCluster, foliageGreen, localX, pyLocal + 0.45, localZ, 0.66, 0.92, 0.56, 0, c * 0.7, 0);
          addPart(plotRoot, geos.sphere, foliageDeep, localX, pyLocal + 0.58, localZ, 0.56, 0.62, 0.5);
          if (progress > 0.55) {
            addPart(plotRoot, geos.cone, mats.getVariant("standard", 0x6b2896, { emissive: emSel }), localX + 0.12, pyLocal + 0.42, localZ + 0.15, 0.14, 0.24, 0.14, Math.PI, 0, 0);
          }
        } else if (shape === "cereal_field") {
          const hCrop = 0.38 + progress * 0.72;
          const col = progress > 0.78 ? foliageGold : foliageGreen;
          addPart(plotRoot, geos.leafCluster, col, localX, pyLocal, localZ, 0.48, hCrop, 0.48, 0, c * 0.7 + r, 0);
          addPart(plotRoot, geos.leafCluster, col, localX + 0.06, pyLocal, localZ + 0.05, 0.42, hCrop * 0.95, 0.42, 0, c * 1.4, 0);
        } else if (shape === "berry_row") {
          addPart(plotRoot, geos.leafCluster, foliageGreen, localX, pyLocal, localZ, 0.54, 0.44 * progress + 0.14, 0.54, 0, c * 0.8, 0);
          if (progress > 0.42) {
            addPart(plotRoot, geos.sphere, mats.getVariant("standard", 0xe82436, { emissive: emSel }), localX + 0.11, pyLocal + 0.12, localZ + 0.1, 0.11, 0.12, 0.11);
            addPart(plotRoot, geos.sphere, mats.getVariant("standard", 0xe82436, { emissive: emSel }), localX - 0.1, pyLocal + 0.14, localZ - 0.09, 0.1, 0.11, 0.1);
          }
        } else if (shape === "bush_fruit") {
          const sc = 0.48 + progress * 0.34;
          addPart(plotRoot, geos.leafCluster, foliageDeep, localX, pyLocal, localZ, sc * 1.25, sc * 1.05, sc * 1.25, 0, c * 0.9, 0);
          addPart(plotRoot, geos.sphere, foliageGreen, localX, pyLocal + sc * 0.22, localZ, sc * 0.92, sc * 0.82, sc * 0.92);
          if (progress > 0.48) {
            addPart(plotRoot, geos.sphere, mats.getVariant("standard", 0x521873, { emissive: emSel }), localX + 0.14, pyLocal + sc * 0.42, localZ + 0.12, 0.14, 0.2, 0.14);
          }
        } else if (shape === "mound_vine") {
          const sc = 0.5 + progress * 0.42;
          addPart(plotRoot, geos.leafCluster, foliageDeep, localX, pyLocal, localZ, sc * 1.38, sc * 0.72, sc * 1.38, 0, c * 1.1, 0);
          if (progress > 0.5) {
            const zCol = crop.id === "courge" ? 0xe86b1a : 0x226e32;
            addPart(plotRoot, geos.sphere, mats.getVariant("standard", zCol), localX + 0.14, pyLocal + 0.05, localZ + 0.12, 0.2, 0.18, 0.32, 0, r * 0.6, 0);
          }
        } else if (shape === "root_tuft" || shape === "tall_onion") {
          const hLeaf = 0.32 + progress * (shape === "tall_onion" ? 0.56 : 0.34);
          const lCol = mats.getVariant("foliage", shape === "tall_onion" ? 0x3b8c6b : 0x389c3b);
          addPart(plotRoot, geos.leafCluster, lCol, localX, pyLocal, localZ, 0.38, hLeaf, 0.38, 0, c * 1.1, 0);
          if (crop.id === "radis" || crop.id === "pomme_de_terre") {
            addPart(plotRoot, geos.sphere, mats.getVariant("standard", crop.id === "radis" ? 0xe82e46 : 0xc49c64), localX, pyLocal - 0.02, localZ, 0.16, 0.16, 0.16);
          }
        } else if (shape === "flat_herb" || shape === "green_manure") {
          const col = shape === "green_manure" ? mats.getVariant("foliage", 0x626cf5) : foliageGreen;
          addPart(plotRoot, geos.leafCluster, col, localX, pyLocal, localZ, 0.48, 0.28 + progress * 0.32, 0.48, 0, c * 0.8 + r, 0);
        } else {
          const headHex = crop.id === "chou" ? 0x2d8a56 : crop.id === "epinard" ? 0x249442 : 0x6ecc38;
          const headMat = mats.getVariant("foliage", headHex, { emissive: emSel });
          const sz = 0.28 + progress * 0.28;
          addPart(plotRoot, geos.leafCluster, headMat, localX, pyLocal, localZ, sz * 1.4, sz * 0.85, sz * 1.4, 0, c, 0);
          addPart(plotRoot, geos.sphere, headMat, localX, pyLocal + 0.02, localZ, sz * 1.08, sz * 0.82, sz * 1.08);
        }
      }
    }

    // Aspersion animee
    if (p.irrigationValveOpen) {
      const dropMat = mats.base.water;
      for (let k = -2; k <= 2; k++) {
        const drop = addPart(plotRoot, geos.sphere, dropMat, k * (w * 0.18), 0.5, 0, 0.14, 0.24, 0.14, 0, 0, 0, false, 3);
        animItems.push({ kind: "drop", mesh: drop, baseY: 0.45, phase: k * 0.2 });
      }
    }

    // Enveloppes Serres (Tunnel, Bi-Tunnel ou Venlo verre)
    if (p.zone === "Serre") {
      const isGlass = p.structureStyle === "glass_house" || (w >= 9.5 && d >= 6);
      const metalRibMat = mats.getVariant("metalSmooth", 0xc8d2dc);
      const ghEm = !sunIsDay ? 0.3 : 0;
      const ventTilt = ((p.ventOpeningPct || 20) / 100) * 0.42;

      if (isGlass) {
        const glassMat = mats.base.glassVenlo;
        addPart(plotRoot, geos.box, glassMat, 0, 0.02, 0, w, 2.2, d, 0, 0, 0, false, 5);
        addPart(plotRoot, geos.roof, glassMat, 0, 2.22 + ventTilt * 0.25, 0, w + 0.08, 1.25, d + 0.08, ventTilt * 0.55, 0, 0, false, 5);
        for (let m = -2; m <= 2; m++) {
          const mx = (m / 2) * (w * 0.46);
          addPart(plotRoot, geos.box, metalRibMat, mx, 0.02, d * 0.5, 0.09, 2.22, 0.09);
          addPart(plotRoot, geos.box, metalRibMat, mx, 0.02, -d * 0.5, 0.09, 2.22, 0.09);
        }
      } else if (p.biTunnel) {
        const bayD = d * 0.5;
        const filmMat = overlay === "disease" && p.diseaseRisk > 35
          ? mats.getVariant("polyFilmBi", 0xf25c5c, { opacity: 0.42 })
          : mats.base.polyFilmBi;
        for (const bz of [-bayD * 0.5, bayD * 0.5]) {
          addPart(plotRoot, geos.arch, filmMat, 0, 0.02, bz, bayD, 2.75, w, 0, Math.PI / 2, 0, false, 5);
          for (let r = 0; r < 5; r++) {
            const rx = (r / 4 - 0.5) * (w * 0.96);
            addPart(plotRoot, geos.archRib, metalRibMat, rx, 0.02, bz, bayD + 0.04, 2.78, 0.08, 0, Math.PI / 2, 0);
          }
          addPart(plotRoot, geos.cylCentered, metalRibMat, 0, 2.74, bz, 0.06, w, 0.06, 0, 0, Math.PI / 2);
        }
        addPart(plotRoot, geos.box, metalRibMat, 0, 0.06, 0, w, 0.14, 0.14);
      } else {
        const filmMat = overlay === "disease" && p.diseaseRisk > 35
          ? mats.getVariant("polyFilm", 0xf25c5c, { opacity: 0.42 })
          : mats.base.polyFilm;
        addPart(plotRoot, geos.arch, filmMat, 0, 0.02, 0, d, 2.95, w, 0, Math.PI / 2, 0, false, 5);
        for (let r = 0; r < 5; r++) {
          const rx = (r / 4 - 0.5) * (w * 0.96);
          addPart(plotRoot, geos.archRib, metalRibMat, rx, 0.02, 0, d + 0.06, 2.98, 0.09, 0, Math.PI / 2, 0);
        }
        addPart(plotRoot, geos.cylCentered, metalRibMat, 0, 2.94, 0, 0.07, w, 0.07, 0, 0, Math.PI / 2);
        if ((p.ventOpeningPct || 0) > 10) {
          addPart(plotRoot, geos.box, filmMat, 0, 2.08, d * 0.34, w * 0.72, 0.05, 0.5, -0.62 - ventTilt, 0, 0, false, 5);
        }
      }

      if (!sunIsDay) {
        const lampMat = mats.getVariant("standard", 0xffd97a, { emissive: 1.0 + ghEm, emissiveColor: 0xffc65c });
        addPart(plotRoot, geos.sphereCentered, lampMat, -w * 0.25, 2.28, 0, 0.26, 0.2, 0.26, 0, 0, 0, false);
        addPart(plotRoot, geos.sphereCentered, lampMat, w * 0.25, 2.28, 0, 0.26, 0.2, 0.26, 0, 0, 0, false);
      }
    }

    const effW = Math.abs(cosR) * w + Math.abs(sinR) * d;
    const effD = Math.abs(sinR) * w + Math.abs(cosR) * d;
    hitBoxes.push({ kind: "plot", id: p.id, label: p.name, x: p.x, z: p.z, w: effW, d: effD, y0: baseY, y1: baseY + (p.zone === "Serre" ? 3.4 : 1.8), data: p });
    arPins.push({
      id: p.id,
      label: `${crop.icon} ${p.id} · ${snap?.moisturePct ?? p.moisturePct}% eau · ${snap?.progressPct ?? 55}%`,
      x: p.x,
      y: baseY + (p.zone === "Serre" ? 3.5 : 1.6),
      z: p.z,
      warn: (snap?.moisturePct ?? p.moisturePct) < 38 || (snap?.diseaseRisk ?? p.diseaseRisk) > 45,
    });
  }

  return { group, animItems, hitBoxes, arPins };
}

export function buildStructuresPbr(state, geos, mats, sunIsDay, selectedId, H, glbCache, requestGlb) {
  const group = new THREE.Group();
  const animItems = [];
  const hitBoxes = [];
  const arPins = [];
  const nightGlow = sunIsDay ? 0.08 : 0.78;

  for (const s of state.structures || []) {
    const isSel = selectedId === s.id;
    const emSel = isSel ? 0.28 : 0;
    const w = s.w || 3, d = s.d || 3, h = s.h || 2.5, rot = s.rot || 0;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const sy = H(s.x, s.z);

    const sRoot = new THREE.Group();
    sRoot.position.set(s.x, sy, s.z);
    sRoot.rotation.y = rot;
    group.add(sRoot);

    const stoneMat = mats.getVariant("stone", 0xfaf6f0, { emissive: emSel });
    const tileMat = mats.getVariant("roofTile", 0xf8eae4, { emissive: emSel });
    const woodMat = mats.getVariant("wood", 0xe8d5bf, { emissive: emSel });
    const plinthMat = mats.getVariant("stone", 0x9c968b);
    const glassWinMat = mats.getVariant("standard", 0xf5dc8e, { emissive: nightGlow, emissiveColor: 0xffd268 });
    const addPlinth = (pw, pd) => addPart(sRoot, geos.box, plinthMat, 0, -1.5, 0, pw + 0.14, 1.62, pd + 0.14);

    const addWindows = (lz, yLevel, count, spacing, winW = 0.62, winH = 0.85, shutters = true) => {
      const shutMat = mats.getVariant("wood", 0x5c8470);
      for (let k = -(count - 1) / 2; k <= (count - 1) / 2; k += 1) {
        const wx = k * spacing;
        addPart(sRoot, geos.box, glassWinMat, wx, yLevel, lz, winW, winH, 0.08);
        addPart(sRoot, geos.box, plinthMat, wx, yLevel - 0.04, lz + 0.04, winW + 0.12, 0.08, 0.12);
        if (shutters) {
          addPart(sRoot, geos.box, shutMat, wx - winW * 0.68, yLevel, lz + 0.02, winW * 0.34, winH, 0.05);
          addPart(sRoot, geos.box, shutMat, wx + winW * 0.68, yLevel, lz + 0.02, winW * 0.34, winH, 0.05);
        }
      }
    };

    if (s.type === "farmhouse_courtyard") {
      addPlinth(w, d);
      addPart(sRoot, geos.box, mats.base.gravel, 0, 0.04, 0.3, w * 0.94, 0.14, d * 0.88, 0, 0, 0, false);
      addPart(sRoot, geos.cyl, stoneMat, 0, 0.12, d * 0.14, 1.15, 0.58, 1.15);
      addPart(sRoot, geos.cyl, mats.base.water, 0, 0.64, d * 0.14, 0.9, 0.08, 0.9, 0, 0, 0, false, 2);

      const mainH = h * 0.68;
      addPart(sRoot, geos.box, stoneMat, 0, 0.1, -d * 0.26, w, mainH, d * 0.42);
      addPart(sRoot, geos.roof, tileMat, 0, 0.1 + mainH, -d * 0.26, w + 0.5, h * 0.42, d * 0.48);
      addPart(sRoot, geos.box, tileMat, 0, 0.1 + mainH + h * 0.39, -d * 0.26, w + 0.52, 0.1, 0.16);
      addPart(sRoot, geos.box, stoneMat, -w * 0.28, h * 0.66, -d * 0.26, 0.68, h * 0.52, 0.68);

      const smokeMat = mats.getVariant("standard", 0xe2e8f0, { opacity: 0.42 });
      for (let sm = 0; sm < 3; sm++) {
        const smMesh = addPart(sRoot, geos.sphereCentered, smokeMat, -w * 0.28, h * 1.3 + sm * 0.55, -d * 0.26, 0.35, 0.3, 0.35, 0, 0, 0, false);
        animItems.push({ kind: "smoke", mesh: smMesh, baseX: -w * 0.28, baseY: h * 1.18, baseZ: -d * 0.26, phase: sm * 0.33 });
      }

      for (const side of [-1, 1]) {
        const ax = side * w * 0.36;
        const wingH = h * 0.54;
        addPart(sRoot, geos.box, stoneMat, ax, 0.1, d * 0.15, w * 0.26, wingH, d * 0.56);
        addPart(sRoot, geos.roof, tileMat, ax, 0.1 + wingH, d * 0.15, d * 0.6, h * 0.32, w * 0.31, 0, Math.PI / 2, 0);
      }

      addWindows(-d * 0.045, 0.85, 4, 2.55, 0.6, 0.82, true);
      addWindows(-d * 0.045, 2.05, 5, 1.65, 0.58, 0.78, true);
      addPart(sRoot, geos.box, woodMat, 0, 0.1, -d * 0.045, 1.5, 2.1, 0.1);
    } else if (s.type === "farm_house" || s.type === "stone_barn") {
      addPlinth(w, d);
      addPart(sRoot, geos.box, stoneMat, 0, 0.05, 0, w, h * 0.68, d);
      addPart(sRoot, geos.roof, tileMat, 0, 0.05 + h * 0.68, 0, w + 0.45, h * 0.42, d + 0.45);
      addPart(sRoot, geos.box, woodMat, 0, 0.05, d * 0.505, w * 0.34, h * 0.52, 0.1);
      addWindows(d * 0.505, h * 0.42, 2, w * 0.66, 0.56, 0.72, s.type === "farm_house");
      if (s.type === "stone_barn") {
        const hayMat = mats.getVariant("foliage", 0xdcb444);
        addPart(sRoot, geos.cylCentered, hayMat, w * 0.58, 0.55, d * 0.2, 1.1, 1.0, 1.1, Math.PI / 2, 0.3, 0);
        addPart(sRoot, geos.cylCentered, hayMat, w * 0.62, 0.55, -d * 0.2, 1.1, 1.0, 1.1, Math.PI / 2, -0.2, 0);
      }
    } else if (s.type === "farm_shop") {
      addPlinth(w, d);
      addPart(sRoot, geos.box, stoneMat, 0, 0.05, 0, w, h * 0.72, d);
      addPart(sRoot, geos.roof, tileMat, 0, 0.05 + h * 0.72, 0, w + 0.4, h * 0.35, d + 0.4);
      for (let i = -2; i <= 2; i++) {
        const stripCol = Math.abs(i) % 2 === 0 ? 0xe03333 : 0xf5eddb;
        addPart(sRoot, geos.box, mats.getVariant("standard", stripCol, { emissive: 0.05 }), i * (w * 0.18), 1.85, d * 0.66, w * 0.185, 0.1, 1.35, 0.28, 0, 0);
      }
      addPart(sRoot, geos.cyl, woodMat, -w * 0.42, 0, d * 0.8, 0.1, 1.65, 0.1);
      addPart(sRoot, geos.cyl, woodMat, w * 0.42, 0, d * 0.8, 0.1, 1.65, 0.1);
      addPart(sRoot, geos.box, woodMat, -0.95, 0.04, d * 0.65, 1.35, 0.68, 0.72);
      addPart(sRoot, geos.box, woodMat, 0.95, 0.04, d * 0.65, 1.35, 0.68, 0.72);
      addPart(sRoot, geos.sphere, mats.getVariant("standard", 0xeb3829), -1.0, 0.68, d * 0.65, 0.45, 0.28, 0.45);
      addPart(sRoot, geos.sphere, mats.getVariant("standard", 0x38c747), -0.6, 0.68, d * 0.65, 0.45, 0.28, 0.45);
      addPart(sRoot, geos.sphere, mats.getVariant("standard", 0xf58524), 0.75, 0.68, d * 0.65, 0.45, 0.28, 0.45);
      addPart(sRoot, geos.sphere, mats.getVariant("standard", 0xf5d129), 1.15, 0.68, d * 0.65, 0.45, 0.28, 0.45);
    } else if (s.type === "hangar" || s.type === "barn_livestock") {
      addPlinth(w, d);
      const isHangar = s.type === "hangar";
      const wallMat = isHangar
        ? mats.getVariant("metalCorrugated", s.lightRoof ? 0xcad3dc : 0x768594, { emissive: emSel })
        : mats.getVariant("wood", 0xbfa17d, { emissive: emSel });
      const roofMat = isHangar
        ? mats.getVariant("metalCorrugated", s.lightRoof ? 0xdbe2e9 : 0x5c6b78, { emissive: emSel })
        : tileMat;
      addPart(sRoot, geos.box, wallMat, 0, 0.06, 0, w, h * 0.68, d);
      addPart(sRoot, geos.roof, roofMat, 0, 0.06 + h * 0.68, 0, w + 0.4, h * 0.42, d + 0.4);
      if (isHangar) {
        // Lanterneau translucide sur faîtage du hangar
        addPart(sRoot, geos.box, mats.base.polyFilm, 0, 0.06 + h * 1.07, 0, w * 0.72, 0.08, 0.55, 0, 0, 0, false, 4);
      }
      for (const px of [-w * 0.46, 0, w * 0.46]) {
        addPart(sRoot, geos.box, isHangar ? mats.base.metalSmooth : woodMat, px, 0.06, d * 0.51, 0.22, h * 0.68, 0.22);
      }
      addPart(sRoot, geos.box, mats.getVariant("standard", 0x262b30), 0, 0.06, d * 0.505, w * 0.46, h * 0.56, 0.08);
      if (!isHangar) {
        addPart(sRoot, geos.box, woodMat, 0, 0.12, d * 0.62, w * 0.72, 0.55, 0.55);
        addPart(sRoot, geos.box, mats.getVariant("foliage", 0xe0bd47), 0, 0.45, d * 0.62, w * 0.65, 0.32, 0.44);
      }
    } else if (s.type === "locker_kiosk") {
      addPlinth(w, d);
      addPart(sRoot, geos.box, mats.getVariant("metalCorrugated", 0x3b444f, { emissive: emSel }), 0, 0.06, -0.08, w, h * 0.74, d * 0.76);
      addPart(sRoot, geos.box, mats.getVariant("metalCorrugated", 0x1e8f44), 0, 0.06 + h * 0.74, 0.12, w + 0.35, 0.14, d + 0.45, 0.08, 0, 0);
      addPart(sRoot, geos.box, mats.getVariant("standard", 0x2ec75c, { emissive: 0.32 }), 0, 0.06 + h * 0.84, d * 0.38, w * 0.86, 0.28, 0.08);
      const doorMat = mats.getVariant("metalSmooth", 0xe6ecf2);
      const ledMat = mats.getVariant("standard", 0x22c55e, { emissive: 0.85, emissiveColor: 0x22c55e });
      for (let c = -1; c <= 1; c++) {
        for (let r = 0; r < 3; r++) {
          const lx = c * (w * 0.22) - w * 0.08;
          const ly = 0.22 + r * (h * 0.21);
          addPart(sRoot, geos.box, doorMat, lx, ly, d * 0.365, w * 0.19, h * 0.17, 0.08);
          addPart(sRoot, geos.box, ledMat, lx + w * 0.075, ly + h * 0.07, d * 0.408, 0.05, 0.05, 0.02, 0, 0, 0, false);
        }
      }
      addPart(sRoot, geos.box, mats.getVariant("standard", 0x38e0f5, { emissive: 0.78 }), w * 0.34, 0.78, d * 0.37, 0.48, 0.62, 0.09);
    } else if (s.type === "conserverie_coldroom") {
      addPlinth(w, d);
      addPart(sRoot, geos.box, mats.getVariant("whitePanel", 0xffffff, { emissive: emSel }), 0, 0.06, 0, w, h * 0.72, d);
      addPart(sRoot, geos.roof, mats.getVariant("metalCorrugated", 0x738291, { emissive: emSel }), 0, 0.06 + h * 0.72, 0, w + 0.24, h * 0.28, d + 0.24);
      addPart(sRoot, geos.box, mats.getVariant("metalSmooth", 0xd0dce6), -w * 0.16, 0.08, d * 0.505, 1.35, h * 0.58, 0.08);
      addPart(sRoot, geos.box, glassWinMat, w * 0.22, 0.88, d * 0.505, 1.0, 0.65, 0.07);
      addPart(sRoot, geos.box, mats.base.metalSmooth, -w * 0.28, 0.06 + h * 0.88, -d * 0.15, 1.05, 0.62, 0.78);
      addPart(sRoot, geos.cyl, mats.base.metalSmooth, w * 0.32, 0.06 + h * 0.85, 0.1, 0.26, 0.95, 0.26);
    } else if (s.type === "tarp_pad") {
      addPart(sRoot, geos.box, mats.getVariant("tarp", 0xffffff, { emissive: emSel }), 0, 0.02, 0, w, 0.08, d, 0, 0, 0, false);
      const sandbagMat = mats.getVariant("standard", 0x34383d);
      for (const [bx, bz] of [[-w * 0.44, -d * 0.42], [w * 0.44, -d * 0.42], [-w * 0.44, d * 0.42], [w * 0.44, d * 0.42], [-w * 0.44, 0], [w * 0.44, 0]]) {
        addPart(sRoot, geos.box, sandbagMat, bx, 0.08, bz, 0.36, 0.12, 0.52);
      }
    } else if (s.type === "grain_silo") {
      addPlinth(w, d);
      const siloMat = mats.getVariant("metalCorrugated", 0xd8e1ea, { emissive: emSel });
      addPart(sRoot, geos.cyl, siloMat, 0, 0.08, 0, w, h * 0.78, d);
      for (let b = 1; b <= 3; b++) {
        addPart(sRoot, geos.cyl, mats.base.metalSmooth, 0, 0.08 + b * h * 0.19, 0, w * 1.03, 0.1, d * 1.03);
      }
      addPart(sRoot, geos.cone, mats.getVariant("metalSmooth", 0xa8b8c8, { emissive: emSel }), 0, 0.08 + h * 0.78, 0, w * 1.06, h * 0.24, d * 1.06);
      addPart(sRoot, geos.cyl, mats.base.metalSmooth, 0, 0.08 + h * 1.0, 0, w * 0.22, 0.38, d * 0.22);
      addPart(sRoot, geos.box, mats.base.metalSmooth, w * 0.52, 0.2, 0, 0.12, h * 0.75, 0.45);
      addPart(sRoot, geos.cyl, mats.base.metalSmooth, -w * 0.5, 0.3, 0, 0.22, h * 0.85, 0.22, 0, 0, 0.48);
    } else if (s.type === "coop_mobile" || s.type === "coop_fixed") {
      const lift = s.type === "coop_mobile" ? 0.32 : 0.06;
      if (s.type === "coop_fixed") addPlinth(w, d);
      addPart(sRoot, geos.box, mats.getVariant("wood", 0xe6a855, { emissive: emSel }), 0, lift, 0, w, h * 0.65, d);
      addPart(sRoot, geos.roof, tileMat, 0, lift + h * 0.65, 0, w + 0.3, h * 0.42, d + 0.3);
      addPart(sRoot, geos.box, woodMat, -w * 0.56, lift + 0.2, 0, 0.5, 0.55, d * 0.6);
      addPart(sRoot, geos.box, mats.getVariant("standard", s.doorOpen ? 0x2ed661 : 0xe03333, { emissive: 0.25 }), 0, lift + 0.08, d * 0.51, 0.75, 0.62, 0.1);
      if (s.doorOpen) {
        addPart(sRoot, geos.box, woodMat, 0, lift * 0.5, d * 0.68, 0.65, 0.06, 0.9, -0.45, 0, 0);
      }
      if (s.type === "coop_mobile") {
        const wheelMat = mats.getVariant("standard", 0x2a2d30);
        for (const [wx, wz] of [[-w * 0.36, d * 0.48], [w * 0.36, d * 0.48], [-w * 0.36, -d * 0.48], [w * 0.36, -d * 0.48]]) {
          addPart(sRoot, geos.cylCentered, wheelMat, wx, 0.22, wz, 0.44, 0.14, 0.44, 0, 0, Math.PI / 2);
        }
      }
    } else if (s.type === "paddock") {
      addPart(sRoot, geos.box, mats.getVariant("foliage", 0x54a846, { emissive: emSel }), 0, 0.01, 0, w, 0.05, d, 0, 0, 0, false);
      const placeFence = (len, fixedCoord, isZ) => {
        const steps = Math.max(2, Math.round(len / 2.2));
        for (let i = 0; i <= steps; i++) {
          const posAlong = (i / steps - 0.5) * len;
          const lx = isZ ? posAlong : fixedCoord;
          const lz = isZ ? fixedCoord : posAlong;
          const wx = s.x + cosR * lx + sinR * lz;
          const wz = s.z - sinR * lx + cosR * lz;
          addPart(group, geos.cyl, woodMat, wx, H(wx, wz), wz, 0.13, 0.95, 0.13, 0, rot, 0);
        }
        addPart(sRoot, geos.box, woodMat, isZ ? 0 : fixedCoord, 0.42, isZ ? fixedCoord : 0, isZ ? len : 0.08, 0.08, isZ ? 0.08 : len);
        addPart(sRoot, geos.box, woodMat, isZ ? 0 : fixedCoord, 0.76, isZ ? fixedCoord : 0, isZ ? len : 0.08, 0.08, isZ ? 0.08 : len);
      };
      placeFence(w, d * 0.49, true);
      placeFence(w, -d * 0.49, true);
      placeFence(d, w * 0.49, false);
      placeFence(d, -w * 0.49, false);
      addPart(sRoot, geos.box, mats.base.metalSmooth, -w * 0.26, 0.01, 0, 1.45, 0.38, 0.62);
      addPart(sRoot, geos.box, mats.base.water, -w * 0.26, 0.35, 0, 1.32, 0.06, 0.48, 0, 0, 0, false, 2);
      addPart(sRoot, geos.cyl, mats.getVariant("foliage", 0xe0ba42), w * 0.28, 0.01, 0, 1.2, 0.88, 1.2);
    } else if (s.type === "hedge_row") {
      const alongX = w >= d;
      const spanLen = alongX ? w : d;
      const thick = alongX ? d : w;
      const count = Math.max(3, Math.round(spanLen / 1.55));
      for (let k = 0; k < count; k++) {
        const tPos = count === 1 ? 0 : (k / (count - 1) - 0.5) * (spanLen - thick * 0.5);
        const lx = alongX ? tPos : Math.sin(k * 2.1) * 0.14;
        const lz = alongX ? Math.sin(k * 2.1) * 0.14 : tPos;
        const bx = s.x + cosR * lx + sinR * lz;
        const bz = s.z - sinR * lx + cosR * lz;
        const by = H(bx, bz);
        const hSc = h * (0.78 + ((k * 37) % 5) * 0.08);
        const bRad = thick * (1.28 + (k % 2) * 0.22);
        const hMat = mats.getVariant("foliage", hexFromRgba(0.15 + (k % 3) * 0.03, 0.44 + (k % 3) * 0.04, 0.14), { emissive: emSel });
        addPart(group, geos.sphere, hMat, bx, by - 0.1, bz, bRad, hSc * 0.88, bRad, 0, k, 0);
        addPart(group, geos.leafCluster, hMat, bx, by + hSc * 0.25, bz, bRad * 1.15, hSc * 0.7, bRad * 1.15, 0, k * 1.1, 0);
      }
    } else if (s.type === "hedge_tree") {
      addPart(sRoot, geos.cyl, mats.base.bark, 0, -0.2, 0, 0.42, 1.8, 0.42);
      const tMat = mats.getVariant("foliage", 0x286e24, { emissive: emSel });
      for (const [px, py, pz, sx, syC, sz] of [[0, 1.75, 0, 2.5, 2.0, 2.5], [-0.8, 1.55, 0.45, 1.85, 1.55, 1.85], [0.82, 1.6, -0.35, 1.85, 1.6, 1.85], [0.15, 2.65, 0.25, 1.75, 1.45, 1.75]]) {
        addPart(sRoot, geos.sphere, tMat, px, py, pz, sx, syC, sz);
      }
      addPart(sRoot, geos.leafCluster, tMat, 0, 1.8, 0, 2.7, 2.2, 2.7, 0, 0.4, 0);
      if ((s.label || "").toLowerCase().includes("pomm")) {
        const appMat = mats.getVariant("standard", 0xe82e29, { emissive: 0.05 });
        for (const [fx, fy, fz] of [[-0.75, 2.1, 0.9], [0.7, 2.25, 0.65], [-0.2, 2.6, -0.8], [0.4, 1.9, -0.75]]) {
          addPart(sRoot, geos.sphere, appMat, fx, fy, fz, 0.16, 0.16, 0.16);
        }
      }
    } else if (s.type === "path_dirt" || s.type === "road_paved") {
      const isRoad = s.type === "road_paved";
      const pathMat = isRoad ? mats.getVariant("asphalt", 0x5a6068, { emissive: emSel }) : mats.getVariant("gravel", 0xdccbb0, { emissive: emSel });
      const alongX = w >= d;
      const totalLen = alongX ? w : d;
      const segs = Math.max(2, Math.ceil(totalLen / 3.2));
      const segLen = totalLen / segs + 0.12;
      const stripeMat = mats.getVariant("standard", 0xf1f5f9);
      for (let i = 0; i < segs; i++) {
        const offset = ((i + 0.5) / segs - 0.5) * totalLen;
        const lx = alongX ? offset : 0;
        const lz = alongX ? 0 : offset;
        const wx = s.x + cosR * lx + sinR * lz;
        const wz = s.z - sinR * lx + cosR * lz;
        const wy = H(wx, wz);
        addPart(group, geos.box, pathMat, wx, wy - 0.03, wz, alongX ? segLen : w, 0.1, alongX ? d : segLen, 0, rot, 0, false);
        if (isRoad) {
          const kerbX = alongX ? 0 : w * 0.52;
          const kerbZ = alongX ? d * 0.52 : 0;
          addPart(group, geos.box, stoneMat, wx + cosR * kerbX + sinR * kerbZ, wy - 0.01, wz - sinR * kerbX + cosR * kerbZ, alongX ? segLen : 0.16, 0.14, alongX ? 0.16 : segLen, 0, rot, 0, false);
          addPart(group, geos.box, stoneMat, wx - cosR * kerbX - sinR * kerbZ, wy - 0.01, wz + sinR * kerbX - cosR * kerbZ, alongX ? segLen : 0.16, 0.14, alongX ? 0.16 : segLen, 0, rot, 0, false);
          if (totalLen >= 20 && i % 2 === 0) {
            addPart(group, geos.box, stripeMat, wx, wy + 0.075, wz, alongX ? segLen * 0.45 : 0.12, 0.01, alongX ? 0.12 : segLen * 0.45, 0, rot, 0, false);
          }
        }
      }
    } else if (s.type === "stone_wall") {
      const segs = Math.max(2, Math.round(w / 1.8));
      for (let i = 0; i < segs; i++) {
        const lx = ((i + 0.5) / segs - 0.5) * w;
        const wx = s.x + cosR * lx;
        const wz = s.z - sinR * lx;
        const wy = H(wx, wz);
        addPart(group, geos.box, stoneMat, wx, wy - 0.2, wz, w / segs + 0.08, h + 0.2, d, 0, rot, 0);
        addPart(group, geos.box, plinthMat, wx, wy + h - 0.02, wz, w / segs + 0.1, 0.12, d + 0.12, 0, rot, 0);
      }
    } else if (s.type === "river_seg") {
      const bridges = (state.structures || []).filter((b) => b.type === "bridge");
      for (let k = -2; k <= 2; k++) {
        const bx = s.x + cosR * (k * w * 0.21);
        const bz = s.z - sinR * (k * w * 0.21) + (k % 2 === 0 ? d * 0.6 : -d * 0.6);
        if (bridges.some((b) => Math.hypot(bx - b.x, bz - b.z) < 2.9)) continue;
        const by = H(bx, bz);
        addPart(group, geos.sphere, plinthMat, bx, by - 0.08, bz, 0.52, 0.3, 0.45, 0, k, 0);
        if (k % 2 === 0) {
          addPart(group, geos.leafCluster, mats.getVariant("foliage", 0x3b8f3d), bx + 0.35, by - 0.04, bz, 0.45, 0.78, 0.45, 0, k, 0);
        }
      }
    } else if (s.type === "bridge") {
      addPart(sRoot, geos.box, stoneMat, 0, -0.35, -d * 0.42, w, 0.78, d * 0.22);
      addPart(sRoot, geos.box, stoneMat, 0, -0.35, d * 0.42, w, 0.78, d * 0.22);
      addPart(sRoot, geos.box, mats.base.gravel, 0, 0.24, -d * 0.53, w * 0.96, 0.22, d * 0.14);
      addPart(sRoot, geos.box, mats.base.gravel, 0, 0.24, d * 0.53, w * 0.96, 0.22, d * 0.14);
      addPart(sRoot, geos.box, mats.base.gravel, 0, 0.38, 0, w * 0.98, 0.22, d + 0.16);
      addPart(sRoot, geos.box, stoneMat, -w * 0.44, 0.58, 0, 0.24, 0.56, d + 0.06);
      addPart(sRoot, geos.box, stoneMat, w * 0.44, 0.58, 0, 0.24, 0.56, d + 0.06);
      addPart(sRoot, geos.box, woodMat, -w * 0.44, 1.14, 0, 0.28, 0.1, d + 0.12);
      addPart(sRoot, geos.box, woodMat, w * 0.44, 1.14, 0, 0.28, 0.1, d + 0.12);
    } else if (s.type === "pond") {
      addPart(sRoot, geos.cyl, mats.base.gravel, 0, -0.1, 0, w + 0.7, 0.24, d + 0.7, 0, 0, 0, false);
      addPart(sRoot, geos.cyl, mats.base.water, 0, 0.04, 0, w, 0.16, d, 0, 0, 0, false, 2);
      for (let r = 0; r < 6; r++) {
        const ang = (r / 6) * Math.PI * 2 + 0.3;
        const rx = s.x + Math.cos(ang) * (w * 0.46);
        const rz = s.z + Math.sin(ang) * (d * 0.46);
        addPart(group, geos.sphere, plinthMat, rx, H(rx, rz) - 0.05, rz, 0.55, 0.32, 0.5, 0, ang, 0);
        if (r % 2 === 0) {
          addPart(group, geos.leafCluster, mats.getVariant("foliage", 0x3b8f3d), rx + 0.25, H(rx, rz), rz, 0.45, 0.75, 0.45, 0, r, 0);
        }
      }
    } else if (s.type === "water_tank") {
      addPlinth(w, d);
      addPart(sRoot, geos.cyl, mats.getVariant("metalCorrugated", 0xd4e2f0, { emissive: emSel }), 0, 0.08, 0, w, h, d);
      addPart(sRoot, geos.cyl, mats.getVariant("metalSmooth", 0x1e85d1), 0, 0.08 + h * 0.35, 0, w * 1.03, 0.12, d * 1.03);
      addPart(sRoot, geos.cyl, mats.getVariant("metalSmooth", 0x1a6bb3), 0, 0.08 + h, 0, w * 1.05, 0.22, d * 1.05);
    } else if (s.type === "well_pump") {
      addPlinth(w, d);
      addPart(sRoot, geos.cyl, stoneMat, 0, 0.05, 0, w * 0.88, 0.88, d * 0.88);
      addPart(sRoot, geos.cyl, mats.base.water, 0, 0.75, 0, w * 0.68, 0.08, d * 0.68, 0, 0, 0, false, 2);
      addPart(sRoot, geos.cyl, woodMat, -w * 0.38, 0.85, 0, 0.12, 1.15, 0.12);
      addPart(sRoot, geos.cyl, woodMat, w * 0.38, 0.85, 0, 0.12, 1.15, 0.12);
      addPart(sRoot, geos.cylCentered, woodMat, 0, 1.38, 0, 0.1, w * 0.78, 0.1, 0, 0, Math.PI / 2);
      addPart(sRoot, geos.roof, tileMat, 0, 1.92, 0, w + 0.25, 0.62, d + 0.25);
    } else if (s.type === "solar_array") {
      addPart(sRoot, geos.cyl, mats.base.metalSmooth, -w * 0.34, -0.3, 0, 0.18, 1.3, 0.18);
      addPart(sRoot, geos.cyl, mats.base.metalSmooth, w * 0.34, -0.3, 0, 0.18, 1.3, 0.18);
      addPart(sRoot, geos.box, mats.base.metalSmooth, 0, 1.02, 0, w + 0.14, 0.08, d + 0.14, 0.48, 0, 0);
      addPart(sRoot, geos.box, mats.base.solar, 0, 1.07, 0.02, w, 0.06, d, 0.48, 0, 0);
    } else if (s.type === "wind_turbine") {
      addPlinth(w, d);
      addPart(sRoot, geos.cyl, mats.getVariant("metalSmooth", 0xf1f5f9, { emissive: emSel }), 0, 0.05, 0, 0.42, h, 0.42);
      addPart(sRoot, geos.box, mats.getVariant("metalSmooth", 0xe2e8f0), 0, h, 0, 0.6, 0.6, 1.1);
      const hub = new THREE.Group();
      hub.position.set(0, h + 0.26, 0.64);
      sRoot.add(hub);
      addPart(hub, geos.sphereCentered, mats.base.metalSmooth, 0, 0, 0, 0.42, 0.42, 0.42);
      for (let b = 0; b < 3; b++) {
        addPart(hub, geos.turbineBlade, mats.getVariant("metalSmooth", 0xf8fafc), 0, 0, 0.06, 0.9, h * 0.42, 0.5, 0, 0, (b * Math.PI * 2) / 3);
      }
      animItems.push({ kind: "rotorZ", mesh: hub, speed: 1.5 });
    } else if (s.type === "weather_station") {
      addPart(sRoot, geos.cyl, mats.base.metalSmooth, 0, -0.2, 0, 0.14, h + 0.2, 0.14);
      addPart(sRoot, geos.box, mats.getVariant("standard", 0xf8fafc), 0, h * 0.56, 0, 0.52, 0.46, 0.42);
      addPart(sRoot, geos.box, mats.base.solar, 0.32, h * 0.72, 0.12, 0.36, 0.04, 0.28, 0.5, 0, 0);
      const cup = addPart(sRoot, geos.box, mats.getVariant("metalSmooth", 0x38c7fa, { emissive: 0.25 }), 0, h - 0.06, 0, 1.15, 0.08, 0.1);
      animItems.push({ kind: "spinY", mesh: cup, speed: 2.2 });
    } else if (s.type === "compost") {
      for (let b = -1; b <= 1; b++) {
        addPart(sRoot, geos.box, woodMat, b * 1.25, 0, 0, 1.15, 0.72, d * 0.9);
        addPart(sRoot, geos.sphere, mats.getVariant("soil", 0x4a331c), b * 1.25, 0.32, 0, 0.98, 0.65 - (b + 1) * 0.1, d * 0.78);
      }
    } else if (s.type === "apiary") {
      addPart(sRoot, geos.box, woodMat, 0, 0, 0, w * 0.95, 0.25, 0.52);
      const hiveMat = mats.getVariant("wood", 0xf5d147, { emissive: emSel });
      for (let r = -1.5; r <= 1.5; r += 1) {
        addPart(sRoot, geos.box, hiveMat, r * 0.76, 0.25, 0, 0.58, 0.68, 0.58);
        addPart(sRoot, geos.roof, mats.base.metalSmooth, r * 0.76, 0.93, 0, 0.68, 0.18, 0.68);
      }
      const beeMat = mats.getVariant("standard", 0xfadc28, { emissive: 0.3 });
      for (let bee = 0; bee < 4; bee++) {
        const bm = addPart(sRoot, geos.sphereCentered, beeMat, 0, 1.25, 0.5, 0.08, 0.08, 0.08, 0, 0, 0, false);
        animItems.push({ kind: "bee", mesh: bm, idx: bee });
      }
    } else if (s.type === "custom_glb" && s.modelUrl) {
      const cached = glbCache?.get(s.modelUrl);
      if (cached) {
        const clone = cached.clone(true);
        const targetSc = (s.scale || 1);
        clone.scale.multiplyScalar(targetSc);
        clone.traverse((ch) => {
          if (ch.isMesh) {
            ch.castShadow = true;
            ch.receiveShadow = true;
          }
        });
        sRoot.add(clone);
      } else {
        requestGlb?.(s.modelUrl);
        addPart(sRoot, geos.box, mats.getVariant("standard", 0x38bdf8, { opacity: 0.55 }), 0, 0.05, 0, w * 0.6, h * 0.6, d * 0.6);
      }
    }

    const effW = Math.abs(cosR) * w + Math.abs(sinR) * d;
    const effD = Math.abs(sinR) * w + Math.abs(cosR) * d;
    hitBoxes.push({ kind: "structure", id: s.id, label: s.label, x: s.x, z: s.z, w: effW, d: effD, y0: sy, y1: sy + Math.max(0.8, h), data: s });
    if (s.type !== "path_dirt" && s.type !== "road_paved" && s.type !== "river_seg" && s.type !== "tarp_pad") {
      arPins.push({ id: s.id, label: s.label, x: s.x, y: sy + h + 0.5, z: s.z, warn: false });
    }
  }

  return { group, animItems, hitBoxes, arPins };
}

export function buildAnimalMeshPbr(speciesId, seed, geos, mats) {
  const root = new THREE.Group();
  const legs = [];
  const makeHipLeg = (lx, hipY, lz, lw, lh, ld, mat) => {
    const hip = new THREE.Group();
    hip.position.set(lx, hipY, lz);
    addPart(hip, geos.box, mat, 0, -lh, 0, lw, lh, ld);
    root.add(hip);
    legs.push(hip);
  };

  if (speciesId === "bovin_lait" || speciesId === "bovin_viande") {
    const isDairy = speciesId === "bovin_lait";
    const bodyMat = mats.getVariant("standard", isDairy ? 0xf2f0e8 : 0xc28a57);
    const spotMat = mats.getVariant("standard", 0x222429);
    addPart(root, geos.sphere, bodyMat, 0, 0.42, 0, 0.78, 0.68, 1.46);
    if (isDairy) {
      addPart(root, geos.sphere, spotMat, 0.08, 0.68, -0.18, 0.66, 0.42, 0.58);
      addPart(root, geos.sphere, spotMat, -0.1, 0.6, 0.36, 0.58, 0.38, 0.46);
      addPart(root, geos.sphere, mats.getVariant("standard", 0xf0c2c2), 0, 0.36, -0.22, 0.32, 0.18, 0.3);
    }
    const hdMat = isDairy ? spotMat : bodyMat;
    addPart(root, geos.cyl, hdMat, 0, 0.64, 0.58, 0.38, 0.45, 0.4, 0.55, 0, 0);
    addPart(root, geos.sphere, hdMat, 0, 0.72, 0.86, 0.44, 0.42, 0.48, 0.18, 0, 0);
    addPart(root, geos.sphere, mats.getVariant("standard", 0xf0b8b8), 0, 0.7, 1.09, 0.32, 0.22, 0.18);
    const hornMat = mats.getVariant("standard", 0xebe0c2);
    addPart(root, geos.cone, hornMat, -0.18, 1.06, 0.84, 0.09, 0.22, 0.09, 0, 0, 0.48);
    addPart(root, geos.cone, hornMat, 0.18, 1.06, 0.84, 0.09, 0.22, 0.09, 0, 0, -0.48);
    addPart(root, geos.cyl, bodyMat, 0, 0.22, -0.82, 0.06, 0.45, 0.06, 0.24, 0, 0);
    for (const [lx, lz] of [[-0.22, 0.45], [0.22, 0.45], [-0.22, -0.45], [0.22, -0.45]]) {
      makeHipLeg(lx, 0.48, lz, 0.14, 0.48, 0.14, bodyMat);
    }
  } else if (speciesId === "ovin") {
    const woolMat = mats.getVariant("standard", 0xf5f0de);
    const faceMat = mats.getVariant("standard", 0x33302e);
    addPart(root, geos.sphere, woolMat, 0, 0.26, 0, 0.62, 0.54, 0.9);
    addPart(root, geos.sphere, woolMat, 0.1, 0.34, 0.15, 0.44, 0.42, 0.5);
    addPart(root, geos.sphere, woolMat, -0.1, 0.32, -0.15, 0.44, 0.42, 0.5);
    addPart(root, geos.sphere, faceMat, 0, 0.42, 0.52, 0.28, 0.26, 0.34, 0.2, 0, 0);
    for (const [lx, lz] of [[-0.17, 0.28], [0.17, 0.28], [-0.17, -0.28], [0.17, -0.28]]) {
      makeHipLeg(lx, 0.32, lz, 0.09, 0.32, 0.09, faceMat);
    }
  } else if (speciesId === "caprin") {
    const coatMat = mats.getVariant("standard", 0xa37042);
    const hornMat = mats.getVariant("standard", 0x3d3630);
    addPart(root, geos.sphere, coatMat, 0, 0.32, 0, 0.44, 0.46, 0.86);
    addPart(root, geos.cyl, coatMat, 0, 0.48, 0.36, 0.22, 0.36, 0.22, 0.38, 0, 0);
    addPart(root, geos.sphere, coatMat, 0, 0.62, 0.54, 0.24, 0.28, 0.32);
    addPart(root, geos.cone, hornMat, -0.09, 0.86, 0.48, 0.06, 0.24, 0.06, -0.45, 0, 0.15);
    addPart(root, geos.cone, hornMat, 0.09, 0.86, 0.48, 0.06, 0.24, 0.06, -0.45, 0, -0.15);
    for (const [lx, lz] of [[-0.14, 0.28], [0.14, 0.28], [-0.14, -0.28], [0.14, -0.28]]) {
      makeHipLeg(lx, 0.36, lz, 0.08, 0.36, 0.08, hornMat);
    }
  } else if (speciesId === "porcin") {
    const pigMat = mats.getVariant("standard", seed % 2 === 0 ? 0xf2adad : 0x594f4a);
    addPart(root, geos.sphere, pigMat, 0, 0.2, 0, 0.56, 0.48, 0.92);
    addPart(root, geos.sphere, pigMat, 0, 0.26, 0.48, 0.38, 0.34, 0.34);
    addPart(root, geos.cyl, mats.getVariant("standard", 0xf59499), 0, 0.32, 0.66, 0.18, 0.08, 0.16, Math.PI / 2, 0, 0);
    for (const [lx, lz] of [[-0.16, 0.26], [0.16, 0.26], [-0.16, -0.26], [0.16, -0.26]]) {
      makeHipLeg(lx, 0.24, lz, 0.09, 0.24, 0.09, pigMat);
    }
  } else if (speciesId === "equin") {
    const horseMat = mats.getVariant("standard", 0x7a4729);
    const maneMat = mats.getVariant("standard", 0x241a14);
    addPart(root, geos.sphere, horseMat, 0, 0.6, 0, 0.68, 0.62, 1.48);
    addPart(root, geos.cyl, horseMat, 0, 0.92, 0.62, 0.3, 0.66, 0.34, 0.48, 0, 0);
    addPart(root, geos.sphere, horseMat, 0, 1.24, 0.92, 0.28, 0.3, 0.48, 0.4, 0, 0);
    addPart(root, geos.box, maneMat, 0, 1.05, 0.58, 0.08, 0.62, 0.14, 0.48, 0, 0);
    addPart(root, geos.cyl, maneMat, 0, 0.28, -0.92, 0.12, 0.58, 0.12, 0.25, 0, 0);
    for (const [lx, lz] of [[-0.2, 0.5], [0.2, 0.5], [-0.2, -0.5], [0.2, -0.5]]) {
      makeHipLeg(lx, 0.68, lz, 0.12, 0.68, 0.12, horseMat);
    }
  } else if (speciesId === "canard") {
    const bodyMat = mats.getVariant("standard", 0xe6dbc0);
    const hdMat = mats.getVariant("standard", 0x267352);
    const beakMat = mats.getVariant("standard", 0xfa8f1a);
    addPart(root, geos.sphere, bodyMat, 0, 0.12, 0, 0.24, 0.42, 0.28, -0.25, 0, 0);
    addPart(root, geos.cyl, hdMat, 0, 0.44, 0.12, 0.11, 0.22, 0.11);
    addPart(root, geos.sphere, hdMat, 0, 0.58, 0.14, 0.16, 0.16, 0.18);
    addPart(root, geos.box, beakMat, 0, 0.62, 0.26, 0.08, 0.05, 0.16);
    addPart(root, geos.cyl, beakMat, -0.06, 0, 0, 0.04, 0.14, 0.04);
    addPart(root, geos.cyl, beakMat, 0.06, 0, 0, 0.04, 0.14, 0.04);
  } else {
    const henHex = seed % 3 === 0 ? 0xd66b2e : seed % 3 === 1 ? 0xf0e8d6 : 0x3d383d;
    const henMat = mats.getVariant("standard", henHex);
    const beakMat = mats.getVariant("standard", 0xf5b824);
    addPart(root, geos.sphere, henMat, 0, 0.1, 0, 0.28, 0.26, 0.38);
    addPart(root, geos.cone, henMat, 0, 0.24, -0.18, 0.18, 0.18, 0.18, -0.6, 0, 0);
    addPart(root, geos.sphere, henMat, 0, 0.28, 0.2, 0.15, 0.17, 0.17);
    addPart(root, geos.box, mats.getVariant("standard", 0xeb1f26), 0, 0.42, 0.2, 0.05, 0.09, 0.12);
    addPart(root, geos.cone, beakMat, 0, 0.34, 0.29, 0.05, 0.08, 0.05, Math.PI / 2, 0, 0);
    addPart(root, geos.cyl, beakMat, -0.06, 0, 0, 0.03, 0.12, 0.03);
    addPart(root, geos.cyl, beakMat, 0.06, 0, 0, 0.03, 0.12, 0.03);
  }
  root.userData.legs = legs;
  return root;
}

export function buildRobotMeshPbr(eq, geos, mats, sunIsDay) {
  const root = new THREE.Group();
  root.userData.rotors = [];

  if (eq.kind === "drone") {
    addPart(root, geos.box, mats.getVariant("metalSmooth", 0x293847), 0, 0, 0, 0.48, 0.14, 0.65);
    addPart(root, geos.sphere, mats.getVariant("standard", 0x26c7f5, { emissive: 0.4 }), 0, -0.06, 0.22, 0.16, 0.14, 0.16);
    const rotorMat = mats.getVariant("standard", 0x38dbfa, { opacity: 0.48, emissive: 0.25 });
    for (const [ax, az] of [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]]) {
      addPart(root, geos.box, mats.base.metalSmooth, ax * 0.5, 0.04, az * 0.5, 0.07, 0.05, 0.68, 0, Math.atan2(ax, az), 0);
      const rotor = addPart(root, geos.box, rotorMat, ax, 0.08, az, 0.46, 0.02, 0.08, 0, 0, 0, false);
      root.userData.rotors.push(rotor);
    }
    const beamMat = mats.getVariant("standard", 0x33f28c, { opacity: 0.18, emissive: 0.48 });
    const beam = addPart(root, geos.cone, beamMat, 0, -4.3, 0, 2.2, 4.3, 2.2, 0, 0, 0, false, 4);
    root.userData.beam = beam;
  } else if (eq.kind === "tractor") {
    const greenPaint = mats.getVariant("metalSmooth", 0x249447);
    const darkMetal = mats.getVariant("metalSmooth", 0x24292e);
    addPart(root, geos.box, greenPaint, 0, 0.34, 0.35, 1.0, 0.75, 1.45);
    addPart(root, geos.box, darkMetal, 0, 0.48, 1.09, 0.82, 0.46, 0.06);
    const lightMat = mats.getVariant("standard", 0xffeba8, { emissive: sunIsDay ? 0.2 : 0.9 });
    addPart(root, geos.box, lightMat, -0.34, 0.62, 1.1, 0.18, 0.12, 0.06);
    addPart(root, geos.box, lightMat, 0.34, 0.62, 1.1, 0.18, 0.12, 0.06);
    addPart(root, geos.box, mats.base.glassVenlo, 0, 0.95, -0.45, 1.12, 0.92, 1.05, 0, 0, 0, false, 5);
    addPart(root, geos.box, greenPaint, 0, 1.88, -0.45, 1.18, 0.1, 1.12);
    addPart(root, geos.sphere, mats.getVariant("standard", 0xf2b824, { emissive: 0.3 }), 0, 1.98, -0.25, 0.26, 0.14, 0.26);
    const tireMat = mats.getVariant("standard", 0x242629);
    const rimMat = mats.getVariant("metalSmooth", 0xe0c738);
    for (const [wx, wz, r, wt] of [[-0.68, 0.78, 0.58, 0.24], [0.68, 0.78, 0.58, 0.24], [-0.74, -0.58, 0.9, 0.34], [0.74, -0.58, 0.9, 0.34]]) {
      addPart(root, geos.cylCentered, tireMat, wx, r * 0.5, wz, r, wt, r, 0, 0, Math.PI / 2);
      addPart(root, geos.cylCentered, rimMat, wx + (wx > 0 ? 0.03 : -0.03), r * 0.5, wz, r * 0.46, wt * 0.95, r * 0.46, 0, 0, Math.PI / 2);
    }
    addPart(root, geos.box, mats.getVariant("metalSmooth", 0xd9422e), 0, 0.22, -1.35, 1.5, 0.24, 0.55);
  } else {
    const amber = mats.getVariant("metalSmooth", 0xf09e24);
    addPart(root, geos.box, amber, 0, 0.22, 0, 1.05, 0.34, 1.15);
    addPart(root, geos.box, mats.base.solar, 0, 0.58, 0, 1.08, 0.07, 1.12, 0.15, 0, 0);
    addPart(root, geos.sphere, mats.getVariant("standard", 0x2ee07a, { emissive: 0.45 }), 0, 0.42, 0.62, 0.18, 0.14, 0.16);
    const tireMat = mats.getVariant("standard", 0x26292e);
    for (const [wx, wz] of [[-0.6, 0.44], [0.6, 0.44], [-0.6, -0.44], [0.6, -0.44]]) {
      addPart(root, geos.cylCentered, tireMat, wx, 0.2, wz, 0.4, 0.16, 0.4, 0, 0, Math.PI / 2);
    }
  }
  return root;
}
