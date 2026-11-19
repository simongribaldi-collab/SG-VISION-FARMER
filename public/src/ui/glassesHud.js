import { processNaturalCommand } from "../engine/aiAssistant.js";
import { simulateFuture } from "../engine/predictor.js";
import { esc } from "./components.js";

const STORAGE_KEY = "sg_vision_farmer_state_v2";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sg_farmer_sync") : null;

async function loadState(overrideState = null) {
  if (overrideState && overrideState.farm) return overrideState;
  try {
    const resp = await fetch("/api/state", { cache: "no-store" });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.farm) return data;
    }
  } catch {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

async function persistState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  try {
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {}
  if (channel) channel.postMessage({ type: "state_updated", state });
}

async function renderHud(overrideState = null) {
  const state = await loadState(overrideState);
  const meta = document.getElementById("hud-meta");
  const kpis = document.getElementById("hud-kpis");
  const targets = document.getElementById("hud-targets");
  const alertsEl = document.getElementById("hud-alerts");
  const quickEl = document.getElementById("hud-quick-cmds");

  if (!state) {
    meta.textContent = "Ouvrez d'abord le Cockpit 3D principal pour initialiser la ferme.";
    return;
  }

  const sim = simulateFuture(state, 14, state.simulation?.scenario || "normal");
  const wx = state.weather.current;
  meta.textContent = `${state.farm.name} · ${state.farm.location.name} · ${new Date().toLocaleTimeString("fr-FR")}`;

  kpis.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Météo Direct</div><div class="kpi-value" style="font-size:18px;">${wx.tempC}°C · ${wx.windKmh} km/h</div><div class="kpi-sub">HR ${wx.rhPct}% · Pluie ${wx.rainMm} mm</div></div>
    <div class="kpi-card"><div class="kpi-label">Autonomie Globale</div><div class="kpi-value" style="font-size:18px;color:#4ade80;">${sim.globalScore} / 100</div><div class="kpi-sub">Eau ${sim.daily[0].waterStockM3} m³</div></div>
    <div class="kpi-card"><div class="kpi-label">Robots Actifs</div><div class="kpi-value" style="font-size:18px;">${state.equipment.filter((e) => e.autonomous && e.status === "working").length}</div><div class="kpi-sub">${state.equipment.filter((e) => e.autonomous).map((b) => `${b.name.split(" ")[0]} ${Math.round(b.batteryPct)}%`).join(" · ")}</div></div>
    <div class="kpi-card"><div class="kpi-label">Ponte / Récolte J</div><div class="kpi-value" style="font-size:18px;">${sim.daily[0].eggsCount} œufs</div><div class="kpi-sub">${sim.daily[0].harvestKg} kg prévus</div></div>
  `;

  targets.innerHTML = state.plots.slice(0, 6).map((p) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid rgba(56,189,248,0.28);border-radius:10px;background:rgba(56,189,248,0.06);">
      <div>
        <strong>⌖ ${esc(p.id)} · ${esc(p.name)}</strong>
        <div class="muted">Eau sol ${p.moisturePct}% · Santé ${p.healthPct}% · Maladie ${p.diseaseRisk}%</div>
      </div>
      <span class="pill ${p.moisturePct < 38 ? "warn" : "ok"}">${p.irrigationValveOpen ? "💧 ON" : p.stage}</span>
    </div>
  `).join("");

  let remoteAlerts = [];
  try {
    const r = await fetch("/api/hud", { cache: "no-store" });
    if (r.ok) {
      const h = await r.json();
      if (Array.isArray(h.alerts)) remoteAlerts = h.alerts;
    }
  } catch {}
  const seen = new Set();
  const allAlerts = [...remoteAlerts, ...(state.hud?.alerts || [])]
    .filter((a) => {
      const key = `${a.id || ""}:${a.message || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
  alertsEl.innerHTML = allAlerts.length
    ? allAlerts.map((a) => `<div style="padding:7px 9px;border-radius:8px;border:1px solid rgba(56,189,248,0.28);font-size:12px;">◈ ${esc(a.message)}</div>`).join("")
    : `<div class="muted">Aucune alerte active. Tout est nominal.</div>`;

  const quickCmds = [
    "Envoie le rover sur P2",
    "Arrose P2",
    "Ouvre les serres à 80%",
    "Ferme le poulailler",
    "Quels risques à 30 jours ?",
  ];
  quickEl.innerHTML = quickCmds.map((q) => `<button class="btn btn-sm" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");
  quickEl.querySelectorAll("[data-q]").forEach((btn) => {
    btn.addEventListener("click", () => runHudCommand(btn.dataset.q));
  });
}

async function runHudCommand(text) {
  const state = await loadState();
  const fb = document.getElementById("hud-cmd-feedback");
  if (!state) return;
  const sim = simulateFuture(state, 30, state.simulation?.scenario || "normal");
  const res = processNaturalCommand(state, text, sim);
  fb.textContent = res.reply;
  if (res.mutated) {
    await persistState(state);
  }
  renderHud();
}

document.getElementById("hud-cmd-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = document.getElementById("hud-cmd-input");
  if (!inp.value.trim()) return;
  runHudCommand(inp.value);
  inp.value = "";
});

document.getElementById("btn-refresh").addEventListener("click", renderHud);

document.getElementById("btn-voice").addEventListener("click", () => {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const fb = document.getElementById("hud-cmd-feedback");
  if (!Speech) {
    fb.textContent = "Reconnaissance vocale navigateur indisponible ici — utilisez les boutons rapides ou le champ texte.";
    return;
  }
  const rec = new Speech();
  rec.lang = "fr-FR";
  rec.onresult = (ev) => {
    const transcript = ev.results?.[0]?.[0]?.transcript || "";
    document.getElementById("hud-cmd-input").value = transcript;
    runHudCommand(transcript);
  };
  rec.onerror = () => {
    fb.textContent = "Micro non autorisé ou indisponible.";
  };
  rec.start();
  fb.textContent = "🎙️ Écoute en cours (parlez en français)...";
});

if (channel) {
  channel.onmessage = (ev) => {
    if (ev.data?.type === "state_updated" && ev.data.state) {
      renderHud(ev.data.state);
    } else {
      renderHud();
    }
  };
}
setInterval(() => renderHud(), 4000);
renderHud();
