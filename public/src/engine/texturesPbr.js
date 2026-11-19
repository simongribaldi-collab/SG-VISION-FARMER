import * as THREE from "../../vendor/three/three.module.min.js";

function makePrng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTileableNoise(gridSize = 32, seed = 42) {
  const rng = makePrng(seed);
  const g = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const sample = (u, v) => {
    const x = ((u % 1) + 1) % 1 * gridSize;
    const y = ((v % 1) + 1) % 1 * gridSize;
    const x0 = Math.floor(x) % gridSize;
    const y0 = Math.floor(y) % gridSize;
    const x1 = (x0 + 1) % gridSize;
    const y1 = (y0 + 1) % gridSize;
    const tx = x - Math.floor(x);
    const ty = y - Math.floor(y);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * gridSize + x0];
    const b = g[y0 * gridSize + x1];
    const c = g[y1 * gridSize + x0];
    const d = g[y1 * gridSize + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (u, v) => 0.55 * sample(u, v) + 0.3 * sample(u * 2.0, v * 2.0) + 0.15 * sample(u * 4.0, v * 4.0);
}

function finalizeTex(canvas, isColor, repX, repY, maxAniso) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repX, repY);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

function drawTileWrapped(ctx, size, fn) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      ctx.save();
      ctx.translate(ox, oy);
      fn(ctx);
      ctx.restore();
    }
  }
}

function buildGrassTextures(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");
  const rng = makePrng(101);
  const fbm = makeTileableNoise(24, 202);

  // Fond organique doux (permet aux vertex colors terrain de moduler richement)
  a.fillStyle = "#b8cfa2";
  a.fillRect(0, 0, S, S);
  b.fillStyle = "#7a7a7a";
  b.fillRect(0, 0, S, S);

  for (let py = 0; py < S; py += 8) {
    for (let px = 0; px < S; px += 8) {
      const n = fbm(px / S, py / S);
      const l = Math.round(170 + (n - 0.5) * 42);
      const g = Math.round(196 + (n - 0.5) * 40);
      const bl = Math.round(145 + (n - 0.5) * 30);
      a.fillStyle = `rgb(${l},${g},${bl})`;
      a.fillRect(px, py, 8, 8);
      const bv = Math.round(115 + (n - 0.5) * 50);
      b.fillStyle = `rgb(${bv},${bv},${bv})`;
      b.fillRect(px, py, 8, 8);
    }
  }

  for (let i = 0; i < 2400; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 5 + rng() * 11;
    const ang = -Math.PI * 0.5 + (rng() - 0.5) * 0.85;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const shade = rng();
    const colA = shade > 0.88
      ? "rgba(218,214,158,0.45)"
      : shade > 0.45
        ? "rgba(148,192,112,0.52)"
        : "rgba(96,136,72,0.48)";
    const bv = Math.round(145 + rng() * 85);
    const colB = `rgba(${bv},${bv},${bv},0.55)`;

    const stroke = (ctx, col, w) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    };
    stroke(a, colA, 1.3);
    stroke(b, colB, 1.3);
  }

  return {
    map: finalizeTex(cA, true, 22, 22, maxAniso),
    bumpMap: finalizeTex(cB, false, 22, 22, maxAniso),
  };
}

