import { generateTerrainHeights } from "../data/presets.js";

/**
 * Module de reconstruction 3D depuis video / camera / photo drone / plan
 * et d'import topographique GPS reel (dénivelé NGF).
 */

export const DEMO_SCANS = [
  { id: "coteau_ferme", label: "🚁 Scan Drone : Corps de Ferme en U, Coteau, Haies & Rivière" },
  { id: "maraichage_vallee", label: "📹 Film Terrain : Maraîchage, Serres, Chemins & Ruisseau" },
  { id: "bocage_elevage", label: "🐄 Vue Aérienne : Bocage, Grange Pierre, Paddocks & Mare" },
];

/**
 * Recupere les altitudes reelles autour de (lat, lon) via Open-Meteo Elevation API
 * et construit une carte de denivele 3D fidele au terrain reel.
 */
export async function fetchRealTopography(lat, lon, res = 32) {
  // Echantillonnage 5x5 points a +-0.003 deg (~330m) puis interpolation bicubique/bilineaire sur 33x33
  const sampleN = 5;
  const span = 0.0032;
  const lats = [];
  const lons = [];
  for (let gz = 0; gz < sampleN; gz++) {
    for (let gx = 0; gx < sampleN; gx++) {
      const ny = (gz / (sampleN - 1)) * 2 - 1;
      const nx = (gx / (sampleN - 1)) * 2 - 1;
      lats.push((lat - ny * span).toFixed(5));
      lons.push((lon + nx * span).toFixed(5));
    }
  }

  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const elev = data.elevation;
    if (!Array.isArray(elev) || elev.length !== sampleN * sampleN) throw new Error("Invalid elevation array");

    const minE = Math.min(...elev);
    const maxE = Math.max(...elev);
    const centerE = elev[Math.floor(elev.length / 2)];
    const diff = Math.max(1, maxE - minE);
    const scaleFactor = Math.min(4.2, Math.max(0.8, diff / 8));

    const heights = [];
    for (let gz = 0; gz <= res; gz++) {
      const fz = (gz / res) * (sampleN - 1);
      const z0 = Math.min(sampleN - 2, Math.floor(fz));
      const tz = fz - z0;
      for (let gx = 0; gx <= res; gx++) {
        const fx = (gx / res) * (sampleN - 1);
        const x0 = Math.min(sampleN - 2, Math.floor(fx));
        const tx = fx - x0;

        const e00 = elev[z0 * sampleN + x0];
        const e10 = elev[z0 * sampleN + x0 + 1];
        const e01 = elev[(z0 + 1) * sampleN + x0];
        const e11 = elev[(z0 + 1) * sampleN + x0 + 1];
        const eInterp =
          e00 * (1 - tx) * (1 - tz) +
          e10 * tx * (1 - tz) +
          e01 * (1 - tx) * tz +
          e11 * tx * tz;
        const relH = ((eInterp - centerE) / diff) * scaleFactor * 2.2;
        heights.push(Number(relH.toFixed(2)));
      }
    }

    return {
      ok: true,
      minElevationM: Math.round(minE),
      maxElevationM: Math.round(maxE),
      deltaM: Math.round(maxE - minE),
      terrain: { res, heights, presetId: "gps_real" },
    };
  } catch {
    const fallback = generateTerrainHeights("hillside", res);
    return {
      ok: false,
      minElevationM: 142,
      maxElevationM: 164,
      deltaM: 22,
      terrain: fallback,
    };
  }
}

/**
 * Dessine une sequence video synthetique de survol de ferme pour tester le scanner video sans webcam.
 */
