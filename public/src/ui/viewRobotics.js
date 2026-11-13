import { dispatchRobot, evaluateAutomations } from "../engine/automation.js";
import { getCropById } from "../engine/predictor.js";
import { injectWeatherEvent, syncOpenMeteo } from "../engine/weather.js";
import { esc, kpiCard, pill, progressBar } from "./components.js";

export function renderViewRobotics(container, ctx) {
  const { state } = ctx;
  const wx = state.weather.current;
  const bots = state.equipment.filter((e) => e.autonomous);
  const manualTools = state.equipment.filter((e) => !e.autonomous);

  container.innerHTML = `
    <div class="grid-4" style="margin-bottom:14px;">
      ${kpiCard("Station Météo Connectée", `${wx.tempC} °C`, `HR ${wx.rhPct}% · Vent ${wx.windKmh} km/h · Pluie ${wx.rainMm} mm`, wx.windKmh > 40 ? "warn" : "ok")}
      ${kpiCard("Rayonnement & Mouillage", `${wx.solarWm2} W/m²`, `Mouillage foliaire ${wx.leafWetnessPct}% · ${wx.pressureHpa} hPa`, "info")}
      ${kpiCard("Robots autonomes", `${bots.filter((b) => b.status === "working").length} / ${bots.length} actifs`, "Pilotage & télémétrie 3D live", "ok")}
      ${kpiCard("Outils non-autonomes", `${manualTools.length} engins`, "Heures moteur & maintenance suivies", "info")}
    </div>

    <div class="grid-2" style="margin-bottom:14px;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🌦️ Station Météo Connectée & Simulation Événements</h3>
          <button class="btn btn-primary btn-sm" id="btn-wx-sync">🛰️ Sync Open-Meteo</button>
        </div>
        <div class="muted" style="margin-bottom:10px;">Source : <strong>${esc(state.weather.source)}</strong></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          <button class="btn btn-sm" data-wx-sim="clear_sunny">☀️ Grand Soleil</button>
          <button class="btn btn-sm" data-wx-sim="rain_gentle">🌧️ Pluie Douce</button>
          <button class="btn btn-sm btn-amber" data-wx-sim="heatwave">🔥 Test Canicule (34°C)</button>
          <button class="btn btn-sm btn-danger" data-wx-sim="storm">⛈️ Test Tempête (62 km/h)</button>
          <button class="btn btn-sm" data-wx-sim="frost">❄️ Test Gel (-2.5°C)</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Jour</th><th>Min / Max</th><th>Pluie</th><th>Vent</th><th>HR</th><th>Solaire</th></tr></thead>
            <tbody>
              ${(state.weather.forecast || []).slice(0, 7).map((d) => `
                <tr>
                  <td><strong>${esc(d.date)}</strong></td>
                  <td>${d.tempMin}° / <strong>${d.tempMax}°C</strong></td>
                  <td>${d.rainMm} mm</td>
                  <td>${d.windMaxKmh} km/h</td>
                  <td>${d.rhAvgPct}%</td>
                  <td>${d.solarKwhM2} kWh/m²</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">⚙️ Automatisations « Si Capteur → Alors Action »</h3>
          <button class="btn btn-primary btn-sm" id="btn-eval-auto">⚡ Évaluer & Exécuter</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
          ${state.automations.map((r) => `
            <div style="padding:9px;border-radius:10px;background:var(--bg-soft);border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div>
                <strong>${esc(r.name)}</strong>
                <div class="muted">
                  SI <code>${esc(r.condition.sensor)} ${esc(r.condition.op)} ${r.condition.value}</code>
                  → ALORS <code>${esc(r.action.type)}</code> · Déclenchée ${r.triggerCount || 0}×
                </div>
              </div>
              <button class="btn btn-sm ${r.enabled ? "btn-primary" : ""}" data-auto-toggle="${r.id}">${r.enabled ? "ACTIF" : "INACTIF"}</button>
            </div>
          `).join("")}
        </div>

        <form id="form-add-auto" class="form-row">
          <input class="input" name="name" placeholder="Nouvelle règle (ex: Alerte mildiou serre)" style="flex:1;" required />
          <select class="input" name="sensor" style="width:155px;">
            <option value="plot_min_moisture">Humidité sol min (%)</option>
            <option value="greenhouse_temp">T° Serre (°C)</option>
            <option value="wind_kmh">Vent (km/h)</option>
            <option value="disease_max_risk">Risque maladie (%)</option>
          </select>
          <select class="input" name="op" style="width:65px;">
            <option value="<">&lt;</option>
            <option value=">">&gt;</option>
          </select>
          <input class="input" name="value" type="number" value="35" style="width:70px;" required />
          <select class="input" name="actionType" style="width:155px;">
            <option value="irrigate_dry_plots">Irriguer planches sèches</option>
            <option value="open_vents">Ouvrir ouvrants serre</option>
            <option value="dispatch_rover">Envoyer Rover auto</option>
            <option value="storm_protect">Mode Sécurité Tempête</option>
          </select>
          <button class="btn btn-primary btn-sm" type="submit">+ Règle</button>
        </form>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🤖 Flotte Robotique Autonome (Téléopération)</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${bots.map((b) => `
            <div style="padding:10px;border-radius:10px;background:var(--bg-soft);border:1px solid var(--border);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>${b.kind === "drone" ? "🚁" : b.kind === "tractor" ? "🚜" : "🤖"} ${esc(b.name)}</strong>
                ${pill(b.status.toUpperCase(), b.status === "working" ? "ok" : "info")}
              </div>
              <div class="muted" style="margin:4px 0;">
                Position 3D : (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) · Heures : ${b.hoursTotal.toFixed(1)}/${b.nextServiceHours} h · ${b.costPerHour} €/h
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:12px;">Batterie ${Math.round(b.batteryPct)}%</span>
                <div style="flex:1;">${progressBar(b.batteryPct, b.batteryPct > 30 ? "#22c55e" : "#f59e0b")}</div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <select class="input" style="flex:1;min-width:130px;padding:4px 8px;" data-rob-plot="${b.id}">
                  ${state.plots.map((p) => `<option value="${p.id}" ${b.targetPlotId === p.id ? "selected" : ""}>${esc(p.id)} · ${esc(getCropById(p.cropId).name)}</option>`).join("")}
                </select>
                <button class="btn btn-primary btn-sm" data-rob-go="${b.id}">Déployer</button>
                <button class="btn btn-sm" data-rob-home="${b.id}">Rappeler</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🛠️ Outils Non-Autonomes & Matériel Classique</h3>
        </div>
        <div class="table-wrap" style="margin-bottom:12px;">
          <table class="data-table">
            <thead><tr><th>Équipement</th><th>Heures / Révision</th><th>Coût/h</th><th>Action</th></tr></thead>
            <tbody>
              ${manualTools.map((t) => {
                const dueSoon = t.nextServiceHours - t.hoursTotal < 100;
                return `
                  <tr>
                    <td><strong>${esc(t.name)}</strong><div class="muted">${esc(t.category)} · ${esc(t.task)}</div></td>
                    <td>
                      ${t.hoursTotal} / ${t.nextServiceHours} h
                      ${dueSoon ? pill("Entretien proche", "warn") : ""}
                    </td>
                    <td>${t.costPerHour} €/h</td>
                    <td><button class="btn btn-sm" data-tool-log="${t.id}">+2 h</button></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>

        <form id="form-add-tool" class="form-row">
          <input class="input" name="name" placeholder="Nouvel outil / robot (ex: Herse étrille)" style="flex:1;" required />
          <select class="input" name="autonomous" style="width:140px;">
            <option value="false">Non-autonome</option>
            <option value="true">Robot autonome</option>
          </select>
          <input class="input" name="costPerHour" type="number" value="12" style="width:75px;" />
          <button class="btn btn-primary btn-sm" type="submit">+ Ajouter</button>
        </form>
      </div>
    </div>
  `;

  container.querySelector("#btn-wx-sync").addEventListener("click", async () => {
    ctx.toast("Synchronisation Open-Meteo en cours...");
    const res = await syncOpenMeteo(state.farm.location.lat, state.farm.location.lon, state.farm.location.id);
    state.weather.source = res.source;
    state.weather.lastSync = res.lastSync;
    state.weather.current = res.current;
    state.weather.forecast = res.forecast;
    ctx.toast(res.ok ? "Météo réelle Open-Meteo synchronisée !" : "Mode hors-ligne : modèle climatique local utilisé.");
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-wx-sim]").forEach((btn) => {
    btn.addEventListener("click", () => {
      injectWeatherEvent(state, btn.dataset.wxSim);
      const triggered = evaluateAutomations(state);
      ctx.toast(
        triggered.length
          ? `Événement appliqué → ${triggered.length} automatisation(s) déclenchée(s) !`
          : "Conditions météo station mises à jour."
      );
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#btn-eval-auto").addEventListener("click", () => {
    const triggered = evaluateAutomations(state);
    ctx.toast(triggered.length ? `${triggered.length} règle(s) exécutée(s) !` : "Aucun seuil déclenché pour l'instant.");
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-auto-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rule = state.automations.find((a) => a.id === btn.dataset.autoToggle);
      if (rule) rule.enabled = !rule.enabled;
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#form-add-auto").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.automations.push({
      id: `AUT-${Date.now()}`,
      name: fd.get("name"),
      enabled: true,
      condition: { sensor: fd.get("sensor"), op: fd.get("op"), value: Number(fd.get("value")) },
      action: { type: fd.get("actionType"), pct: 80, durationMin: 20 },
      triggerCount: 0,
    });
    ctx.toast("Nouvelle automatisation enregistrée !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-rob-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.robGo;
      const plotId = container.querySelector(`[data-rob-plot="${id}"]`)?.value;
      const res = dispatchRobot(state, id, plotId);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelectorAll("[data-rob-home]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = dispatchRobot(state, btn.dataset.robHome, null);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelectorAll("[data-tool-log]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const eq = state.equipment.find((e) => e.id === btn.dataset.toolLog);
      if (eq) eq.hoursTotal = Number((eq.hoursTotal + 2).toFixed(1));
      ctx.toast(`+2h comptabilisées sur ${eq.name}`);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#form-add-tool").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const isAuto = fd.get("autonomous") === "true";
    state.equipment.push({
      id: `EQ-${Date.now()}`,
      name: fd.get("name"),
      category: isAuto ? "Robot autonome" : "Outil non-autonome",
      autonomous: isAuto,
      kind: isAuto ? "rover" : "manual",
      status: isAuto ? "idle" : "available",
      batteryPct: 100,
      hoursTotal: 0,
      nextServiceHours: 300,
      costPerHour: Number(fd.get("costPerHour")) || 10,
      x: 10,
      z: -4,
      targetX: 10,
      targetZ: -4,
      task: "Prêt au hangar",
    });
    ctx.toast("Équipement ajouté à la flotte !");
    ctx.save();
    ctx.rerender();
  });
}