function buildSoilTextures(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");
  const rng = makePrng(303);

  // Sillons maraichers nets le long de l'axe X
  const furrows = 12;
  for (let y = 0; y < S; y++) {
    const phase = (y / S) * furrows * Math.PI * 2;
    const ridge = 0.5 + 0.5 * Math.cos(phase);
    const r = Math.round(138 + ridge * 68);
    const g = Math.round(112 + ridge * 58);
    const bl = Math.round(92 + ridge * 46);
    a.fillStyle = `rgb(${r},${g},${bl})`;
    a.fillRect(0, y, S, 1);

    const bv = Math.round(45 + ridge * 175);
    b.fillStyle = `rgb(${bv},${bv},${bv})`;
    b.fillRect(0, y, S, 1);
  }

  // Mottes de terre et micro-galets
  for (let i = 0; i < 1800; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const rad = 1 + rng() * 3.2;
    const dark = rng() > 0.4;
    a.fillStyle = dark ? "rgba(70,48,30,0.34)" : "rgba(215,190,155,0.28)";
    a.beginPath();
    a.arc(x, y, rad, 0, Math.PI * 2);
    a.fill();

    const bv = dark ? 75 : 225;
    b.fillStyle = `rgba(${bv},${bv},${bv},0.42)`;
    b.beginPath();
    b.arc(x, y, rad, 0, Math.PI * 2);
    b.fill();
  }

  return {
    map: finalizeTex(cA, true, 2, 2, maxAniso),
    bumpMap: finalizeTex(cB, false, 2, 2, maxAniso),
  };
}

function buildMetalCorrugatedTextures(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const cR = document.createElement("canvas"); cR.width = S; cR.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");
  const r = cR.getContext("2d");
  const rng = makePrng(404);

  const ribs = 28;
  for (let x = 0; x < S; x++) {
    const wave = 0.5 + 0.5 * Math.cos((x / S) * ribs * Math.PI * 2);
    const trap = Math.pow(wave, 0.72);
    const v = Math.round(176 + trap * 62);
    a.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    a.fillRect(x, 0, 1, S);

    const bv = Math.round(48 + trap * 185);
    b.fillStyle = `rgb(${bv},${bv},${bv})`;
    b.fillRect(x, 0, 1, S);

    const rv = Math.round(92 + (1 - trap) * 52);
    r.fillStyle = `rgb(${rv},${rv},${rv})`;
    r.fillRect(x, 0, 1, S);
  }

  // Lignes de recouvrement des bacs acier + micro-patine
  for (const sy of [128, 384]) {
    a.fillStyle = "rgba(35,42,50,0.28)";
    a.fillRect(0, sy, S, 3);
    b.fillStyle = "rgb(30,30,30)";
    b.fillRect(0, sy, S, 3);
  }
  for (let i = 0; i < 240; i++) {
    const x = rng() * S;
    const y = rng() * S;
    a.fillStyle = `rgba(255,255,255,${0.03 + rng() * 0.05})`;
    a.fillRect(x, y, 2 + rng() * 14, 1);
  }

  return {
    map: finalizeTex(cA, true, 3, 2, maxAniso),
    bumpMap: finalizeTex(cB, false, 3, 2, maxAniso),
    roughnessMap: finalizeTex(cR, false, 3, 2, maxAniso),
  };
}

function buildStoneWallTextures(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");
  const rng = makePrng(505);

  a.fillStyle = "#9d927f";
  a.fillRect(0, 0, S, S);
  b.fillStyle = "#2d2d2d";
  b.fillRect(0, 0, S, S);

  const rows = 8;
  const rowH = S / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rowH;
    let x = (row % 2) * -32;
    while (x < S) {
      const w = 52 + rng() * 48;
      const bw = Math.min(w - 5, S - x + 32);
      const tone = 190 + Math.round((rng() - 0.5) * 44);
      const warm = Math.round(rng() * 16);
      const colA = `rgb(${tone + warm},${tone - 4},${tone - 22})`;
      const bv = 165 + Math.round(rng() * 70);
      const colB = `rgb(${bv},${bv},${bv})`;

      drawTileWrapped(a, S, (ctx) => {
        ctx.fillStyle = colA;
        ctx.fillRect(x + 3, y + 3, w - 6, rowH - 6);
        ctx.fillStyle = "rgba(255,250,235,0.16)";
        ctx.fillRect(x + 4, y + 4, w - 8, 3);
      });
      drawTileWrapped(b, S, (ctx) => {
        ctx.fillStyle = colB;
        ctx.fillRect(x + 3, y + 3, w - 6, rowH - 6);
      });
      x += Math.max(46, bw);
    }
  }

  for (let i = 0; i < 1400; i++) {
    const px = rng() * S;
    const py = rng() * S;
    a.fillStyle = rng() > 0.5 ? "rgba(70,60,48,0.12)" : "rgba(255,250,240,0.12)";
    a.fillRect(px, py, 2 + rng() * 4, 2 + rng() * 3);
  }

  return {
    map: finalizeTex(cA, true, 2.5, 1.5, maxAniso),
    bumpMap: finalizeTex(cB, false, 2.5, 1.5, maxAniso),
  };
}

