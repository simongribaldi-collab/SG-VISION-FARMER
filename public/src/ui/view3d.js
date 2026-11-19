import { ANIMAL_SPECIES, BUILDING_CATALOG, CROP_CATALOG, generateTerrainHeights, TERRAIN_PRESETS } from "../data/presets.js";
import { dispatchRobot, setGreenhouseVent, toggleCoopDoor, toggleIrrigation } from "../engine/automation.js";
import { getTerrainHeight } from "../engine/engine3d.js";
import { evaluateRotation, getCropById } from "../engine/predictor.js";
import {
  analyzeFrameToFarmLayout,
  applyScanToFarmState,
  DEMO_SCANS,
  drawDemoVideoScanFrame,
  fetchRealTopography,
} from "../engine/scanner3d.js";
import { esc, pill, progressBar } from "./components.js";

const OVERLAYS = [
  { id: "normal", label: "🌿 Réel HD" },
  { id: "moisture", label: "💧 Humidité" },
  { id: "health", label: "🛰️ Santé NDVI" },
  { id: "disease", label: "🦠 Risque Maladie" },
  { id: "energy", label: "⚡ Flux Énergie/Eau" },
  { id: "ar", label: "🥽 Balises AR" },
];

const BUILD_CATEGORIES = [
  { id: "all", label: `Tout (${BUILDING_CATALOG.length})` },
  { id: "corps_ferme", label: "🏰 Corps de Ferme" },
  { id: "paysage", label: "🏞️ Haies, Chemins & Rivière" },
  { id: "culture", label: "🌱 Cultures & Serres" },
  { id: "elevage", label: "🐄 Élevage & Ponte" },
  { id: "energie", label: "⚡ Eau, Énergie & Tech" },
];

export function filterBuildingCatalog(buildCat = "all") {
  return BUILDING_CATALOG.filter((b) => {
    if (buildCat === "all") return true;
    if (buildCat === "elevage") return b.category === "elevage" || b.category === "ponte";
    if (buildCat === "energie") return ["ressource", "energie", "capteur", "infra", "agro"].includes(b.category);
    return b.category === buildCat;
  });
}

const SCULPT_TOOLS = [
  { id: "raise", label: "🔼 Élever colline" },
  { id: "lower", label: "🔽 Creuser vallon / lit" },
  { id: "flatten", label: "➖ Aplanir terrasse" },
  { id: "smooth", label: "〰️ Lisser pente" },
];

let activeVideoStream = null;
let scanAnimTimer = null;

function stopActiveVideoStream() {
  if (scanAnimTimer) {
    clearInterval(scanAnimTimer);
    scanAnimTimer = null;
  }
  if (activeVideoStream) {
    activeVideoStream.getTracks().forEach((t) => t.stop());
    activeVideoStream = null;
  }
}