export function drawDemoVideoScanFrame(ctx, w, h, presetId = "coteau_ferme", timeSec = 0) {
  const panX = Math.sin(timeSec * 0.6) * 8;
  const panY = Math.cos(timeSec * 0.45) * 5;

  // Fond prairie / coteau
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (presetId === "coteau_ferme") {
    grad.addColorStop(0, "#3f6a34");
    grad.addColorStop(0.55, "#4d7c3f");
    grad.addColorStop(1, "#628b48");
  } else if (presetId === "maraichage_vallee") {
    grad.addColorStop(0, "#46733b");
    grad.addColorStop(1, "#3b6934");
  } else {
    grad.addColorStop(0, "#3a6830");
    grad.addColorStop(1, "#558242");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(panX, panY);

  // Chemins ocre / cour de ferme
  ctx.fillStyle = "#c9b082";
  ctx.fillRect(w * 0.34, h * 0.18, w * 0.28, h * 0.14);
  ctx.fillRect(w * 0.44, h * 0.28, w * 0.06, h * 0.58);
  ctx.fillRect(w * 0.15, h * 0.52, w * 0.68, h * 0.055);

  // Riviere bleue sinueuse en bas
  ctx.fillStyle = "#197bbd";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.82);
  ctx.bezierCurveTo(w * 0.3, h * 0.76, w * 0.65, h * 0.89, w, h * 0.81);
  ctx.lineTo(w, h * 0.92);
  ctx.bezierCurveTo(w * 0.65, h * 0.98, w * 0.3, h * 0.86, 0, h * 0.91);
  ctx.closePath();
  ctx.fill();

  // Corps de ferme (toitures tuiles terre cuite rouge/orange)
  ctx.fillStyle = "#b84a2c";
  ctx.fillRect(w * 0.36, h * 0.08, w * 0.24, h * 0.09);
  ctx.fillRect(w * 0.36, h * 0.08, w * 0.06, h * 0.19);
  ctx.fillRect(w * 0.54, h * 0.08, w * 0.06, h * 0.19);
  // Grange pierre
  ctx.fillStyle = "#9c4128";
  ctx.fillRect(w * 0.14, h * 0.11, w * 0.15, h * 0.1);

  // Serres tunnel (bleu-gris clair reflechissant)
  if (presetId !== "bocage_elevage") {
    ctx.fillStyle = "#8fd4f5";
    ctx.fillRect(w * 0.56, h * 0.33, w * 0.24, h * 0.08);
    ctx.fillRect(w * 0.56, h * 0.43, w * 0.24, h * 0.08);
  }

  // Planches de culture (terre brune + rangs verts)
  ctx.fillStyle = "#5c3d28";
  for (let i = 0; i < 4; i++) {
    const py = h * (0.28 + i * 0.055);
    ctx.fillRect(w * 0.14, py, w * 0.25, h * 0.038);
  }

  // Haies bocageres (vert sombre)
  ctx.fillStyle = "#173d19";
  ctx.fillRect(w * 0.05, h * 0.12, w * 0.04, h * 0.62);
  ctx.fillRect(w * 0.86, h * 0.18, w * 0.045, h * 0.54);

  // Paddock d'elevage
  ctx.fillStyle = "#5fa845";
  ctx.fillRect(w * 0.56, h * 0.6, w * 0.26, h * 0.17);

  ctx.restore();
}

/**
 * Analyse une image/frame video par segmentation chromatique & spatiale
 * pour reconstruire automatiquement les batiments, haies, chemins, riviere, planches et denivele.
 */
