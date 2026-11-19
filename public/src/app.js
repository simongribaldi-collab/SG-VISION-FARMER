import { BUILDING_CATALOG, buildPresetState, generateTerrainHeights, SCALE_PRESETS } from "./data/presets.js";
import { askAssistant } from "./engine/aiAssistant.js";
import { dispatchRobot, setGreenhouseVent, tickRobots, toggleCoopDoor, toggleIrrigation } from "./engine/automation.js";
import { Farm3DEngine, sculptTerrainAt } from "./engine/engine3d.js";
import { simulateFuture } from "./engine/predictor.js";
import { esc, fmtEur, pill } from "./ui/components.js";
import { renderView3D } from "./ui/view3d.js";
import { renderViewAgronomy } from "./ui/viewAgronomy.js";
import { renderViewEcosystem } from "./ui/viewEcosystem.js";
import { renderViewForecastFinance } from "./ui/viewForecastFinance.js";
import { renderViewLivestock } from "./ui/viewLivestock.js";
import { renderViewResources } from "./ui/viewResources.js";
import { renderViewRobotics } from "./ui/viewRobotics.js";

const STORAGE_KEY = "sg_vision_farmer_state_v2";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sg_farmer_sync") : null;

const TABS = [
  { id: "3d", label: "🌐 Jumeau 3D" },
  { id: "agro", label: "🌱 Cultures & Planches" },
  { id: "livestock", label: "🐔 Élevage & Ponte" },
  { id: "robotics", label: "🤖 Robotique & Météo" },
  { id: "resources", label: "📦 Ressources & Équipe" },
  { id: "finance", label: "🔮 Prévoir & Finances" },
  { id: "ecosystem", label: "🥽 Lunettes AR & IA" },
];

class AppController {
  constructor() {
    this.root = document.getElementById("app");
    this.state = null;
    this.forecast = null;
    this.engine3d = null;
    this.rafId = null;
    this.lastFrameTs = 0;
    this.lastProcessedCmdId = null;
    this._hudPollInitialized = false;
    this._sessionStartMs = Date.now();
    this.serverStatus = { online: false, mcpTools: 6 };
    this.uiState = {
      tab: "3d",
      overlay: "normal",
      showArPins: false,
      shadowsEnabled: true,
      buildActive: false,
      buildCategory: "all",
      buildType: "bed_open",
      buildRot: 0,
      sculptActive: false,
      sculptTool: "raise",
      sculptRadius: 5,
      scannerOpen: false,
      demoScanId: "coteau_ferme",
      lastScanResult: null,
      selectedObject: null,
      agroTab: "plots",
      rotPlotId: null,
      forecastHorizon: 60,
      aiOpen: false,
      aiMessages: [
        {
          role: "bot",
          text: "Bonjour ! Je suis l'Assistant IA de SG Vision Farmer — Projet Granges-les-Beaumont (ZE 309 + ZE 375, 1,65 ha). Demandez-moi le bilan financier (« Synthèse prêt EARL et EBE »), une prévision (« Quels risques à 30 jours ? »), une rotation (« Quelle rotation sur P1 ? ») ou pilotez un robot (« Envoie le rover sur P2 »).",
        },
      ],
    };
  }

  async init() {
    await this.checkHealth();
    this.state = await this.loadInitialState();
    this.refreshForecastOnly();
    this.renderShell();
    this.startLoop();

    if (channel) {
      channel.onmessage = (ev) => {
        if (ev.data?.type === "state_updated" && ev.data.state) {
          this.state = ev.data.state;
          this.refreshForecastOnly();
          this.rerender();
        }
      };
    }

    setInterval(() => this.pollRemoteHudCommands(), 3500);
  }