function buildRoofTileTextures(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");
  const rng = makePrng(606);

  const cols = 12;
  const rows = 10;
  const cw = S / cols;
  const rh = S / rows;

  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    for (let col = 0; col < cols; col++) {
      const x = col * cw;
      const shade = (rng() - 0.5) * 34;
      const rCol = Math.min(245, Math.max(120, Math.round(188 + shade)));
      const gCol = Math.min(200, Math.max(70, Math.round(108 + shade * 0.6)));
      const bCol = Math.min(180, Math.max(55, Math.round(78 + shade * 0.4)));

      const gradA = a.createLinearGradient(x, y, x + cw, y);
      gradA.addColorStop(0, `rgb(${Math.round(rCol * 0.66)},${Math.round(gCol * 0.66)},${Math.round(bCol * 0.66)})`);
      gradA.addColorStop(0.5, `rgb(${rCol},${gCol},${bCol})`);
      gradA.addColorStop(1, `rgb(${Math.round(rCol * 0.68)},${Math.round(gCol * 0.68)},${Math.round(bCol * 0.68)})`);
      a.fillStyle = gradA;
      a.fillRect(x, y, cw, rh);

      a.fillStyle = "rgba(40,14,8,0.28)";
      a.fillRect(x, y + rh - 4, cw, 4);

      const gradB = b.createLinearGradient(x, y, x + cw, y);
      gradB.addColorStop(0, "rgb(75,75,75)");
      gradB.addColorStop(0.5, "rgb(235,235,235)");
      gradB.addColorStop(1, "rgb(75,75,75)");
      b.fillStyle = gradB;
      b.fillRect(x, y, cw, rh);
      b.fillStyle = "rgb(45,45,45)";
      b.fillRect(x, y + rh - 4, cw, 4);
    }
  }

  return {
    map: finalizeTex(cA, true, 3, 2, maxAniso),
    bumpMap: finalizeTex(cB, false, 3, 2, maxAniso),
  };
}

function buildWoodTextures(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");
  const rng = makePrng(707);

  const planks = 6;
  const ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const y = p * ph;
    const base = 175 + Math.round((rng() - 0.5) * 32);
    a.fillStyle = `rgb(${base + 18},${base - 14},${base - 52})`;
    a.fillRect(0, y, S, ph - 3);
    a.fillStyle = "#52351e";
    a.fillRect(0, y + ph - 3, S, 3);

    b.fillStyle = "rgb(175,175,175)";
    b.fillRect(0, y, S, ph - 3);
    b.fillStyle = "rgb(45,45,45)";
    b.fillRect(0, y + ph - 3, S, 3);

    for (let f = 0; f < 26; f++) {
      const fy = y + 4 + rng() * (ph - 10);
      a.fillStyle = rng() > 0.5 ? "rgba(85,50,24,0.22)" : "rgba(245,215,175,0.16)";
      a.fillRect(0, fy, S, 1 + rng() * 1.5);
    }
  }

  return {
    map: finalizeTex(cA, true, 2, 2, maxAniso),
    bumpMap: finalizeTex(cB, false, 2, 2, maxAniso),
  };
}