export function analyzeFrameToFarmLayout(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;

  const cols = 12;
  const rows = 9;
  const cellW = w / cols;
  const cellH = h / rows;

  const detections = [];
  const used = new Set();

  const classifyCell = (r, g, b) => {
    // Toiture tuile / brique / corps de ferme
    if (r > 135 && r > g * 1.28 && r > b * 1.45) return "corps_ferme";
    // Eau / Riviere / Mare
    if (b > 125 && b > r * 1.25 && b > g * 1.05) return "river_seg";
    // Serre / Verre / Solaire clair
    if (b > 175 && g > 165 && r > 110) return "greenhouse";
    // Chemin / Cour gravier / Pierre claire
    if (r > 155 && g > 135 && b > 95 && Math.abs(r - g) < 35 && r > b * 1.15) return "path_dirt";
    // Planche terre brune
    if (r > 70 && r < 140 && g > 45 && g < 105 && b < 75 && r > b * 1.3) return "bed_open";
    // Haie / Arbres vert tres sombre
    if (g > 45 && g < 95 && g > r * 1.2 && g > b * 1.2) return "hedge_row";
    // Paddock prairie claire
    if (g > 135 && g > r * 1.15 && g > b * 1.25) return "paddock";
    return "ground";
  };

  const gridTypes = [];
  const lumRow = new Array(rows).fill(0);

  for (let gy = 0; gy < rows; gy++) {
    const row = [];
    for (let gx = 0; gx < cols; gx++) {
      let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
      const x0 = Math.floor(gx * cellW), y0 = Math.floor(gy * cellH);
      for (let py = y0 + 2; py < y0 + cellH - 2; py += 4) {
        for (let px = x0 + 2; px < x0 + cellW - 2; px += 4) {
          const idx = (py * w + px) * 4;
          rSum += img[idx];
          gSum += img[idx + 1];
          bSum += img[idx + 2];
          cnt++;
        }
      }
      const r = rSum / Math.max(1, cnt);
      const g = gSum / Math.max(1, cnt);
      const b = bSum / Math.max(1, cnt);
      lumRow[gy] += (r + g + b) / 3;
      row.push(classifyCell(r, g, b));
    }
    gridTypes.push(row);
  }

  // Regroupement horizontal des cellules adjacentes de meme type
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const key = `${gx},${gy}`;
      if (used.has(key)) continue;
      const t = gridTypes[gy][gx];
      if (t === "ground") continue;

      let spanX = 1;
      while (gx + spanX < cols && gridTypes[gy][gx + spanX] === t && !used.has(`${gx + spanX},${gy}`)) {
        used.add(`${gx + spanX},${gy}`);
        spanX++;
      }
      used.add(key);

      // Conversion coordonnees image -> coordonnees monde 3D (-18..+18)
      const normX = ((gx + spanX / 2) / cols) * 2 - 1;
      const normZ = ((gy + 0.5) / rows) * 2 - 1;
      const worldX = Number((normX * 17).toFixed(1));
      const worldZ = Number((normZ * 15).toFixed(1));
      const worldW = Number(Math.max(2.4, spanX * 3.1).toFixed(1));

      detections.push({
        kind: t,
        px: gx * cellW,
        py: gy * cellH,
        pw: spanX * cellW,
        ph: cellH,
        worldX,
        worldZ,
        worldW,
      });
    }
  }

  // Dessin des boites de vision IA sur le canvas d'apercu
  const colorMap = {
    corps_ferme: { stroke: "#f97316", label: "🏰 Corps de Ferme / Bâtiment" },
    greenhouse: { stroke: "#38bdf8", label: "⛺ Serre / Tunnel" },
    bed_open: { stroke: "#a3e635", label: "🥬 Planche de Culture" },
    hedge_row: { stroke: "#22c55e", label: "🌳 Haie / Arbres" },
    path_dirt: { stroke: "#fde047", label: "🛤️ Chemin / Cour" },
    river_seg: { stroke: "#0ea5e9", label: "🏞️ Rivière / Eau" },
    paddock: { stroke: "#4ade80", label: "🐄 Paddock Pâturage" },
  };

  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = "bold 11px Inter, sans-serif";
  for (const d of detections.slice(0, 26)) {
    const st = colorMap[d.kind] || { stroke: "#fff", label: d.kind };
    ctx.strokeStyle = st.stroke;
    ctx.strokeRect(d.px + 2, d.py + 2, d.pw - 4, d.ph - 4);
    ctx.fillStyle = "rgba(8, 15, 23, 0.78)";
    ctx.fillRect(d.px + 2, d.py + 2, Math.min(d.pw - 4, 145), 16);
    ctx.fillStyle = st.stroke;
    ctx.fillText(st.label, d.px + 6, d.py + 14);
  }
  ctx.restore();

  // Estimation de pente nord-sud depuis le gradient de luminance
  const topLum = (lumRow[0] + lumRow[1]) / (2 * cols);
  const botLum = (lumRow[rows - 2] + lumRow[rows - 1]) / (2 * cols);
  const hasRiver = detections.some((d) => d.kind === "river_seg");
  const terrainPreset = hasRiver ? "valley_river" : Math.abs(topLum - botLum) > 12 ? "hillside" : "bocage_rolling";

  return {
    detections,
    terrainPreset,
    counts: {
      buildings: detections.filter((d) => d.kind === "corps_ferme").length,
      greenhouses: detections.filter((d) => d.kind === "greenhouse").length,
      plots: detections.filter((d) => d.kind === "bed_open").length,
      hedges: detections.filter((d) => d.kind === "hedge_row").length,
      paths: detections.filter((d) => d.kind === "path_dirt").length,
      rivers: detections.filter((d) => d.kind === "river_seg").length,
      paddocks: detections.filter((d) => d.kind === "paddock").length,
    },
  };
}

