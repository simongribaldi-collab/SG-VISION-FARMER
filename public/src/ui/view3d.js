import { BUILDING_CATALOG, CROP_CATALOG } from "../data/presets.js";
import { dispatchRobot, setGreenhouseVent, toggleCoopDoor, toggleIrrigation } from "../engine/automation.js";
import { evaluateRotation, getCropById } from "../engine/predictor.js";
import { esc, pill, progressBar } from "./components.js";

const OVERLAYS = [
  { id: "normal", label: "🌿 Réel" },
  { id: "moisture", label: "💧 Humidité" },
  { id: "health", label: "🛰️ Santé NDVI" },
  { id: "disease", label: "🦠 Risque Maladie" },
  { id: "energy", label: "⚡ Flux Énergie/Eau" },
  { id: "ar", label: "🥽 Balises AR" },
];

export function renderView3D(container, ctx) {
  const { state, forecast, uiState, engine3d } = ctx;
  const sel = uiState.selectedObject;

  container.innerHTML = `
    <div class="grid-cockpit">
      <div>
        <div class="viewport-wrap ${uiState.buildActive ? "build-mode" : ""}" id="viewport-wrap">
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
              <button class="btn btn-sm" data-cam="top">🗺️ Plan</button>
              <button class="btn btn-sm" data-cam="ar">🥽 Vue AR</button>
              <button class="btn btn-sm ${uiState.showArPins ? "active" : ""}" id="btn-toggle-pins">🏷️ Étiquettes</button>
            </div>
          </div>

          <div class="viewport-hud-bottom">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:260px;">
              <button class="btn btn-primary btn-sm" id="btn-timelapse">${state.simulation.playingTimelapse ? "⏸ Pause" : "▶ Time-Lapse"}</button>
              <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:2px;">
                  <span>🔮 <strong>Prévoir l'avenir</strong> : <span id="lbl-day-offset">${state.simulation.dayOffset === 0 ? "Aujourd'hui (Direct)" : `J+${state.simulation.dayOffset}`}</span></span>
                  <span class="muted">${esc(forecast.daily[Math.min(state.simulation.dayOffset, forecast.daily.length - 1)]?.date || "")}</span>
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

        <div class="card" style="margin-top:12px;">
          <div class="card-header" style="margin-bottom:8px;">
            <h3 class="card-title">🏗️ Aménagement 3D de la ferme (Cliquer pour placer sur le terrain)</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-sm ${uiState.buildActive ? "btn-amber" : ""}" id="btn-build-mode">
                ${uiState.buildActive ? "✋ Quitter Mode Construction" : "➕ Construire en 3D"}
              </button>
              <button class="btn btn-sm" id="btn-build-rot">↻ Pivoter (${Math.round((uiState.buildRot * 180) / Math.PI)}°)</button>
            </div>
          </div>
          <div class="build-dock">
            ${BUILDING_CATALOG.map((b) => `
              <button class="build-item ${uiState.buildActive && uiState.buildType === b.type ? "active" : ""}" data-build-type="${b.type}">
                <span style="font-size:18px;">${b.icon}</span>
                <span>${esc(b.label)}</span>
                <span class="muted">${b.cost} €</span>
              </button>
            `).join("")}
          </div>
          <div class="muted" style="margin-top:6px;">
            Astuce souris 3D : Clic gauche glissé = orbite · Clic droit ou Shift+glissé = déplacer · Molette = zoom · Clic sur un élément = inspecter & piloter.
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="card" id="inspector-card">
          ${renderInspector(sel, state, forecast)}
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

  if (engine3d) {
    engine3d.overlay = uiState.overlay;
    engine3d.buildMode.active = uiState.buildActive;
    engine3d.buildMode.type = uiState.buildType;
    engine3d.buildMode.rot = uiState.buildRot;
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

  container.querySelector("#btn-toggle-pins").addEventListener("click", () => {
    uiState.showArPins = !uiState.showArPins;
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

  // Construction 3D
  container.querySelector("#btn-build-mode").addEventListener("click", () => {
    uiState.buildActive = !uiState.buildActive;
    ctx.rerender();
  });
  container.querySelector("#btn-build-rot").addEventListener("click", () => {
    uiState.buildRot = (uiState.buildRot + Math.PI / 2) % (Math.PI * 2);
    ctx.rerender();
  });
  container.querySelectorAll("[data-build-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      uiState.buildType = btn.dataset.buildType;
      uiState.buildActive = true;
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

  bindInspectorEvents(container.querySelector("#inspector-card"), ctx);
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
        Cliquez sur une <strong>planche, serre, poulailler, éolienne ou robot</strong> dans la scène 3D pour afficher sa télémétrie et le piloter.
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
    const rotEval = evaluateRotation(p, p.cropId);
    const isGh = p.zone === "Serre";

    return `
      <div class="card-header">
        <h3 class="card-title">${crop.icon} ${esc(p.name)}</h3>
        ${pill(p.zone, isGh ? "info" : "ok")}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div><strong>Culture :</strong> ${esc(crop.name)} (${esc(crop.family)}) · ${p.areaM2} m²</div>
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
    return `
      <div class="card-header">
        <h3 class="card-title">🏗️ ${esc(s.label)}</h3>
        ${pill(s.type, "info")}
      </div>
      <div class="muted" style="margin-bottom:8px;">Position 3D : X=${s.x}, Z=${s.z} · Dimensions ${s.w}×${s.d} m</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${isCoop ? `<button class="btn btn-primary btn-sm" data-insp-coop="${s.id}">🚪 ${s.doorOpen ? "Fermer trappe" : "Ouvrir trappe"}</button>` : ""}
        <button class="btn btn-sm" data-insp-rot-struct="${s.id}">↻ Pivoter 90°</button>
        <button class="btn btn-danger btn-sm" data-insp-del-struct="${s.id}">🗑️ Démolir</button>
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
      const res = toggleCoopDoor(state);
      ctx.toast(res.message);
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
      state.plots = state.plots.filter((x) => x.id !== btn.dataset.inspDelPlot);
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