  async checkHealth() {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        this.serverStatus = { online: true, mcpTools: data.mcpTools || 6 };
      }
    } catch {
      this.serverStatus = { online: false, mcpTools: 6 };
    }
  }

  async loadInitialState() {
    const ensureV3 = (st) => {
      if (!st || !st.farm) return null;
      if (!st.terrain || !Array.isArray(st.terrain.heights) || (st.version || 0) < 3) {
        const presetId = st.farm.presetId || "granges_beaumont";
        const fresh = buildPresetState(presetId);
        const def = buildPresetState(presetId);
        const isCustomizedMeta = st.farm.name && st.farm.name !== def.farm.name;
        if (isCustomizedMeta) {
          fresh.farm.name = st.farm.name;
          if (st.farm.location) fresh.farm.location = st.farm.location;
          if (st.farm.areaHa) fresh.farm.areaHa = st.farm.areaHa;
        }
        return { state: fresh, migrated: true };
      }
      return { state: st, migrated: false };
    };

    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) {
        const res = ensureV3(await r.json());
        if (res?.state?.farm) {
          if (res.migrated) await this.saveState(res.state);
          else localStorage.setItem(STORAGE_KEY, JSON.stringify(res.state));
          return res.state;
        }
      }
    } catch {}

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const res = ensureV3(JSON.parse(raw));
        if (res?.state?.farm) {
          if (res.migrated) await this.saveState(res.state);
          return res.state;
        }
      }
    } catch {}

    const fresh = buildPresetState("granges_beaumont");
    await this.saveState(fresh);
    return fresh;
  }

  async saveState(overrideState = null) {
    const target = overrideState || this.state;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
    } catch {}
    if (channel) {
      channel.postMessage({ type: "state_updated", state: target });
    }
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
    } catch {}
  }

  async pollRemoteHudCommands() {
    if (!this.serverStatus.online) return;
    try {
      const r = await fetch("/api/hud", { cache: "no-store" });
      if (!r.ok) return;
      const hud = await r.json();
      const cmd = hud.commands?.[0];
      if (!cmd) {
        this._hudPollInitialized = true;
        return;
      }
      if (!this._hudPollInitialized) {
        this._hudPollInitialized = true;
        const cmdMs = cmd.timestamp ? Date.parse(cmd.timestamp) : 0;
        if (!cmdMs || cmdMs < this._sessionStartMs - 5000) {
          this.lastProcessedCmdId = cmd.id;
          return;
        }
      }
      if (cmd.id === this.lastProcessedCmdId) return;
      this.lastProcessedCmdId = cmd.id;

      let res = null;
      if (cmd.action === "dispatch") res = dispatchRobot(this.state, cmd.targetId, cmd.plotId || this.state.plots[0]?.id);
      else if (cmd.action === "return_home" || cmd.action === "pause") res = dispatchRobot(this.state, cmd.targetId, null);
      else if (cmd.action === "irrigate") res = toggleIrrigation(this.state, cmd.plotId || this.state.plots[0]?.id, true);
      else if (cmd.action === "vent_open") res = setGreenhouseVent(this.state, cmd.plotId || this.state.plots.find((p) => p.zone === "Serre")?.id, 80);
      else if (cmd.action === "coop_toggle") res = toggleCoopDoor(this.state);

      if (res) {
        this.toast(`[MCP/AR] ${res.message}`);
        this.saveState();
        this.rerender();
      }
    } catch {}
  }

  refreshForecastOnly() {
    const dayOff = this.state.simulation.dayOffset || 0;
    const horizon = Math.max(14, dayOff, this.uiState.forecastHorizon || 60);
    this.forecast = simulateFuture(this.state, horizon, this.state.simulation.scenario || "normal", dayOff);
  }

  replaceState(nextState) {
    this.state = nextState;
    this.uiState.selectedObject = null;
    this.refreshForecastOnly();
    this.saveState();
    this.rerender();
  }

  toast(msg) {
    let stack = document.getElementById("toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toast-stack";
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  renderShell() {
    this.root.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <img src="/icon.svg" alt="SG Vision Farmer" />
          <div>
            <div class="brand-title">SG Vision Farmer</div>
            <div class="brand-sub" id="hdr-farm-sub"></div>
          </div>
        </div>

        <nav class="nav-tabs" id="nav-tabs"></nav>

        <div class="topbar-actions">
          <select class="input" id="sel-quick-preset" style="width:210px;padding:5px 8px;font-size:12px;" title="Changer d'échelle d'exploitation">
            ${SCALE_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}
          </select>
          <a class="btn btn-sm" href="/glasses.html" target="_blank">🥽 Lunettes AR</a>
          <button class="btn btn-primary btn-sm" id="btn-toggle-ai">✨ Assistant IA</button>
        </div>
      </header>

      <div class="status-ribbon" id="status-ribbon"></div>
      <main class="main-content" id="main-content"></main>

      <aside class="ai-drawer ${this.uiState.aiOpen ? "" : "hidden"}" id="ai-drawer">
        <div class="card-header" style="padding:10px 14px;margin:0;border-bottom:1px solid var(--border);">
          <h3 class="card-title">✨ Assistant IA Agronomique & Voix</h3>
          <button class="btn btn-sm" id="btn-close-ai">✕</button>
        </div>
        <div class="ai-messages" id="ai-messages"></div>
        <div style="padding:8px 12px;border-top:1px solid var(--border);">
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px;">
            <button class="btn btn-sm" data-ai-chip="Synthèse projet Granges prêt et EBE">📋 Projet EARL</button>
            <button class="btn btn-sm" data-ai-chip="Quels risques à 30 jours ?">🔮 Risques 30j</button>
            <button class="btn btn-sm" data-ai-chip="Quelle rotation sur P1 ?">🔄 Rotation P1</button>
            <button class="btn btn-sm" data-ai-chip="Envoie le rover sur P2">🤖 Rover → P2</button>
            <button class="btn btn-sm" data-ai-chip="Ouvre les serres à 80%">🏡 Aérer Serres</button>
          </div>
          <form id="ai-form" style="display:flex;gap:6px;">
            <button class="btn btn-sm" type="button" id="btn-ai-voice" title="Dicter">🎙️</button>
            <input class="input" id="ai-input" placeholder="Question ou ordre en français..." />
            <button class="btn btn-primary btn-sm" type="submit">Envoyer</button>
          </form>
        </div>
      </aside>
    `;

    this.root.querySelector("#sel-quick-preset").addEventListener("change", (e) => {
      const next = buildPresetState(e.target.value);
      this.replaceState(next);
      this.toast(`Modèle chargé : ${next.farm.name}`);
    });

    this.root.querySelector("#btn-toggle-ai").addEventListener("click", () => {
      this.uiState.aiOpen = !this.uiState.aiOpen;
      this.root.querySelector("#ai-drawer").classList.toggle("hidden", !this.uiState.aiOpen);
      this.renderAiMessages();
    });
    this.root.querySelector("#btn-close-ai").addEventListener("click", () => {
      this.uiState.aiOpen = false;
      this.root.querySelector("#ai-drawer").classList.add("hidden");
    });

    this.root.querySelectorAll("[data-ai-chip]").forEach((btn) => {
      btn.addEventListener("click", () => this.submitAiPrompt(btn.dataset.aiChip));
    });

    this.root.querySelector("#ai-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = this.root.querySelector("#ai-input");
      if (!inp.value.trim()) return;
      const q = inp.value.trim();
      inp.value = "";
      this.submitAiPrompt(q);
    });

    this.root.querySelector("#btn-ai-voice").addEventListener("click", () => {
      const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Speech) {
        this.toast("Reconnaissance vocale indisponible dans ce navigateur.");
        return;
      }
      const rec = new Speech();
      rec.lang = "fr-FR";
      rec.onresult = (ev) => {
        const txt = ev.results?.[0]?.[0]?.transcript;
        if (txt) this.submitAiPrompt(txt);
      };
      rec.start();
      this.toast("🎙️ Écoute vocale active...");
    });

    this.rerender();
  }

  async submitAiPrompt(text) {
    this.uiState.aiMessages.push({ role: "user", text });
    this.renderAiMessages();
    const res = await askAssistant(this.state, text, this.forecast);
    this.uiState.aiMessages.push({ role: "bot", text: `${res.reply}\n— [${res.engine}]` });
    if (res.mutated) {
      this.refreshForecastOnly();
      this.saveState();
      this.rerender();
    } else {
      this.renderAiMessages();
    }
  }

  renderAiMessages() {
    const box = this.root.querySelector("#ai-messages");
    if (!box) return;
    box.innerHTML = this.uiState.aiMessages
      .map((m) => `<div class="ai-msg ${m.role}">${esc(m.text)}</div>`)
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  updateStatusRibbon() {
    const ribbon = this.root.querySelector("#status-ribbon");
    if (!ribbon || !this.state || !this.forecast) return;
    const s = this.state;
    const f = this.forecast;
    const wx = s.weather.current;
    const dayIdx = Math.min(s.simulation.dayOffset || 0, f.daily.length - 1);
    const dSnap = f.daily[dayIdx];
    ribbon.innerHTML = `
      <div class="ribbon-group">
        ${pill(`🏆 Autonomie ${f.globalScore}/100`, f.globalScore >= 75 ? "ok" : "info")}
        ${pill(`🌦️ ${wx.tempC}°C · HR ${wx.rhPct}% · Vent ${wx.windKmh} km/h`, wx.windKmh > 40 ? "warn" : "info")}
        ${pill(`💧 Eau ${dSnap.waterStockM3} m³`, dSnap.waterStockM3 < 20 ? "bad" : "ok")}
        ${pill(`⚡ Énergie ${dSnap.netEnergyKwh >= 0 ? "+" : ""}${dSnap.netEnergyKwh} kWh`, dSnap.netEnergyKwh >= 0 ? "ok" : "warn")}
        ${pill(`💶 Tréso J+${dayIdx} : ${fmtEur(dSnap.cashBalance)}`, dSnap.cashBalance >= 5000 ? "ok" : "warn")}
      </div>
      <div class="ribbon-group">
        ${pill(`🤖 ${s.equipment.filter((e) => e.autonomous && e.status === "working").length} robots en mission`, "info")}
        ${pill(this.serverStatus.online ? "MCP + Serveur Local OK" : "Mode Statique Local", this.serverStatus.online ? "ok" : "warn")}
      </div>
    `;
  }

  rerender() {
    this.refreshForecastOnly();
    const s = this.state;

    const sub = this.root.querySelector("#hdr-farm-sub");
    if (sub) sub.textContent = `${s.farm.name} · ${s.farm.areaHa} ha · ${s.farm.location.name}`;

    const presetSel = this.root.querySelector("#sel-quick-preset");
    if (presetSel && s.farm.presetId) presetSel.value = s.farm.presetId;

    const nav = this.root.querySelector("#nav-tabs");
    nav.innerHTML = TABS.map((t) => `
      <button class="nav-tab ${this.uiState.tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>
    `).join("");
    nav.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.uiState.tab = btn.dataset.tab;
        this.rerender();
      });
    });

    this.updateStatusRibbon();

    const main = this.root.querySelector("#main-content");
    const ctx = {
      state: this.state,
      forecast: this.forecast,
      uiState: this.uiState,
      engine3d: this.engine3d,
      serverStatus: this.serverStatus,
      save: () => this.saveState(),
      rerender: () => this.rerender(),
      refreshForecastOnly: () => this.refreshForecastOnly(),
      updateStatusRibbon: () => this.updateStatusRibbon(),
      replaceState: (next) => this.replaceState(next),
      toast: (msg) => this.toast(msg),
      mountCanvas: (canvas, onSelect) => this.mountCanvas(canvas, onSelect),
    };

    if (this.uiState.tab === "3d") renderView3D(main, ctx);
    else if (this.uiState.tab === "agro") renderViewAgronomy(main, ctx);
    else if (this.uiState.tab === "livestock") renderViewLivestock(main, ctx);
    else if (this.uiState.tab === "robotics") renderViewRobotics(main, ctx);
    else if (this.uiState.tab === "resources") renderViewResources(main, ctx);
    else if (this.uiState.tab === "finance") renderViewForecastFinance(main, ctx);
    else renderViewEcosystem(main, ctx);

    this.renderAiMessages();
  }

  mountCanvas(canvas, onSelect) {
    if (!canvas) return;
    const onSculptTerrain = (wx, wz) => {
      sculptTerrainAt(this.state, wx, wz, this.uiState.sculptTool || "raise", this.uiState.sculptRadius || 5);
    };
    const onSculptEnd = () => this.saveState();
    if (!this.engine3d) {
      this.engine3d = new Farm3DEngine(canvas, {
        onSelect,
        onPlaceBuilding: (placement) => this.placeBuilding3D(placement),
        onSculptTerrain,
        onSculptEnd,
      });
    } else {
      if (this.engine3d.canvas !== canvas && canvas.parentNode) {
        this.engine3d.canvas.id = canvas.id || "farm-canvas";
        canvas.replaceWith(this.engine3d.canvas);
      }
      this.engine3d.callbacks.onSelect = onSelect;
      this.engine3d.callbacks.onPlaceBuilding = (placement) => this.placeBuilding3D(placement);
      this.engine3d.callbacks.onSculptTerrain = onSculptTerrain;
      this.engine3d.callbacks.onSculptEnd = onSculptEnd;
    }
  }

  nextPlotId(prefix) {
    const maxNum = (this.state.plots || []).reduce((max, p) => {
      if (typeof p.id === "string" && p.id.startsWith(prefix)) {
        const n = parseInt(p.id.slice(prefix.length), 10);
        if (!Number.isNaN(n) && n > max) return n;
      }
      return max;
    }, 0);
    return `${prefix}${maxNum + 1}`;
  }

  placeBuilding3D({ type, x, z, rot }) {
    if (type === "custom_glb" && this.uiState.customGlbUrl) {
      const label = this.uiState.customGlbName || "Modèle 3D .GLB";
      this.state.structures.push({
        id: `STR-${Date.now()}`,
        type: "custom_glb",
        label,
        modelUrl: this.uiState.customGlbUrl,
        x,
        z,
        w: 4,
        d: 4,
        h: 3,
        rot,
        scale: 1,
      });
      this.toast(`📦 ${label} placé sur le terrain 3D !`);
      this.saveState();
      this.rerender();
      return;
    }

    const cat = BUILDING_CATALOG.find((b) => b.type === type);
    if (!cat) return;

    if (type === "bed_open" || type === "greenhouse" || type === "glass_house") {
      const isGh = type === "greenhouse" || type === "glass_house";
      const id = this.nextPlotId(isGh ? "S" : "P");
      this.state.plots.push({
        id,
        name: `${cat.label} ${id}`,
        zone: isGh ? "Serre" : "Plein champ",
        ...(isGh ? { structureStyle: type } : {}),
        x,
        z,
        w: cat.w,
        d: cat.d,
        rot,
        areaM2: type === "glass_house" ? 700 : isGh ? 400 : 140,
        soilType: "Limono-argileux",
        ph: 6.7,
        omPct: 4.5,
        cropId: isGh ? "tomate" : "laitue",
        plantedDayOffset: 0,
        gddAccumulated: 260,
        stage: "Croissance",
        moisturePct: 60,
        healthPct: 94,
        diseaseRisk: 10,
        irrigationValveOpen: false,
        ventOpeningPct: isGh ? 30 : 0,
        indoorTempC: 23.5,
        indoorRhPct: 68,
        history: [{ season: "N-1", cropId: "engrais_vert" }],
      });
    } else {
      this.state.structures.push({
        id: `STR-${Date.now()}`,
        type,
        label: cat.label,
        x,
        z,
        w: cat.w,
        d: cat.d,
        h: cat.h,
        rot,
        doorOpen: true,
        kwPeak: type === "solar_array" ? 12 : type === "wind_turbine" ? 6 : 0,
      });
    }

    this.state.finances.cashBalance -= cat.cost;
    this.state.finances.ledger.unshift({
      id: `TX-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      type: "charge",
      atelier: "Aménagement 3D",
      label: `Construction ${cat.label}`,
      amount: -cat.cost,
    });

    this.toast(`${cat.icon} ${cat.label} construit en 3D (-${cat.cost} €) !`);
    this.saveState();
    this.rerender();
  }

  startLoop() {
    let timelapseAccum = 0;
    const frame = (ts) => {
      const dt = Math.min(0.1, (ts - (this.lastFrameTs || ts)) / 1000);
      this.lastFrameTs = ts;

      if (this.state) {
        tickRobots(this.state, dt, ts / 1000);
        if (this.state.simulation.playingTimelapse) {
          timelapseAccum += dt;
          if (timelapseAccum >= 0.45) {
            timelapseAccum = 0;
            this.state.simulation.dayOffset = (this.state.simulation.dayOffset + 1) % 91;
            if (this.state.simulation.dayOffset >= 30) this.state.farm.gamification.simulatedFutureUsed = true;
            this.refreshForecastOnly();
            this.updateStatusRibbon();
            const sl = document.getElementById("slider-day");
            const lbl = document.getElementById("lbl-day-offset");
            const dateLbl = document.getElementById("lbl-day-date");
            if (sl) sl.value = String(this.state.simulation.dayOffset);
            if (lbl) lbl.textContent = this.state.simulation.dayOffset === 0 ? "Aujourd'hui (Direct)" : `J+${this.state.simulation.dayOffset}`;
            if (dateLbl) {
              const dSnap = this.forecast.daily[Math.min(this.state.simulation.dayOffset, this.forecast.daily.length - 1)];
              dateLbl.textContent = dSnap?.date || "";
            }
          }
        }

        if (this.uiState.tab === "3d" && this.engine3d && document.body.contains(this.engine3d.canvas)) {
          const pins = this.engine3d.render(this.state, this.forecast, dt);
          const arLayer = document.getElementById("ar-overlay-layer");
          if (arLayer) {
            if (this.uiState.showArPins || this.uiState.overlay === "ar") {
              arLayer.innerHTML = pins
                .map(
                  (p) =>
                    `<div class="ar-pin ${p.warn ? "warn" : ""}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;">${esc(p.label)}</div>`
                )
                .join("");
            } else {
              arLayer.innerHTML = "";
            }
          }
        }
      }
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }
}

const app = new AppController();
app.init();