/**
 * Applique le resultat d'un scan video/image directement dans l'etat 3D de la ferme.
 */
export function applyScanToFarmState(state, scanResult) {
  if (!scanResult || !scanResult.detections) return;
  state.terrain = generateTerrainHeights(scanResult.terrainPreset || "valley_river", 32);
  state.terrain._dirty = true;
  state.terrain._version = Date.now();

  const newPlots = [];
  const newStructures = [
    { id: "STR-WX", type: "weather_station", label: "Station Météo IoT", x: -4.5, z: -13.5, w: 1.5, d: 1.5, h: 3.6, rot: 0 },
  ];

  const cropCycle = ["carotte", "laitue", "mais", "tournesol", "courgette", "poireau", "vigne"];
  let plotCounter = 1;
  let ghCounter = 1;
  let mainFarmhousePlaced = false;

  for (const d of scanResult.detections.slice(0, 28)) {
    if (d.kind === "corps_ferme") {
      if (!mainFarmhousePlaced) {
        mainFarmhousePlaced = true;
        newStructures.push({
          id: `SCAN-CORPS-${newStructures.length}`,
          type: "farmhouse_courtyard",
          label: "Corps de Ferme Détecté (Scan)",
          x: d.worldX,
          z: d.worldZ,
          w: Math.max(9, d.worldW),
          d: 7.5,
          h: 4.8,
          rot: 0,
        });
      } else {
        newStructures.push({
          id: `SCAN-BARN-${newStructures.length}`,
          type: "stone_barn",
          label: "Grange en Pierre (Scan)",
          x: d.worldX,
          z: d.worldZ,
          w: Math.max(6, d.worldW),
          d: 4.8,
          h: 4.4,
          rot: 0,
        });
      }
    } else if (d.kind === "greenhouse") {
      const id = `S${ghCounter++}`;
      newPlots.push({
        id,
        name: `Serre ${id} (Scan Vidéo)`,
        zone: "Serre",
        x: d.worldX,
        z: d.worldZ,
        w: Math.max(7.5, d.worldW),
        d: 4.0,
        rot: 0,
        areaM2: 450,
        soilType: "Amendé compost",
        ph: 6.6,
        omPct: 5.8,
        cropId: ghCounter % 2 === 0 ? "tomate" : "fraise",
        plantedDayOffset: -40,
        gddAccumulated: 780,
        stage: "Floraison / Récolte",
        moisturePct: 58,
        healthPct: 92,
        diseaseRisk: 22,
        irrigationValveOpen: false,
        ventOpeningPct: 35,
        indoorTempC: 24.2,
        indoorRhPct: 70,
        history: [{ season: "N-1", cropId: "laitue" }],
      });
    } else if (d.kind === "bed_open") {
      const id = `P${plotCounter}`;
      const cropId = cropCycle[(plotCounter - 1) % cropCycle.length];
      plotCounter++;
      newPlots.push({
        id,
        name: `Planche ${id} (Scan Vidéo)`,
        zone: "Plein champ",
        x: d.worldX,
        z: d.worldZ,
        w: Math.max(6.5, d.worldW),
        d: 2.2,
        rot: 0,
        areaM2: 160,
        soilType: "Limono-argileux",
        ph: 6.7,
        omPct: 4.3,
        cropId,
        plantedDayOffset: -35,
        gddAccumulated: 620,
        stage: "Croissance",
        moisturePct: 54,
        healthPct: 91,
        diseaseRisk: 14,
        irrigationValveOpen: false,
        history: [{ season: "N-1", cropId: "engrais_vert" }],
      });
    } else if (d.kind === "hedge_row") {
      newStructures.push({
        id: `SCAN-HDG-${newStructures.length}`,
        type: "hedge_row",
        label: "Haie Bocagère (Scan)",
        x: d.worldX,
        z: d.worldZ,
        w: Math.max(3.5, d.worldW),
        d: 1.5,
        h: 2.8,
        rot: 0,
      });
    } else if (d.kind === "path_dirt") {
      newStructures.push({
        id: `SCAN-PTH-${newStructures.length}`,
        type: "path_dirt",
        label: "Chemin / Cour (Scan)",
        x: d.worldX,
        z: d.worldZ,
        w: Math.max(4, d.worldW),
        d: 2.2,
        h: 0.08,
        rot: 0,
      });
    } else if (d.kind === "river_seg") {
      newStructures.push({
        id: `SCAN-RIV-${newStructures.length}`,
        type: "river_seg",
        label: "Rivière / Cours d'eau (Scan)",
        x: d.worldX,
        z: d.worldZ,
        w: Math.max(6, d.worldW),
        d: 3.2,
        h: 0.14,
        rot: 0,
      });
    } else if (d.kind === "paddock") {
      newStructures.push({
        id: `SCAN-PAD-${newStructures.length}`,
        type: "paddock",
        label: "Paddock Élevage (Scan)",
        x: d.worldX,
        z: d.worldZ,
        w: Math.max(7.5, d.worldW),
        d: 5.0,
        h: 0.25,
        rot: 0,
      });
    }
  }

  // Garantit au moins un poulailler et une centrale solaire pour la coherence
  newStructures.push(
    { id: "SCAN-COOP", type: "coop_mobile", label: "Poulailler Plein Air", x: 1.5, z: 7.5, w: 3.8, d: 2.6, h: 2.1, rot: 0, doorOpen: true },
    { id: "SCAN-SOL", type: "solar_array", label: "Solaire PV", x: 13, z: -6, w: 5.5, d: 3.2, h: 2.0, rot: 0, kwPeak: 18 }
  );

  if (newPlots.length > 0) state.plots = newPlots;
  if (newStructures.length > 2) state.structures = newStructures;

  // Reaffecte les robots autonomes dont la parcelle cible a ete remplacee
  const plotIds = new Set((state.plots || []).map((p) => p.id));
  for (const eq of state.equipment || []) {
    if (!eq.autonomous) continue;
    if (eq.targetPlotId && !plotIds.has(eq.targetPlotId)) {
      const nextPlot = state.plots[0];
      if (nextPlot) {
        eq.targetPlotId = nextPlot.id;
        eq.targetX = nextPlot.x;
        eq.targetZ = nextPlot.z;
        eq.task = `${eq.kind === "drone" ? "Scan NDVI" : "Intervention"} sur ${nextPlot.name}`;
      } else {
        eq.status = "idle";
        eq.targetPlotId = null;
        eq.task = "En attente de mission";
      }
    }
  }
}
