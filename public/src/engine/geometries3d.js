/**
 * Bibliotheque procedurale de geometries 3D WebGL (zero dependance)
 * Toutes les primitives suivent un enroulement CCW exterieur et des normales unitaires.
 */

function computeTriNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function pushTriFlat(pos, norm, a, b, c) {
  const n = computeTriNormal(a, b, c);
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  norm.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
}

function pushQuadFlat(pos, norm, a, b, c, d) {
  pushTriFlat(pos, norm, a, b, c);
  pushTriFlat(pos, norm, a, c, d);
}

/** 1. Cube unitaire x,z in [-0.5, 0.5], y in [0, 1] */
export function createBoxGeometry() {
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
      pos.push(f.v[i][0], f.v[i][1], f.v[i][2]);
      norm.push(f.n[0], f.n[1], f.n[2]);
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 2. Cylindre lisse avec couvercles haut & bas (y in [0, 1], rayon 0.5) */
export function createCylinderGeometry(segs = 20) {
  const pos = [], norm = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const nx0 = Math.cos(a0), nz0 = Math.sin(a0);
    const nx1 = Math.cos(a1), nz1 = Math.sin(a1);
    const x0 = nx0 * 0.5, z0 = nz0 * 0.5;
    const x1 = nx1 * 0.5, z1 = nz1 * 0.5;

    // Paroi laterale CCW exterieur
    pos.push(x0, 0, z0, x0, 1, z0, x1, 1, z1);
    norm.push(nx0, 0, nz0, nx0, 0, nz0, nx1, 0, nz1);
    pos.push(x0, 0, z0, x1, 1, z1, x1, 0, z1);
    norm.push(nx0, 0, nz0, nx1, 0, nz1, nx1, 0, nz1);

    // Couvercle superieur (+Y)
    pos.push(0, 1, 0, x1, 1, z1, x0, 1, z0);
    norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);

    // Base inferieure (-Y)
    pos.push(0, 0, 0, x0, 0, z0, x1, 0, z1);
    norm.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 3. Cone lisse avec normales inclinees et base fermee (y in [0, 1], rayon 0.5) */
export function createConeGeometry(segs = 18) {
  const pos = [], norm = [];
  const rWeight = 0.894427;
  const yWeight = 0.447214;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const aMid = (a0 + a1) * 0.5;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const cm = Math.cos(aMid), sm = Math.sin(aMid);

    pos.push(c0 * 0.5, 0, s0 * 0.5, 0, 1, 0, c1 * 0.5, 0, s1 * 0.5);
    norm.push(
      c0 * rWeight, yWeight, s0 * rWeight,
      cm * rWeight, yWeight, sm * rWeight,
      c1 * rWeight, yWeight, s1 * rWeight
    );

    // Base inferieure (-Y)
    pos.push(0, 0, 0, c0 * 0.5, 0, s0 * 0.5, c1 * 0.5, 0, s1 * 0.5);
    norm.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 4. Sphere UV centree en (0, 0.5, 0), rayon 0.5 (y in [0, 1]) */
export function createSphereGeometry(latSegs = 12, lonSegs = 18) {
  const pos = [], norm = [];
  const pt = (lat, lon) => {
    const theta = (lat / latSegs) * Math.PI;
    const phi = (lon / lonSegs) * Math.PI * 2;
    const st = Math.sin(theta), ct = Math.cos(theta);
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const nx = st * cp, ny = ct, nz = st * sp;
    return { p: [nx * 0.5, 0.5 + ny * 0.5, nz * 0.5], n: [nx, ny, nz] };
  };

  for (let lat = 0; lat < latSegs; lat++) {
    for (let lon = 0; lon < lonSegs; lon++) {
      const a = pt(lat, lon);
      const b = pt(lat, lon + 1);
      const c = pt(lat + 1, lon);
      const d = pt(lat + 1, lon + 1);

      if (lat > 0) {
        pos.push(...a.p, ...b.p, ...c.p);
        norm.push(...a.n, ...b.n, ...c.n);
      }
      if (lat < latSegs - 1) {
        pos.push(...b.p, ...d.p, ...c.p);
        norm.push(...b.n, ...d.n, ...c.n);
      }
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 5. Toit a deux pans (x,z in [-0.5, 0.5], y in [0, 1]) */
export function createRoofGeometry() {
  const pos = [], norm = [];
  pushTriFlat(pos, norm, [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0]);
  pushTriFlat(pos, norm, [-0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0]);
  pushTriFlat(pos, norm, [0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0]);
  pushTriFlat(pos, norm, [0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0]);
  pushTriFlat(pos, norm, [-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0]);
  pushTriFlat(pos, norm, [0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0]);
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 6. Voute tunnel de serre courbe le long de X (x,z in [-0.5, 0.5], y in [0, 1]) */
export function createArchTunnelGeometry(segs = 16) {
  const pos = [], norm = [];
  const archPt = (i) => {
    const a = (i / segs) * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = -ca, ny = 0.5 * sa;
    const l = Math.hypot(nx, ny) || 1;
    return { x: -0.5 * ca, y: sa, nx: nx / l, ny: ny / l };
  };

  for (let i = 0; i < segs; i++) {
    const p0 = archPt(i);
    const p1 = archPt(i + 1);

    // Enveloppe courbe (extrudee selon Z de -0.5 a +0.5)
    pos.push(p0.x, p0.y, -0.5, p0.x, p0.y, 0.5, p1.x, p1.y, 0.5);
    norm.push(p0.nx, p0.ny, 0, p0.nx, p0.ny, 0, p1.nx, p1.ny, 0);
    pos.push(p0.x, p0.y, -0.5, p1.x, p1.y, 0.5, p1.x, p1.y, -0.5);
    norm.push(p0.nx, p0.ny, 0, p1.nx, p1.ny, 0, p1.nx, p1.ny, 0);

    // Pignon +Z
    pos.push(0, 0, 0.5, p1.x, p1.y, 0.5, p0.x, p0.y, 0.5);
    norm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);

    // Pignon -Z
    pos.push(0, 0, -0.5, p0.x, p0.y, -0.5, p1.x, p1.y, -0.5);
    norm.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 7. Arceau metallique creux pour serre tunnel (x in [-0.5, 0.5], y in [0, 1], z in [-0.5, 0.5]) */
export function createArchRibGeometry(segs = 16, thickness = 0.045) {
  const pos = [], norm = [];
  const rIn = 1.0 - thickness;
  const ptOut = (i) => {
    const a = (i / segs) * Math.PI;
    return [-0.5 * Math.cos(a), Math.sin(a)];
  };
  const ptIn = (i) => {
    const a = (i / segs) * Math.PI;
    return [-0.5 * rIn * Math.cos(a), rIn * Math.sin(a)];
  };

  for (let i = 0; i < segs; i++) {
    const [ox0, oy0] = ptOut(i);
    const [ox1, oy1] = ptOut(i + 1);
    const [ix0, iy0] = ptIn(i);
    const [ix1, iy1] = ptIn(i + 1);

    // Face avant +Z et arriere -Z
    pushQuadFlat(pos, norm, [ix0, iy0, 0.5], [ox0, oy0, 0.5], [ox1, oy1, 0.5], [ix1, iy1, 0.5]);
    pushQuadFlat(pos, norm, [ox0, oy0, -0.5], [ix0, iy0, -0.5], [ix1, iy1, -0.5], [ox1, oy1, -0.5]);
    // Extrados et intrados
    pushQuadFlat(pos, norm, [ox0, oy0, -0.5], [ox1, oy1, -0.5], [ox1, oy1, 0.5], [ox0, oy0, 0.5]);
    pushQuadFlat(pos, norm, [ix0, iy0, 0.5], [ix1, iy1, 0.5], [ix1, iy1, -0.5], [ix0, iy0, -0.5]);
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 8. Touffe vegetale / feuillage en 3 plans croises double-face (y in [0, 1], rayon 0.5) */
export function createLeafClusterGeometry() {
  const pos = [], norm = [];
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const p = (lx, ly) => [lx * ca, ly, lx * sa];

    const a = p(-0.22, 0.0);
    const b = p(0.22, 0.0);
    const c = p(0.5, 0.55);
    const d = p(0.0, 1.0);
    const e = p(-0.5, 0.55);

    const nFront = [-sa * 0.45, 0.89, ca * 0.45];
    const nBack = [sa * 0.45, 0.89, -ca * 0.45];

    const tris = [[a, b, c], [a, c, d], [a, d, e]];
    for (const [v0, v1, v2] of tris) {
      pos.push(...v0, ...v1, ...v2);
      norm.push(...nFront, ...nFront, ...nFront);
      pos.push(...v0, ...v2, ...v1);
      norm.push(...nBack, ...nBack, ...nBack);
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 9. Pale d'eolienne profilee effilee (y in [0, 1]) */
export function createTurbineBladeGeometry() {
  const pos = [], norm = [];
  const profile = [
    { y: 0.0, w: 0.06, t: 0.04, twist: 0.05 },
    { y: 0.18, w: 0.12, t: 0.045, twist: 0.2 },
    { y: 0.58, w: 0.085, t: 0.03, twist: 0.12 },
    { y: 1.0, w: 0.025, t: 0.012, twist: 0.04 },
  ];

  const ringPts = (s) => {
    const ct = Math.cos(s.twist), st = Math.sin(s.twist);
    const corners = [
      [-s.w * 0.45, -s.t * 0.5],
      [s.w * 0.55, -s.t * 0.5],
      [s.w * 0.55, s.t * 0.5],
      [-s.w * 0.45, s.t * 0.5],
    ];
    return corners.map(([cx, cz]) => [cx * ct - cz * st, s.y, cx * st + cz * ct]);
  };

  for (let i = 0; i < profile.length - 1; i++) {
    const r0 = ringPts(profile[i]);
    const r1 = ringPts(profile[i + 1]);
    for (let k = 0; k < 4; k++) {
      const kNext = (k + 1) % 4;
      pushQuadFlat(pos, norm, r0[k], r0[kNext], r1[kNext], r1[k]);
    }
  }
  const tip = ringPts(profile[profile.length - 1]);
  pushQuadFlat(pos, norm, tip[0], tip[1], tip[2], tip[3]);
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

/** 10. Dome celeste spherique unitaire centre en (0, 0, 0) */
export function createSkyDomeGeometry(latSegs = 16, lonSegs = 28) {
  const pos = [], norm = [];
  const pt = (lat, lon) => {
    const theta = (lat / latSegs) * Math.PI;
    const phi = (lon / lonSegs) * Math.PI * 2;
    const st = Math.sin(theta), ct = Math.cos(theta);
    const nx = st * Math.cos(phi), ny = ct, nz = st * Math.sin(phi);
    return [nx, ny, nz];
  };

  for (let lat = 0; lat < latSegs; lat++) {
    for (let lon = 0; lon < lonSegs; lon++) {
      const a = pt(lat, lon);
      const b = pt(lat, lon + 1);
      const c = pt(lat + 1, lon);
      const d = pt(lat + 1, lon + 1);

      if (lat > 0) {
        pos.push(...a, ...c, ...b);
        norm.push(-a[0], -a[1], -a[2], -c[0], -c[1], -c[2], -b[0], -b[1], -b[2]);
      }
      if (lat < latSegs - 1) {
        pos.push(...b, ...c, ...d);
        norm.push(-b[0], -b[1], -b[2], -c[0], -c[1], -c[2], -d[0], -d[1], -d[2]);
      }
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), count: pos.length / 3 };
}

function catmullRom1D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sampleHeightsCatmullRom(heights, res, u, v) {
  const stride = res + 1;
  const fx = Math.max(0, Math.min(res, u * res));
  const fz = Math.max(0, Math.min(res, v * res));
  const ix = Math.min(res - 1, Math.floor(fx));
  const iz = Math.min(res - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;

  const hAt = (x, z) => {
    const cx = Math.max(0, Math.min(res, x));
    const cz = Math.max(0, Math.min(res, z));
    return heights[cz * stride + cx] || 0;
  };

  const rows = [];
  for (let dz = -1; dz <= 2; dz++) {
    rows.push(
      catmullRom1D(
        hAt(ix - 1, iz + dz),
        hAt(ix, iz + dz),
        hAt(ix + 1, iz + dz),
        hAt(ix + 2, iz + dz),
        tx
      )
    );
  }
  return catmullRom1D(rows[0], rows[1], rows[2], rows[3], tz);
}

function distantRidgeHeight(x, z) {
  const dist = Math.hypot(x, z);
  const t = Math.max(0, Math.min(1, (dist - 30) / 85));
  const smooth = t * t * (3 - 2 * t);
  const hills =
    Math.sin(x * 0.032 + 0.5) * Math.cos(z * 0.028 - 0.3) * 6.5 +
    Math.sin((x + z) * 0.058) * 3.2 +
    Math.cos(x * 0.085 - z * 0.07) * 1.4;
  // Attenue le relief a l'aval de la riviere (+Z) pour une vallee ouverte
  const riverCorridor = z > 10 ? Math.exp(-Math.pow((z - 15 - Math.sin(x * 0.08) * 4) / 14, 2)) * 0.72 : 0;
  return (hills + 5.2 * smooth * (1 - riverCorridor)) * smooth;
}

/**
 * 11. Genere le maillage terrain haute resolution (Catmull-Rom 64x64)
 * prolonge de facon etanche par des collines paysageres jusqu'a 165m.
 */
export function buildTerrainAndHorizonMesh(heights, res = 32, gSize = 52) {
  const fineRes = 64;
  const fineStride = fineRes + 1;
  const half = gSize * 0.5;
  const step = gSize / fineRes;

  const gridY = new Float32Array(fineStride * fineStride);
  for (let gz = 0; gz <= fineRes; gz++) {
    const v = gz / fineRes;
    for (let gx = 0; gx <= fineRes; gx++) {
      const u = gx / fineRes;
      gridY[gz * fineStride + gx] = sampleHeightsCatmullRom(heights, res, u, v);
    }
  }

  const gridN = new Float32Array(fineStride * fineStride * 3);
  for (let gz = 0; gz <= fineRes; gz++) {
    for (let gx = 0; gx <= fineRes; gx++) {
      const hL = gridY[gz * fineStride + Math.max(0, gx - 1)];
      const hR = gridY[gz * fineStride + Math.min(fineRes, gx + 1)];
      const hD = gridY[Math.max(0, gz - 1) * fineStride + gx];
      const hU = gridY[Math.min(fineRes, gz + 1) * fineStride + gx];
      const dx = (gx === 0 || gx === fineRes) ? step : step * 2;
      const dz = (gz === 0 || gz === fineRes) ? step : step * 2;
      let nx = (hL - hR) / dx;
      let ny = 1.0;
      let nz = (hD - hU) / dz;
      const len = Math.hypot(nx, ny, nz) || 1;
      const idx = (gz * fineStride + gx) * 3;
      gridN[idx] = nx / len;
      gridN[idx + 1] = ny / len;
      gridN[idx + 2] = nz / len;
    }
  }

  const pos = [];
  const norm = [];

  for (let gz = 0; gz < fineRes; gz++) {
    const z0 = (gz / fineRes - 0.5) * gSize;
    const z1 = ((gz + 1) / fineRes - 0.5) * gSize;
    for (let gx = 0; gx < fineRes; gx++) {
      const x0 = (gx / fineRes - 0.5) * gSize;
      const x1 = ((gx + 1) / fineRes - 0.5) * gSize;

      const i00 = gz * fineStride + gx;
      const i10 = i00 + 1;
      const i01 = i00 + fineStride;
      const i11 = i01 + 1;

      const v00 = [x0, gridY[i00], z0];
      const v10 = [x1, gridY[i10], z0];
      const v01 = [x0, gridY[i01], z1];
      const v11 = [x1, gridY[i11], z1];

      const n00 = [gridN[i00 * 3], gridN[i00 * 3 + 1], gridN[i00 * 3 + 2]];
      const n10 = [gridN[i10 * 3], gridN[i10 * 3 + 1], gridN[i10 * 3 + 2]];
      const n01 = [gridN[i01 * 3], gridN[i01 * 3 + 1], gridN[i01 * 3 + 2]];
      const n11 = [gridN[i11 * 3], gridN[i11 * 3 + 1], gridN[i11 * 3 + 2]];

      pos.push(...v00, ...v01, ...v11, ...v00, ...v11, ...v10);
      norm.push(...n00, ...n01, ...n11, ...n00, ...n11, ...n10);
    }
  }

  // Anneaux concentriques autour du perimetre exact de la grille 64x64 (sans aucune couture)
  const perimeter = [];
  const pushEdgePt = (gx, gz) => {
    const bx = (gx / fineRes - 0.5) * gSize;
    const bz = (gz / fineRes - 0.5) * gSize;
    const i = gz * fineStride + gx;
    perimeter.push({
      bx,
      bz,
      edgeY: gridY[i],
      edgeN: [gridN[i * 3], gridN[i * 3 + 1], gridN[i * 3 + 2]],
    });
  };
  for (let gx = 0; gx < fineRes; gx++) pushEdgePt(gx, 0);
  for (let gz = 0; gz < fineRes; gz++) pushEdgePt(fineRes, gz);
  for (let gx = fineRes; gx > 0; gx--) pushEdgePt(gx, fineRes);
  for (let gz = fineRes; gz > 0; gz--) pushEdgePt(0, gz);

  const rings = 14;
  const maxR = 162;
  const ringVerts = [];
  const pCount = perimeter.length;

  for (let r = 0; r <= rings; r++) {
    const frac = Math.pow(r / rings, 1.65);
    const blend = Math.min(1, frac * 2.2);
    const smoothBlend = blend * blend * (3 - 2 * blend);
    const row = [];
    for (let k = 0; k < pCount; k++) {
      const bp = perimeter[k];
      const bLen = Math.hypot(bp.bx, bp.bz) || 1;
      const ox = (bp.bx / bLen) * maxR;
      const oz = (bp.bz / bLen) * maxR;
      const x = bp.bx + (ox - bp.bx) * frac;
      const z = bp.bz + (oz - bp.bz) * frac;
      const y = r === 0 ? bp.edgeY : bp.edgeY * (1 - smoothBlend * 0.72) + distantRidgeHeight(x, z);
      row.push({ x, y, z, edgeN: bp.edgeN });
    }
    ringVerts.push(row);
  }

  // Normales douces de la jupe exterieure (partage exact sur r === 0)
  const ringNorms = [];
  for (let r = 0; r <= rings; r++) {
    const nRow = [];
    for (let k = 0; k < pCount; k++) {
      if (r === 0) {
        nRow.push(ringVerts[0][k].edgeN);
        continue;
      }
      const prevK = (k - 1 + pCount) % pCount;
      const nextK = (k + 1) % pCount;
      const pL = ringVerts[r][prevK];
      const pR = ringVerts[r][nextK];
      const pIn = ringVerts[r - 1][k];
      const pOut = ringVerts[Math.min(rings, r + 1)][k];

      const t1 = [pR.x - pL.x, pR.y - pL.y, pR.z - pL.z];
      const t2 = [pOut.x - pIn.x, pOut.y - pIn.y, pOut.z - pIn.z];
      let nx = t2[1] * t1[2] - t2[2] * t1[1];
      let ny = t2[2] * t1[0] - t2[0] * t1[2];
      let nz = t2[0] * t1[1] - t2[1] * t1[0];
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      nRow.push([nx / l, ny / l, nz / l]);
    }
    ringNorms.push(nRow);
  }

  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < pCount; k++) {
      const kNext = (k + 1) % pCount;
      const v00 = ringVerts[r][k];
      const v10 = ringVerts[r][kNext];
      const v01 = ringVerts[r + 1][k];
      const v11 = ringVerts[r + 1][kNext];

      const n00 = ringNorms[r][k];
      const n10 = ringNorms[r][kNext];
      const n01 = ringNorms[r + 1][k];
      const n11 = ringNorms[r + 1][kNext];

      pos.push(
        v00.x, v00.y, v00.z, v10.x, v10.y, v10.z, v11.x, v11.y, v11.z,
        v00.x, v00.y, v00.z, v11.x, v11.y, v11.z, v01.x, v01.y, v01.z
      );
      norm.push(
        ...n00, ...n10, ...n11,
        ...n00, ...n11, ...n01
      );
    }
  }

  return {
    pos: new Float32Array(pos),
    norm: new Float32Array(norm),
    count: pos.length / 3,
    halfSize: half,
  };
}

/**
 * Echantillonne la hauteur exacte du terrain y compris dans la campagne lointaine (arbres d'horizon).
 */
export function sampleExtendedTerrainHeight(heights, res = 32, gSize = 52, x = 0, z = 0) {
  if (!Array.isArray(heights) || !heights.length) return 0;
  const half = gSize * 0.5;
  const maxAbs = Math.max(Math.abs(x), Math.abs(z));
  if (maxAbs <= half) {
    return sampleHeightsCatmullRom(heights, res, x / gSize + 0.5, z / gSize + 0.5);
  }
  const s = half / maxAbs;
  const bx = x * s;
  const bz = z * s;
  const edgeY = sampleHeightsCatmullRom(heights, res, bx / gSize + 0.5, bz / gSize + 0.5);
  const bLen = Math.hypot(bx, bz) || 1;
  const dist = Math.hypot(x, z);
  const frac = Math.max(0, Math.min(1, (dist - bLen) / (162 - bLen)));
  const blend = Math.min(1, frac * 2.2);
  const smoothBlend = blend * blend * (3 - 2 * blend);
  return edgeY * (1 - smoothBlend * 0.72) + distantRidgeHeight(x, z);
}