export function renderView3D(container, ctx) {
  const { state, forecast, uiState, engine3d } = ctx;
  const sel = uiState.selectedObject;
  const buildCat = uiState.buildCategory || "all";

  const filteredCatalog = filterBuildingCatalog(buildCat);

  container.innerHTML = `
    <div class="grid-cockpit">
      <div>
        <div class="viewport-wrap ${uiState.buildActive || uiState.sculptActive ? "build-mode" : ""}" id="viewport-wrap">
          <canvas id="farm-canvas"></canvas>
          <div class="ar-overlay-layer" id="ar-overlay-layer"></div>

          <div class="viewport-hud-top">
            <div class="hud-chip-bar">
              ${OVERLAYS.map((o) => `
                <button class="btn btn-sm ${uiState.overlay === o.id ? "active" : ""}" data-overlay="${o.id}">${o.label}</button>
              `).join("")}
            </div>
            <div class="hud-chip-bar">
              <button class="btn btn-sm" data-cam="iso">📐 Iso</button>
              <button class="btn btn-sm" data-cam="farmhouse">🏡 Ferme</button>
              <button class="btn btn-sm" data-cam="top">🗺️ Plan</button>
              <button class="btn btn-sm" data-cam="ar">🥽 Vue AR</button>
              <button class="btn btn-sm ${uiState.shadowsEnabled !== false ? "active" : ""}" id="btn-toggle-shadows">☀️ Ombres HD</button>
              <button class="btn btn-sm ${uiState.showArPins ? "active" : ""}" id="btn-toggle-pins">🏷️ Étiquettes</button>
              <button class="btn btn-sm ${uiState.scannerOpen ? "btn-amber" : "btn-primary"}" id="btn-open-scanner">🎥 Filmer / Scanner la Ferme</button>
            </div>
          </div>

          <div class="viewport-hud-bottom">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:260px;">
              <button class="btn btn-primary btn-sm" id="btn-timelapse">${state.simulation.playingTimelapse ? "⏸ Pause" : "▶ Time-Lapse"}</button>
              <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:2px;">
                  <span>🔮 <strong>Prévoir l'avenir</strong> : <span id="lbl-day-offset">${state.simulation.dayOffset === 0 ? "Aujourd'hui (Direct)" : `J+${state.simulation.dayOffset}`}</span></span>
                  <span class="muted" id="lbl-day-date">${esc(forecast.daily[Math.min(state.simulation.dayOffset, forecast.daily.length - 1)]?.date || "")}</span>
                </div>
                <input type="range" id="slider-day" min="0" max="90" value="${state.simulation.dayOffset}" style="width:100%;accent-color:#22c55e;"/>
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:8px;min-width:190px;">
              <span style="font-size:12px;">☀️ <strong id="lbl-hour">${formatHour(state.simulation.hourOfDay)}</strong></span>
              <input type="range" id="slider-hour" min="5" max="22" step="0.5" value="${state.simulation.hourOfDay}" style="width:120px;accent-color:#f59e0b;"/>
            </div>
          </div>
        </div>

        ${uiState.scannerOpen ? renderVideoScannerCard(uiState) : ""}

        <!-- Outil Dénivelé & Topographie Réelle -->
        <div class="card" style="margin-top:12px;">
          <div class="card-header" style="margin-bottom:8px;">
            <h3 class="card-title">⛰️ Dénivelé, Relief 3D & Topographie Réelle</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-sm ${uiState.sculptActive ? "btn-amber" : "btn-primary"}" id="btn-sculpt-mode">
                ${uiState.sculptActive ? "✋ Quitter Sculpture Relief" : "⛰️ Sculpter le Dénivelé à la souris"}
              </button>
              <button class="btn btn-sm" id="btn-gps-topo" title="Récupère les altitudes NGF réelles autour des coordonnées GPS de la ferme">
                🛰️ Relief GPS Réel (${state.farm.location.name})
              </button>
            </div>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span class="muted">Pinceau :</span>
              ${SCULPT_TOOLS.map((t) => `
                <button class="btn btn-sm ${uiState.sculptTool === t.id ? "active" : ""}" data-sculpt-tool="${t.id}">${t.label}</button>
              `).join("")}
              <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin-left:6px;">
                Rayon <strong id="lbl-sculpt-rad">${uiState.sculptRadius || 5}m</strong>
                <input type="range" id="slider-sculpt-rad" min="2" max="11" step="0.5" value="${uiState.sculptRadius || 5}" style="width:80px;accent-color:#22c55e;" />
              </label>
            </div>

            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span class="muted">Modèles de relief :</span>
              ${TERRAIN_PRESETS.map((tp) => `
                <button class="btn btn-sm ${state.terrain?.presetId === tp.id ? "active" : ""}" data-terrain-preset="${tp.id}">${esc(tp.label)}</button>
              `).join("")}
            </div>
          </div>
        </div>

        <!-- Aménagement 3D de la ferme -->
        <div class="card" style="margin-top:12px;">
          <div class="card-header" style="margin-bottom:8px;">
            <h3 class="card-title">🏗️ Créer & Aménager la Ferme 3D (Corps de ferme, Haies, Chemins, Rivière, Cultures)</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-sm ${uiState.buildActive ? "btn-amber" : "btn-primary"}" id="btn-build-mode">
                ${uiState.buildActive ? "✋ Quitter Mode Construction" : "➕ Placer sur le terrain 3D"}
              </button>
              <button class="btn btn-sm" id="btn-build-rot">↻ Pivoter (${Math.round((uiState.buildRot * 180) / Math.PI)}°)</button>
            </div>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px;">
            ${BUILD_CATEGORIES.map((c) => `
              <button class="btn btn-sm ${buildCat === c.id ? "active" : ""}" data-build-cat="${c.id}">${c.label}</button>
            `).join("")}
          </div>

          <div class="build-dock">
            ${filteredCatalog.map((b) => `
              <button class="build-item ${uiState.buildActive && uiState.buildType === b.type ? "active" : ""}" data-build-type="${b.type}">
                <span style="font-size:20px;">${b.icon}</span>
                <span style="font-weight:600;text-align:center;">${esc(b.label)}</span>
                <span class="muted">${b.cost} € · ${b.w}×${b.d}m</span>
              </button>
            `).join("")}
          </div>
          <div class="muted" style="margin-top:6px;">
            Astuce 3D : Clic gauche glissé = orbite (ou sculpter si le pinceau Dénivelé est actif) · Clic droit ou Shift+glissé = déplacer la vue · Molette = zoom · Cliquez un bâtiment, animal, rivière ou planche pour l'inspecter.
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="card" id="inspector-card">
          ${renderInspector(sel, state, forecast)}
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">🐄 Aperçu Cheptel 3D sur Parcours</h3>
            ${pill(`${state.livestock.reduce((a, l) => a + l.count, 0)} têtes`, "ok")}
          </div>
          <div class="muted" style="margin-bottom:8px;">
            Les animaux sont modélisés par espèce (vaches laitières, bovins viande, brebis, chèvres, cochons, poules, canards, chevaux) autour des poulaillers et paddocks.
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${state.livestock.map((l) => pill(`${l.name} (${l.count})`, "info")).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">⚡ Action rapide Robots & Capteurs</h3>
            ${pill(`${state.equipment.filter((e) => e.autonomous && e.status === "working").length} actifs`, "ok")}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${state.equipment.filter((e) => e.autonomous).map((bot) => `
              <div style="padding:8px;border-radius:10px;background:var(--bg-soft);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                  <strong>${bot.kind === "drone" ? "🚁" : bot.kind === "tractor" ? "🚜" : "🤖"} ${esc(bot.name)}</strong>
                  ${pill(`${Math.round(bot.batteryPct)}%`, bot.batteryPct > 35 ? "ok" : "warn")}
                </div>
                <div class="muted" style="margin:3px 0 6px;">${esc(bot.task)}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <select class="input" style="flex:1;min-width:120px;padding:4px 6px;font-size:12px;" data-bot-select="${bot.id}">
                    ${state.plots.map((p) => `<option value="${p.id}" ${bot.targetPlotId === p.id ? "selected" : ""}>${esc(p.id)} · ${esc(getCropById(p.cropId).name)}</option>`).join("")}
                  </select>
                  <button class="btn btn-primary btn-sm" data-bot-go="${bot.id}">Envoyer</button>
                  <button class="btn btn-sm" data-bot-home="${bot.id}">Base</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `;

  // Liaison Canvas 3D
  const canvas = container.querySelector("#farm-canvas");
  ctx.mountCanvas(canvas, (picked) => {
    uiState.selectedObject = picked;
    const insp = container.querySelector("#inspector-card");
    if (insp) insp.innerHTML = renderInspector(picked, state, forecast);
    bindInspectorEvents(insp, ctx);
  });

  if (ctx.engine3d) {
    ctx.engine3d.overlay = uiState.overlay;
    ctx.engine3d.shadowsEnabled = uiState.shadowsEnabled !== false;
    ctx.engine3d.buildMode.active = Boolean(uiState.buildActive && !uiState.sculptActive);
    ctx.engine3d.buildMode.type = uiState.buildType;
    ctx.engine3d.buildMode.rot = uiState.buildRot;
    ctx.engine3d.sculptMode.active = Boolean(uiState.sculptActive);
    ctx.engine3d.sculptMode.tool = uiState.sculptTool || "raise";
    ctx.engine3d.sculptMode.radius = uiState.sculptRadius || 5;
  }

  // Overlays & Camera
  container.querySelectorAll("[data-overlay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      uiState.overlay = btn.dataset.overlay;
      if (uiState.overlay === "ar") uiState.showArPins = true;
      if (ctx.engine3d) ctx.engine3d.overlay = uiState.overlay;
      ctx.rerender();
    });
  });

  container.querySelectorAll("[data-cam]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (ctx.engine3d) ctx.engine3d.setCameraPreset(btn.dataset.cam);
    });
  });

  container.querySelector("#btn-toggle-shadows")?.addEventListener("click", () => {
    uiState.shadowsEnabled = uiState.shadowsEnabled === false;
    if (ctx.engine3d) ctx.engine3d.shadowsEnabled = uiState.shadowsEnabled;
    ctx.rerender();
  });

  container.querySelector("#btn-toggle-pins").addEventListener("click", () => {
    uiState.showArPins = !uiState.showArPins;
    ctx.rerender();
  });

  container.querySelector("#btn-open-scanner").addEventListener("click", () => {
    uiState.scannerOpen = !uiState.scannerOpen;
    if (!uiState.scannerOpen) stopActiveVideoStream();
    ctx.rerender();
  });

  // Time-Machine & Soleil
  const daySlider = container.querySelector("#slider-day");
  daySlider.addEventListener("input", () => {
    state.simulation.dayOffset = Number(daySlider.value);
    if (state.simulation.dayOffset >= 30) state.farm.gamification.simulatedFutureUsed = true;
    const lbl = container.querySelector("#lbl-day-offset");
    if (lbl) lbl.textContent = state.simulation.dayOffset === 0 ? "Aujourd'hui (Direct)" : `J+${state.simulation.dayOffset}`;
    ctx.refreshForecastOnly();
    ctx.updateStatusRibbon?.();
    const dateLbl = container.querySelector("#lbl-day-date");
    if (dateLbl && ctx.forecast?.daily) {
      const dSnap = ctx.forecast.daily[Math.min(state.simulation.dayOffset, ctx.forecast.daily.length - 1)];
      if (dSnap) dateLbl.textContent = dSnap.date;
    }
  });
  daySlider.addEventListener("change", () => ctx.save());

  const hourSlider = container.querySelector("#slider-hour");
  hourSlider.addEventListener("input", () => {
    state.simulation.hourOfDay = Number(hourSlider.value);
    const lbl = container.querySelector("#lbl-hour");
    if (lbl) lbl.textContent = formatHour(state.simulation.hourOfDay);
  });
  hourSlider.addEventListener("change", () => ctx.save());

  container.querySelector("#btn-timelapse").addEventListener("click", () => {
    state.simulation.playingTimelapse = !state.simulation.playingTimelapse;
    ctx.rerender();
  });

  // Sculpture Dénivelé & Relief
  container.querySelector("#btn-sculpt-mode").addEventListener("click", () => {
    uiState.sculptActive = !uiState.sculptActive;
    if (uiState.sculptActive) uiState.buildActive = false;
    ctx.rerender();
  });

  container.querySelectorAll("[data-sculpt-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      uiState.sculptTool = btn.dataset.sculptTool;
      uiState.sculptActive = true;
      uiState.buildActive = false;
      ctx.rerender();
    });
  });

  const radSlider = container.querySelector("#slider-sculpt-rad");
  radSlider.addEventListener("input", () => {
    uiState.sculptRadius = Number(radSlider.value);
    const lbl = container.querySelector("#lbl-sculpt-rad");
    if (lbl) lbl.textContent = `${uiState.sculptRadius}m`;
    if (ctx.engine3d) ctx.engine3d.sculptMode.radius = uiState.sculptRadius;
  });

  container.querySelectorAll("[data-terrain-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetId = btn.dataset.terrainPreset;
      state.terrain = generateTerrainHeights(presetId, 32);
      state.terrain._dirty = true;
      state.terrain._version = Date.now();
      ctx.toast(`Relief 3D appliqué : ${presetId}`);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#btn-gps-topo").addEventListener("click", async () => {
    const { lat, lon, name } = state.farm.location;
    ctx.toast(`🛰️ Récupération du relief NGF réel autour de ${name} (${lat.toFixed(3)}, ${lon.toFixed(3)})...`);
    const res = await fetchRealTopography(lat, lon, 32);
    state.terrain = res.terrain;
    state.terrain._dirty = true;
    state.terrain._version = Date.now();
    ctx.toast(
      `⛰️ Relief appliqué : altitude ${res.minElevationM}m → ${res.maxElevationM}m (Δ ${res.deltaM}m)${res.ok ? " [Open-Meteo DEM]" : " [Modèle Coteau local]"}`
    );
    ctx.save();
    ctx.rerender();
  });

  // Construction 3D
  container.querySelector("#btn-build-mode").addEventListener("click", () => {
    uiState.buildActive = !uiState.buildActive;
    if (uiState.buildActive) uiState.sculptActive = false;
    ctx.rerender();
  });
  container.querySelector("#btn-build-rot").addEventListener("click", () => {
    uiState.buildRot = (uiState.buildRot + Math.PI / 2) % (Math.PI * 2);
    ctx.rerender();
  });
  container.querySelectorAll("[data-build-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      uiState.buildCategory = btn.dataset.buildCat;
      ctx.rerender();
    });
  });
  container.querySelectorAll("[data-build-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      uiState.buildType = btn.dataset.buildType;
      uiState.buildActive = true;
      uiState.sculptActive = false;
      ctx.rerender();
    });
  });

  // Robots dispatch
  container.querySelectorAll("[data-bot-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const botId = btn.dataset.botGo;
      const selEl = container.querySelector(`[data-bot-select="${botId}"]`);
      const res = dispatchRobot(state, botId, selEl?.value);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });
  container.querySelectorAll("[data-bot-home]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = dispatchRobot(state, btn.dataset.botHome, null);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  if (uiState.scannerOpen) {
    bindVideoScannerEvents(container, ctx);
  }

  bindInspectorEvents(container.querySelector("#inspector-card"), ctx);
}

function renderVideoScannerCard(uiState) {
  const scanRes = uiState.lastScanResult;
  return `
    <div class="card" style="margin-top:12px;border-color:rgba(56,189,248,0.55);background:linear-gradient(155deg, rgba(16,32,46,0.96), rgba(11,21,30,0.96));">
      <div class="card-header">
        <h3 class="card-title">🎥 Studio Reconstruction 3D : Filmer / Scanner la Ferme → Jumeau Numérique</h3>
        <button class="btn btn-sm" id="btn-close-scanner">✕ Fermer</button>
      </div>
      <div class="muted" style="margin-bottom:10px;">
        Filmez votre exploitation en direct (caméra/drone), importez une vidéo ou photo aérienne, ou testez un survol démo : l'algorithme segmente automatiquement <strong>les corps de ferme (toitures tuiles/pierre), serres, planches de culture, haies bocagères, chemins, rivières et dénivelé</strong>.
      </div>

      <div class="grid-2" style="gap:14px;align-items:start;">
        <div>
          <div style="position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--border-strong);background:#050a0f;">
            <video id="scan-video-el" autoplay playsinline muted style="display:none;"></video>
            <canvas id="scan-preview-canvas" width="520" height="280" style="width:100%;height:auto;display:block;"></canvas>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-primary btn-sm" id="btn-scan-webcam">📷 Filmer via Caméra</button>
            <label class="btn btn-sm" style="cursor:pointer;">
              📁 Importer Vidéo / Photo Drone
              <input type="file" id="inp-scan-file" accept="video/*,image/*" style="display:none;" />
            </label>
            <select class="input" id="sel-demo-scan" style="flex:1;min-width:180px;padding:4px 8px;font-size:12px;">
              ${DEMO_SCANS.map((d) => `<option value="${d.id}" ${uiState.demoScanId === d.id ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
            </select>
            <button class="btn btn-sm" id="btn-run-demo-scan">🚁 Simuler Film</button>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="padding:12px;border-radius:11px;background:var(--bg-soft);border:1px solid var(--border);">
            <div style="font-weight:700;margin-bottom:8px;">🧠 Éléments détectés par Vision IA sur le flux :</div>
            <div id="scan-summary-box">
              ${renderScanSummaryInner(scanRes)}
            </div>
          </div>

          <button class="btn btn-primary" id="btn-apply-scan" style="padding:11px;font-size:13.5px;">
            ✨ Générer la Ferme 3D Réelle depuis ce Film / Scan
          </button>
          <div class="muted">
            Le relief (vallée, coteau ou bocage), les bâtiments en pierre, les haies, les chemins, la rivière et les cultures détectés remplaceront l'aménagement actuel dans le jumeau 3D.
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderScanSummaryInner(scanRes) {
  if (!scanRes) {
    return `<div class="muted">Analyse en cours...</div>`;
  }
  const c = scanRes.counts;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
      ${pill(`🏰 ${c.buildings} Corps de ferme / Granges`, c.buildings > 0 ? "warn" : "info")}
      ${pill(`⛺ ${c.greenhouses} Serres`, c.greenhouses > 0 ? "info" : "ok")}
      ${pill(`🥬 ${c.plots} Planches de culture`, c.plots > 0 ? "ok" : "info")}
      ${pill(`🌳 ${c.hedges} Haies bocagères`, c.hedges > 0 ? "ok" : "info")}
      ${pill(`🛤️ ${c.paths} Chemins & Cours`, "info")}
      ${pill(`🏞️ ${c.rivers} Tronçons Rivière`, c.rivers > 0 ? "info" : "ok")}
      ${pill(`🐄 ${c.paddocks} Paddocks`, "ok")}
    </div>
    <div class="muted">
      Profil topographique déduit : <strong>${esc(scanRes.terrainPreset)}</strong> (${scanRes.detections.length} zones vectorisées en 3D).
    </div>
  `;
}

function bindVideoScannerEvents(container, ctx) {
  const { state, uiState } = ctx;
  const previewCanvas = container.querySelector("#scan-preview-canvas");
  const videoEl = container.querySelector("#scan-video-el");
  const summaryBox = container.querySelector("#scan-summary-box");
  if (!previewCanvas) return;

  const pCtx = previewCanvas.getContext("2d");

  const runDemoFrame = () => {
    const presetId = uiState.demoScanId || "coteau_ferme";
    drawDemoVideoScanFrame(pCtx, previewCanvas.width, previewCanvas.height, presetId, performance.now() / 1000);
    const res = analyzeFrameToFarmLayout(previewCanvas);
    uiState.lastScanResult = res;
    if (summaryBox) summaryBox.innerHTML = renderScanSummaryInner(res);
  };

  // Initialisation immediate avec le film demo
  stopActiveVideoStream();
  runDemoFrame();
  scanAnimTimer = setInterval(() => {
    if (!document.body.contains(previewCanvas)) {
      stopActiveVideoStream();
      return;
    }
    if (activeVideoStream && videoEl && videoEl.readyState >= 2) {
      pCtx.drawImage(videoEl, 0, 0, previewCanvas.width, previewCanvas.height);
      const res = analyzeFrameToFarmLayout(previewCanvas);
      uiState.lastScanResult = res;
      if (summaryBox) summaryBox.innerHTML = renderScanSummaryInner(res);
    } else if (!uiState.customScanImageLoaded) {
      runDemoFrame();
    }
  }, 350);

  container.querySelector("#btn-close-scanner")?.addEventListener("click", () => {
    stopActiveVideoStream();
    uiState.scannerOpen = false;
    ctx.rerender();
  });

  container.querySelector("#sel-demo-scan")?.addEventListener("change", (e) => {
    uiState.demoScanId = e.target.value;
    uiState.customScanImageLoaded = false;
    stopActiveVideoStream();
    runDemoFrame();
  });

  container.querySelector("#btn-run-demo-scan")?.addEventListener("click", () => {
    uiState.customScanImageLoaded = false;
    stopActiveVideoStream();
    runDemoFrame();
    ctx.toast("🚁 Simulation vidéo drone en cours d'analyse...");
  });

  container.querySelector("#btn-scan-webcam")?.addEventListener("click", async () => {
    try {
      stopActiveVideoStream();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      activeVideoStream = stream;
      videoEl.srcObject = stream;
      await videoEl.play();
      uiState.customScanImageLoaded = false;
      ctx.toast("📷 Caméra active : filmez votre ferme ou une maquette !");
    } catch {
      ctx.toast("Caméra non détectée — bascule sur le flux vidéo drone simulé.");
      runDemoFrame();
    }
  });

  container.querySelector("#inp-scan-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopActiveVideoStream();
    uiState.customScanImageLoaded = true;
    const url = URL.createObjectURL(file);

    if (file.type.startsWith("video/")) {
      videoEl.srcObject = null;
      videoEl.src = url;
      videoEl.loop = true;
      videoEl.play().then(() => {
        scanAnimTimer = setInterval(() => {
          if (!document.body.contains(previewCanvas)) {
            stopActiveVideoStream();
            return;
          }
          pCtx.drawImage(videoEl, 0, 0, previewCanvas.width, previewCanvas.height);
          const res = analyzeFrameToFarmLayout(previewCanvas);
          uiState.lastScanResult = res;
          if (summaryBox) summaryBox.innerHTML = renderScanSummaryInner(res);
        }, 300);
      });
      ctx.toast(`📹 Vidéo "${file.name}" chargée et analysée en temps réel.`);
    } else {
      const img = new Image();
      img.onload = () => {
        pCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
        const res = analyzeFrameToFarmLayout(previewCanvas);
        uiState.lastScanResult = res;
        if (summaryBox) summaryBox.innerHTML = renderScanSummaryInner(res);
        ctx.toast(`🖼️ Image "${file.name}" segmentée (${res.detections.length} zones).`);
      };
      img.src = url;
    }
  });

  container.querySelector("#btn-apply-scan")?.addEventListener("click", () => {
    if (!uiState.lastScanResult) runDemoFrame();
    applyScanToFarmState(state, uiState.lastScanResult);
    stopActiveVideoStream();
    uiState.scannerOpen = false;
    ctx.toast("✨ Jumeau 3D reconstruit avec succès depuis le scan vidéo !");
    ctx.save();
    ctx.rerender();
  });
}

function formatHour(h) {
  const hr = Math.floor(h);
  const mn = Math.round((h - hr) * 60);
  return `${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
}

function renderInspector(sel, state, forecast) {
  if (!sel) {
    const daySnap = forecast.daily[Math.min(state.simulation.dayOffset, forecast.daily.length - 1)] || forecast.daily[0];
    return `
      <div class="card-header">
        <h3 class="card-title">🔍 Inspecteur 3D</h3>
        ${pill(`J+${state.simulation.dayOffset}`, "info")}
      </div>
      <div class="muted" style="margin-bottom:10px;">
        Cliquez sur un <strong>corps de ferme, planche de culture, serre, haie, rivière, poulailler ou robot</strong> dans la scène 3D pour l'inspecter et le piloter.
      </div>
      <div class="grid-2" style="gap:8px;">
        <div class="kpi-card">
          <div class="kpi-label">Énergie nette (J+${state.simulation.dayOffset})</div>
          <div class="kpi-value" style="font-size:17px;color:${daySnap.netEnergyKwh >= 0 ? "#4ade80" : "#fbbf24"};">${daySnap.netEnergyKwh >= 0 ? "+" : ""}${daySnap.netEnergyKwh} kWh</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Réserve Eau</div>
          <div class="kpi-value" style="font-size:17px;">${daySnap.waterStockM3} m³</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Récolte du jour</div>
          <div class="kpi-value" style="font-size:17px;">${daySnap.harvestKg} kg</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Œufs prévus</div>
          <div class="kpi-value" style="font-size:17px;">${daySnap.eggsCount}</div>
        </div>
      </div>
    `;
  }

  if (sel.kind === "plot") {
    const p = state.plots.find((x) => x.id === sel.id) || sel.data;
    const snap = forecast.plotSnapshots.find((s) => s.id === p.id);
    const crop = getCropById(p.cropId);
    const rotEval = evaluateRotation(p, p.cropId, { includeCurrent: false });
    const isGh = p.zone === "Serre";
    const elevM = getTerrainHeight(state, p.x, p.z).toFixed(1);

    return `
      <div class="card-header">
        <h3 class="card-title">${crop.icon} ${esc(p.name)}</h3>
        ${pill(`${p.zone} · Alt ${elevM}m`, isGh ? "info" : "ok")}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span><strong>Culture 3D :</strong></span>
          <select class="input" id="insp-crop-select" data-plot-id="${p.id}" style="width:185px;padding:4px 8px;font-size:12px;">
            ${CROP_CATALOG.map((c) => `<option value="${c.id}" ${c.id === p.cropId ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}
          </select>
        </div>
        <div><strong>Stade (J+${state.simulation.dayOffset}) :</strong> ${esc(snap?.stage || p.stage)} (${snap?.progressPct ?? 50}%)</div>
        ${progressBar(snap?.progressPct ?? 50, "#22c55e")}
        <div class="grid-2" style="gap:8px;margin-top:4px;">
          <div>💧 Humidité sol : <strong>${snap?.moisturePct ?? p.moisturePct}%</strong></div>
          <div>🦠 Risque maladie : <strong>${snap?.diseaseRisk ?? p.diseaseRisk}%</strong></div>
          <div>💚 Santé : <strong>${snap?.healthPct ?? p.healthPct}%</strong></div>
          <div>🔄 Rotation : <strong>${rotEval.score}/100</strong></div>
        </div>
        ${isGh ? `<div>🌡️ Climat serre : <strong>${p.indoorTempC ?? 24}°C</strong> · HR <strong>${p.indoorRhPct ?? 72}%</strong> · Ouvrants <strong>${p.ventOpeningPct ?? 30}%</strong></div>` : ""}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
          <button class="btn btn-primary btn-sm" data-insp-irrig="${p.id}">💧 ${p.irrigationValveOpen ? "Fermer vanne" : "Ouvrir vanne"}</button>
          ${isGh ? `<button class="btn btn-sm" data-insp-vent="${p.id}">🪟 Aérer 80%</button>` : ""}
          <button class="btn btn-danger btn-sm" data-insp-del-plot="${p.id}">🗑️ Supprimer</button>
        </div>
      </div>
    `;
  }

  if (sel.kind === "structure") {
    const s = state.structures.find((x) => x.id === sel.id) || sel.data;
    const isCoop = s.type === "coop_mobile" || s.type === "coop_fixed";
    const elevM = getTerrainHeight(state, s.x, s.z).toFixed(1);
    return `
      <div class="card-header">
        <h3 class="card-title">🏗️ ${esc(s.label)}</h3>
        ${pill(`${s.type} · Alt ${elevM}m`, "info")}
      </div>
      <div class="muted" style="margin-bottom:8px;">Position 3D : X=${s.x}m, Z=${s.z}m · Emprise ${s.w}×${s.d} m</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${isCoop ? `<button class="btn btn-primary btn-sm" data-insp-coop="${s.id}">🚪 ${s.doorOpen ? "Fermer trappe" : "Ouvrir trappe"}</button>` : ""}
        <button class="btn btn-sm" data-insp-rot-struct="${s.id}">↻ Pivoter 90°</button>
        <button class="btn btn-danger btn-sm" data-insp-del-struct="${s.id}">🗑️ Démolir</button>
      </div>
    `;
  }

  if (sel.kind === "livestock") {
    const l = state.livestock.find((x) => x.id === sel.id) || sel.data;
    const sp = ANIMAL_SPECIES.find((s) => s.id === l.speciesId) || ANIMAL_SPECIES[0];
    const isPonte = l.kind === "ponte";
    return `
      <div class="card-header">
        <h3 class="card-title">${sp.icon} ${esc(l.name)}</h3>
        ${pill(`${l.count} ${isPonte ? "sujets" : "têtes"}`, "ok")}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div class="muted">Espèce : <strong>${esc(sp.label)}</strong> · Parcours : <strong>${esc(l.paddockName)}</strong></div>
        ${isPonte ? `<div>🥚 Ponte du jour : <strong>${l.eggsToday || Math.round((l.count * l.layingRatePct) / 100)} œufs</strong> (${l.layingRatePct}%) · Trappe : <strong>${l.doorOpen ? "Ouverte" : "Fermée"}</strong></div>` : `<div>💧 Eau : <strong>${Math.round(l.count * (l.waterLitersPerDay || sp.defaultWaterL))} L/j</strong> · Ration : <strong>${Math.round((l.count * (l.feedGramsPerDay || sp.defaultFeedG)) / 1000)} kg/j</strong></div>`}
        <div>💚 Bien-être : <strong>${l.welfarePct}%</strong></div>
        ${progressBar(l.welfarePct, "#22c55e")}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
          ${isPonte ? `<button class="btn btn-primary btn-sm" data-insp-lot-door="${l.id}">🚪 ${l.doorOpen ? "Fermer trappe" : "Ouvrir trappe"}</button>` : `<button class="btn btn-primary btn-sm" data-insp-lot-pad="${l.id}">🔄 Changer Paddock</button>`}
        </div>
      </div>
    `;
  }

  if (sel.kind === "robot") {
    const b = state.equipment.find((x) => x.id === sel.id) || sel.data;
    return `
      <div class="card-header">
        <h3 class="card-title">🤖 ${esc(b.name)}</h3>
        ${pill(b.status, b.status === "working" ? "ok" : "info")}
      </div>
      <div>Batterie : <strong>${Math.round(b.batteryPct)}%</strong> · Heures : <strong>${b.hoursTotal} h</strong></div>
      <div class="muted" style="margin:6px 0;">Mission : ${esc(b.task)}</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm" data-bot-home-insp="${b.id}">🏠 Rappeler base</button>
      </div>
    `;
  }
  return "";
}

function bindInspectorEvents(insp, ctx) {
  if (!insp) return;
  const { state, uiState } = ctx;

  const cropSel = insp.querySelector("#insp-crop-select");
  if (cropSel) {
    cropSel.addEventListener("change", () => {
      const p = state.plots.find((x) => x.id === cropSel.dataset.plotId);
      if (p) {
        const oldCrop = getCropById(p.cropId);
        const oldRatio = oldCrop?.gddTarget ? (p.gddAccumulated || 0) / oldCrop.gddTarget : 0.55;
        const prevN1 = (p.history || []).find((h) => h.season === "N-1");
        p.history = [
          ...(prevN1 ? [{ season: "N-2", cropId: prevN1.cropId }] : []),
          { season: "N-1", cropId: p.cropId },
        ];
        p.cropId = cropSel.value;
        const c = getCropById(p.cropId);
        p.gddAccumulated = Math.round(c.gddTarget * Math.max(0.55, Math.min(0.95, oldRatio)));
        ctx.toast(`Culture 3D changée en ${c.icon} ${c.name} sur ${p.id}`);
        ctx.save();
        ctx.rerender();
      }
    });
  }

  insp.querySelectorAll("[data-insp-irrig]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = toggleIrrigation(state, btn.dataset.inspIrrig);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-vent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = setGreenhouseVent(state, btn.dataset.inspVent, 80);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-coop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = toggleCoopDoor(state, null, null, btn.dataset.inspCoop);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-lot-door]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = toggleCoopDoor(state, btn.dataset.inspLotDoor);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-lot-pad]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lot = state.livestock.find((x) => x.id === btn.dataset.inspLotPad);
      if (!lot) return;
      const paddocks = ["Paddock A (Nord)", "Paddock B (Sous-bois)", "Paddock C (Prairie Est)", "Paddock D (Luzerne)"];
      const idx = paddocks.indexOf(lot.paddockName);
      lot.paddockName = paddocks[(idx + 1) % paddocks.length];
      lot.welfarePct = Math.min(100, (lot.welfarePct || 90) + 2);
      ctx.toast(`Troupeau déplacé vers ${lot.paddockName}`);
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-rot-struct]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = state.structures.find((x) => x.id === btn.dataset.inspRotStruct);
      if (s) s.rot = ((s.rot || 0) + Math.PI / 2) % (Math.PI * 2);
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-del-struct]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.structures = state.structures.filter((x) => x.id !== btn.dataset.inspDelStruct);
      uiState.selectedObject = null;
      ctx.toast("Aménagement retiré de la scène 3D.");
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-insp-del-plot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const plotId = btn.dataset.inspDelPlot;
      state.plots = state.plots.filter((x) => x.id !== plotId);
      state.equipment.forEach((eq) => {
        if (eq.autonomous && eq.targetPlotId === plotId) {
          dispatchRobot(state, eq.id, null);
        }
      });
      uiState.selectedObject = null;
      ctx.toast("Planche supprimée.");
      ctx.save();
      ctx.rerender();
    });
  });

  insp.querySelectorAll("[data-bot-home-insp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = dispatchRobot(state, btn.dataset.botHomeInsp, null);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });
}