function buildAsphaltAndGravel(maxAniso) {
  const S = 512;
  const mk = (seed, baseRgb, speckDark, speckLight, tracks) => {
    const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
    const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
    const a = cA.getContext("2d");
    const b = cB.getContext("2d");
    const rng = makePrng(seed);

    a.fillStyle = baseRgb;
    a.fillRect(0, 0, S, S);
    b.fillStyle = "rgb(128,128,128)";
    b.fillRect(0, 0, S, S);

    if (tracks) {
      for (const ty of [145, 365]) {
        const g = a.createLinearGradient(0, ty - 55, 0, ty + 55);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.5, "rgba(50,42,32,0.16)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        a.fillStyle = g;
        a.fillRect(0, ty - 55, S, 110);
      }
    }

    for (let i = 0; i < 4200; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const sz = 1 + rng() * (tracks ? 3.2 : 2.2);
      const isL = rng() > 0.45;
      a.fillStyle = isL ? speckLight : speckDark;
      a.fillRect(x, y, sz, sz);
      const bv = isL ? 185 : 75;
      b.fillStyle = `rgb(${bv},${bv},${bv})`;
      b.fillRect(x, y, sz, sz);
    }
    return {
      map: finalizeTex(cA, true, 3, 1, maxAniso),
      bumpMap: finalizeTex(cB, false, 3, 1, maxAniso),
    };
  };

  return {
    asphalt: mk(808, "#7e8690", "rgba(38,42,48,0.4)", "rgba(210,218,228,0.28)", false),
    gravel: mk(809, "#cbb896", "rgba(92,76,54,0.38)", "rgba(246,238,220,0.44)", true),
  };
}

function buildSolarTexture(maxAniso) {
  const S = 512;
  const cA = document.createElement("canvas"); cA.width = S; cA.height = S;
  const cB = document.createElement("canvas"); cB.width = S; cB.height = S;
  const a = cA.getContext("2d");
  const b = cB.getContext("2d");

  a.fillStyle = "#10285e";
  a.fillRect(0, 0, S, S);
  b.fillStyle = "rgb(140,140,140)";
  b.fillRect(0, 0, S, S);

  const cols = 6;
  const rows = 4;
  const cw = S / cols;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw;
      const y = r * rh;
      a.fillStyle = "#16357d";
      a.fillRect(x + 4, y + 4, cw - 8, rh - 8);
      a.fillStyle = "rgba(148,196,255,0.22)";
      a.fillRect(x + 4, y + Math.round(rh * 0.5), cw - 8, 2);
      for (let f = 1; f < 4; f++) {
        a.fillStyle = "rgba(180,210,255,0.18)";
        a.fillRect(x + (cw * f) / 4, y + 4, 1, rh - 8);
      }
      b.fillStyle = "rgb(200,200,200)";
      b.fillRect(x + 3, y + 3, cw - 6, rh - 6);
    }
  }
  a.strokeStyle = "#cbd5e1";
  a.lineWidth = 8;
  a.strokeRect(4, 4, S - 8, S - 8);

  return {
    map: finalizeTex(cA, true, 2, 1, maxAniso),
    bumpMap: finalizeTex(cB, false, 2, 1, maxAniso),
  };
}

function buildUtilityTextures(maxAniso) {
  const S = 512;

  // Poly film bump + subtle rib lines
  const cPoly = document.createElement("canvas"); cPoly.width = S; cPoly.height = S;
  const pCtx = cPoly.getContext("2d");
  for (let x = 0; x < S; x++) {
    const v = Math.round(115 + 35 * Math.sin((x / S) * Math.PI * 36) + 25 * Math.sin((x / S) * Math.PI * 10));
    pCtx.fillStyle = `rgb(${v},${v},${v})`;
    pCtx.fillRect(x, 0, 1, S);
  }

  // White insulated panel (conserverie / chambre froide)
  const cPanelA = document.createElement("canvas"); cPanelA.width = S; cPanelA.height = S;
  const cPanelB = document.createElement("canvas"); cPanelB.width = S; cPanelB.height = S;
  const pa = cPanelA.getContext("2d");
  const pb = cPanelB.getContext("2d");
  pa.fillStyle = "#f1f5f9"; pa.fillRect(0, 0, S, S);
  pb.fillStyle = "rgb(190,190,190)"; pb.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 64) {
    pa.fillStyle = "#cbd5e1"; pa.fillRect(x, 0, 3, S);
    pb.fillStyle = "rgb(85,85,85)"; pb.fillRect(x, 0, 3, S);
  }

  // Woven tarp
  const cTarp = document.createElement("canvas"); cTarp.width = S; cTarp.height = S;
  const ta = cTarp.getContext("2d");
  ta.fillStyle = "#eef2f6"; ta.fillRect(0, 0, S, S);
  ta.fillStyle = "rgba(180,194,210,0.22)";
  for (let i = 0; i < S; i += 8) {
    ta.fillRect(i, 0, 2, S);
    ta.fillRect(0, i, S, 2);
  }

  // Water ripple bump
  const cWater = document.createElement("canvas"); cWater.width = S; cWater.height = S;
  const wa = cWater.getContext("2d");
  const waterN = makeTileableNoise(24, 999);
  for (let y = 0; y < S; y += 4) {
    for (let x = 0; x < S; x += 4) {
      const n = waterN(x / S, y / S);
      const wave = 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 12 + n * 6.0);
      const bv = Math.round(70 + wave * 155);
      wa.fillStyle = `rgb(${bv},${bv},${bv})`;
      wa.fillRect(x, y, 4, 4);
    }
  }

  // Bark
  const cBarkA = document.createElement("canvas"); cBarkA.width = S; cBarkA.height = S;
  const cBarkB = document.createElement("canvas"); cBarkB.width = S; cBarkB.height = S;
  const ba = cBarkA.getContext("2d");
  const bb = cBarkB.getContext("2d");
  const rng = makePrng(909);
  ba.fillStyle = "#8a684b"; ba.fillRect(0, 0, S, S);
  bb.fillStyle = "rgb(130,130,130)"; bb.fillRect(0, 0, S, S);
  for (let i = 0; i < 650; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const h = 18 + rng() * 64;
    const dark = rng() > 0.45;
    ba.fillStyle = dark ? "rgba(45,28,16,0.45)" : "rgba(165,135,105,0.28)";
    ba.fillRect(x, y, 2 + rng() * 5, h);
    bb.fillStyle = dark ? "rgb(60,60,60)" : "rgb(210,210,210)";
    bb.fillRect(x, y, 2 + rng() * 5, h);
  }

  // Foliage leaf pattern (neutre lumineux pour teinte directe via mat.color)
  const cLeafA = document.createElement("canvas"); cLeafA.width = S; cLeafA.height = S;
  const cLeafB = document.createElement("canvas"); cLeafB.width = S; cLeafB.height = S;
  const la = cLeafA.getContext("2d");
  const lb = cLeafB.getContext("2d");
  la.fillStyle = "#d8e6d2"; la.fillRect(0, 0, S, S);
  lb.fillStyle = "rgb(125,125,125)"; lb.fillRect(0, 0, S, S);
  for (let i = 0; i < 950; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 14;
    const ang = rng() * Math.PI;
    const lShade = rng() > 0.5 ? "rgba(255,255,255,0.55)" : "rgba(170,194,162,0.45)";
    const bv = rng() > 0.5 ? 215 : 85;
    drawTileWrapped(la, S, (ctx) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = lShade;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    drawTileWrapped(lb, S, (ctx) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = `rgb(${bv},${bv},${bv})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  return {
    polyBump: finalizeTex(cPoly, false, 3, 2, maxAniso),
    panelMap: finalizeTex(cPanelA, true, 2, 1, maxAniso),
    panelBump: finalizeTex(cPanelB, false, 2, 1, maxAniso),
    tarpMap: finalizeTex(cTarp, true, 2, 3, maxAniso),
    waterBump: finalizeTex(cWater, false, 5, 2, maxAniso),
    barkMap: finalizeTex(cBarkA, true, 2, 2, maxAniso),
    barkBump: finalizeTex(cBarkB, false, 2, 2, maxAniso),
    leafMap: finalizeTex(cLeafA, true, 2, 2, maxAniso),
    leafBump: finalizeTex(cLeafB, false, 2, 2, maxAniso),
  };
}

/**
 * Cree et met en cache la bibliotheque complete de materiaux & textures PBR 512x512.
 */
export function createPbrMaterials(renderer) {
  const maxAniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);

  const grassT = buildGrassTextures(maxAniso);
  const soilT = buildSoilTextures(maxAniso);
  const metalT = buildMetalCorrugatedTextures(maxAniso);
  const stoneT = buildStoneWallTextures(maxAniso);
  const roofT = buildRoofTileTextures(maxAniso);
  const woodT = buildWoodTextures(maxAniso);
  const roadT = buildAsphaltAndGravel(maxAniso);
  const solarT = buildSolarTexture(maxAniso);
  const utilT = buildUtilityTextures(maxAniso);

  const allTex = [
    grassT.map, grassT.bumpMap,
    soilT.map, soilT.bumpMap,
    metalT.map, metalT.bumpMap, metalT.roughnessMap,
    stoneT.map, stoneT.bumpMap,
    roofT.map, roofT.bumpMap,
    woodT.map, woodT.bumpMap,
    roadT.asphalt.map, roadT.asphalt.bumpMap,
    roadT.gravel.map, roadT.gravel.bumpMap,
    solarT.map, solarT.bumpMap,
    utilT.polyBump, utilT.panelMap, utilT.panelBump,
    utilT.tarpMap, utilT.waterBump,
    utilT.barkMap, utilT.barkBump,
    utilT.leafMap, utilT.leafBump,
  ];

  const base = {
    terrain: new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: grassT.map,
      bumpMap: grassT.bumpMap,
      bumpScale: 0.08,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.28,
    }),
    grassBlade: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.25,
    }),
    soil: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: soilT.map,
      bumpMap: soilT.bumpMap,
      bumpScale: 0.14,
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.25,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: 0xfaf6f0,
      map: stoneT.map,
      bumpMap: stoneT.bumpMap,
      bumpScale: 0.11,
      roughness: 0.88,
      metalness: 0.02,
      envMapIntensity: 0.7,
    }),
    roofTile: new THREE.MeshStandardMaterial({
      color: 0xf8eae4,
      map: roofT.map,
      bumpMap: roofT.bumpMap,
      bumpScale: 0.1,
      roughness: 0.78,
      metalness: 0.04,
      envMapIntensity: 0.85,
    }),
    metalCorrugated: new THREE.MeshStandardMaterial({
      color: 0xe6edf4,
      map: metalT.map,
      bumpMap: metalT.bumpMap,
      bumpScale: 0.08,
      roughnessMap: metalT.roughnessMap,
      roughness: 0.36,
      metalness: 0.7,
      envMapIntensity: 1.35,
    }),
    metalSmooth: new THREE.MeshStandardMaterial({
      color: 0xdbe3ec,
      roughness: 0.26,
      metalness: 0.82,
      envMapIntensity: 1.4,
    }),
    wood: new THREE.MeshStandardMaterial({
      color: 0xeedec9,
      map: woodT.map,
      bumpMap: woodT.bumpMap,
      bumpScale: 0.06,
      roughness: 0.82,
      metalness: 0.02,
      envMapIntensity: 0.65,
    }),
    asphalt: new THREE.MeshStandardMaterial({
      color: 0x626870,
      map: roadT.asphalt.map,
      bumpMap: roadT.asphalt.bumpMap,
      bumpScale: 0.05,
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.28,
    }),
    gravel: new THREE.MeshStandardMaterial({
      color: 0xe6dac6,
      map: roadT.gravel.map,
      bumpMap: roadT.gravel.bumpMap,
      bumpScale: 0.09,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.3,
    }),
    solar: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: solarT.map,
      bumpMap: solarT.bumpMap,
      bumpScale: 0.03,
      roughness: 0.14,
      metalness: 0.36,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.65,
    }),
    whitePanel: new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      map: utilT.panelMap,
      bumpMap: utilT.panelBump,
      bumpScale: 0.03,
      roughness: 0.36,
      metalness: 0.14,
      envMapIntensity: 1.1,
    }),
    tarp: new THREE.MeshStandardMaterial({
      color: 0xf4f7fa,
      map: utilT.tarpMap,
      bumpMap: utilT.tarpMap,
      bumpScale: 0.03,
      roughness: 0.56,
      metalness: 0.02,
      envMapIntensity: 0.9,
    }),
    polyFilm: new THREE.MeshPhysicalMaterial({
      color: 0xd8f0f6,
      bumpMap: utilT.polyBump,
      bumpScale: 0.03,
      transparent: true,
      opacity: 0.38,
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      reflectivity: 0.9,
      envMapIntensity: 1.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    polyFilmBi: new THREE.MeshPhysicalMaterial({
      color: 0xb2e4d2,
      bumpMap: utilT.polyBump,
      bumpScale: 0.03,
      transparent: true,
      opacity: 0.4,
      roughness: 0.18,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      reflectivity: 0.88,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    glassVenlo: new THREE.MeshPhysicalMaterial({
      color: 0xd6f2ff,
      transparent: true,
      opacity: 0.33,
      roughness: 0.08,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      reflectivity: 0.95,
      envMapIntensity: 1.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x166ba0,
      bumpMap: utilT.waterBump,
      bumpScale: 0.06,
      roughness: 0.09,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      reflectivity: 0.95,
      envMapIntensity: 1.85,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    }),
    bark: new THREE.MeshStandardMaterial({
      color: 0x8d694b,
      map: utilT.barkMap,
      bumpMap: utilT.barkBump,
      bumpScale: 0.1,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.45,
    }),
    foliage: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: utilT.leafMap,
      bumpMap: utilT.leafBump,
      bumpScale: 0.04,
      roughness: 0.86,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.28,
    }),
    standard: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.08,
      envMapIntensity: 0.95,
    }),
  };

  const variants = new Map();
  const getVariant = (baseKey, colorHex, extra = {}) => {
    const k = `${baseKey}|${colorHex}|${extra.emissive || 0}|${extra.emissiveColor || 0}|${extra.opacity ?? 1}|${extra.doubleSide ? 1 : 0}`;
    if (variants.has(k)) return variants.get(k);
    const tpl = base[baseKey] || base.standard;
    const mat = tpl.clone();
    if (colorHex !== undefined && colorHex !== null) {
      mat.color = new THREE.Color(colorHex);
    }
    if (extra.emissive) {
      mat.emissive = new THREE.Color(extra.emissiveColor !== undefined ? extra.emissiveColor : (colorHex || 0xffffff));
      mat.emissiveIntensity = extra.emissive;
    }
    if (extra.opacity !== undefined && extra.opacity < 1) {
      mat.transparent = true;
      mat.opacity = extra.opacity;
      mat.depthWrite = false;
    }
    if (extra.doubleSide) mat.side = THREE.DoubleSide;
    variants.set(k, mat);
    return mat;
  };

  return {
    base,
    textures: allTex,
    waterBump: utilT.waterBump,
    getVariant,
    dispose() {
      Object.values(base).forEach((m) => m.dispose());
      variants.forEach((m) => m.dispose());
      variants.clear();
      allTex.forEach((t) => t.dispose());
    },
  };
}
