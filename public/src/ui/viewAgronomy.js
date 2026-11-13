import { CROP_CATALOG, DISEASE_CATALOG } from "../data/presets.js";
import { evaluateRotation, getCropById } from "../engine/predictor.js";
import { esc, fmtEur, pill, progressBar } from "./components.js";

export function renderViewAgronomy(container, ctx) {
  const { state, forecast, uiState } = ctx;
  const sub = uiState.agroTab || "plots";

  container.innerHTML = `
    <div class="subtabs">
      <button class="btn ${sub === "plots" ? "active" : ""}" data-agro-tab="plots">🌱 Planches, Serres & Cultures</button>
      <button class="btn ${sub === "rotations" ? "active" : ""}" data-agro-tab="rotations">🔄 Rotations Intelligentes</button>
      <button class="btn ${sub === "planning" ? "active" : ""}" data-agro-tab="planning">📅 Planning Semis & Besoins</button>
      <button class="btn ${sub === "diseases" ? "active" : ""}" data-agro-tab="diseases">🩺 Maladies, Ravageurs & Prod</button>
    </div>
    <div id="agro-body"></div>
  `;

  container.querySelectorAll("[data-agro-tab]").forEach((b) => {
    b.addEventListener("click", () => {
      uiState.agroTab = b.dataset.agroTab;
      ctx.rerender();
    });
  });

  const body = container.querySelector("#agro-body");
  if (sub === "plots") renderPlotsSection(body, ctx);
  else if (sub === "rotations") renderRotationsSection(body, ctx);
  else if (sub === "planning") renderPlanningSection(body, ctx);
  else renderDiseasesAndProdSection(body, ctx);
}

function renderPlotsSection(el, ctx) {
  const { state, forecast } = ctx;
  const snapMap = new Map(forecast.plotSnapshots.map((s) => [s.id, s]));

  el.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header">
        <h3 class="card-title">➕ Ajouter une Planche de culture ou Serre</h3>
      </div>
      <form id="form-add-plot" class="form-row">
        <label class="field" style="flex:1;min-width:160px;">
          Nom planche / parcelle
          <input class="input" name="name" placeholder="Ex: Planche P5 — Oignons" required />
        </label>
        <label class="field" style="width:130px;">
          Zone
          <select class="input" name="zone">
            <option value="Plein champ">Plein champ</option>
            <option value="Serre">Serre</option>
          </select>
        </label>
        <label class="field" style="width:180px;">
          Culture
          <select class="input" name="cropId">
            ${CROP_CATALOG.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field" style="width:110px;">
          Surface (m²)
          <input class="input" type="number" name="areaM2" value="160" min="5" required />
        </label>
        <label class="field" style="width:140px;">
          Type de sol
          <select class="input" name="soilType">
            <option>Limono-argileux</option>
            <option>Limoneux</option>
            <option>Sablo-limoneux</option>
            <option>Argilo-calcaire</option>
          </select>
        </label>
        <button class="btn btn-primary" type="submit">Créer & Afficher en 3D</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">🌾 Parcellaire & Suivi en direct (J+${state.simulation.dayOffset})</h3>
        ${pill(`${state.plots.length} planches actives`, "ok")}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Planche / Serre</th>
              <th>Zone & Sol</th>
              <th>Culture (Changer)</th>
              <th>Surface</th>
              <th>Avancement</th>
              <th>Eau Sol</th>
              <th>Santé / Maladie</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.plots.map((p) => {
              const snap = snapMap.get(p.id);
              const rot = evaluateRotation(p, p.cropId);
              return `
                <tr>
                  <td><strong>${esc(p.name)}</strong><div class="muted">${esc(p.id)} · pH ${p.ph} · MO ${p.omPct}%</div></td>
                  <td>${pill(p.zone, p.zone === "Serre" ? "info" : "ok")}<div class="muted">${esc(p.soilType)}</div></td>
                  <td>
                    <select class="input" style="padding:4px 6px;font-size:12px;" data-plot-crop="${p.id}">
                      ${CROP_CATALOG.map((c) => `<option value="${c.id}" ${p.cropId === c.id ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}
                    </select>
                    <div class="muted">Score rotation : ${rot.score}/100</div>
                  </td>
                  <td>${p.areaM2.toLocaleString("fr-FR")} m²</td>
                  <td style="min-width:130px;">
                    <div>${esc(snap?.stage || p.stage)} (${snap?.progressPct ?? 45}%)</div>
                    ${progressBar(snap?.progressPct ?? 45, "#22c55e")}
                  </td>
                  <td>
                    <strong>${snap?.moisturePct ?? p.moisturePct}%</strong>
                    <div class="muted">${p.irrigationValveOpen ? "💧 Ouverte" : "Fermée"}</div>
                  </td>
                  <td>
                    <span>💚 ${snap?.healthPct ?? p.healthPct}%</span><br/>
                    <span class="muted">🦠 Risque ${snap?.diseaseRisk ?? p.diseaseRisk}%</span>
                  </td>
                  <td>
                    <button class="btn btn-sm" data-plot-irrig="${p.id}">${p.irrigationValveOpen ? "Stop Eau" : "💧 Arroser"}</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelector("#form-add-plot").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const zone = fd.get("zone");
    const nextIdx = state.plots.length + 1;
    const prefix = zone === "Serre" ? "S" : "P";
    const id = `${prefix}${nextIdx}`;
    const col = Math.floor((nextIdx - 1) / 4);
    const row = (nextIdx - 1) % 4;
    state.plots.push({
      id,
      name: fd.get("name"),
      zone,
      x: zone === "Serre" ? 2 + col * 9 : -10 + col * 8,
      z: -8 + row * 4.5,
      w: zone === "Serre" ? 8 : 7,
      d: zone === "Serre" ? 4.2 : 2.2,
      rot: 0,
      areaM2: Number(fd.get("areaM2")) || 150,
      soilType: fd.get("soilType"),
      ph: 6.7,
      omPct: 4.1,
      cropId: fd.get("cropId"),
      plantedDayOffset: 0,
      gddAccumulated: 80,
      stage: "Semis / Levée",
      moisturePct: 62,
      healthPct: 95,
      diseaseRisk: 8,
      irrigationValveOpen: false,
      ventOpeningPct: zone === "Serre" ? 30 : 0,
      indoorTempC: 23.5,
      indoorRhPct: 68,
      history: [{ season: "N-1", cropId: "engrais_vert" }],
    });
    ctx.toast(`Planche ${id} ajoutée au parcellaire et à la vue 3D !`);
    ctx.save();
    ctx.rerender();
  });

  el.querySelectorAll("[data-plot-crop]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const p = state.plots.find((x) => x.id === sel.dataset.plotCrop);
      if (!p) return;
      p.history = [{ season: "N-1", cropId: p.cropId }, ...(p.history || []).slice(0, 1)];
      p.cropId = sel.value;
      p.gddAccumulated = 50;
      p.stage = "Semis / Plantation";
      ctx.toast(`Culture mise à jour sur ${p.name}`);
      ctx.save();
      ctx.rerender();
    });
  });

  el.querySelectorAll("[data-plot-irrig]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = state.plots.find((x) => x.id === btn.dataset.plotIrrig);
      if (!p) return;
      p.irrigationValveOpen = !p.irrigationValveOpen;
      if (p.irrigationValveOpen) p.moisturePct = Math.min(88, p.moisturePct + 12);
      ctx.save();
      ctx.rerender();
    });
  });
}

function renderRotationsSection(el, ctx) {
  const { state, uiState } = ctx;
  const selectedPlot = state.plots.find((p) => p.id === uiState.rotPlotId) || state.plots[0];
  if (!selectedPlot) {
    el.innerHTML = `<div class="card">Ajoutez d'abord une planche pour analyser les rotations.</div>`;
    return;
  }

  const ranked = CROP_CATALOG.map((c) => evaluateRotation(selectedPlot, c.id)).sort((a, b) => b.score - a.score);

  el.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🔄 Matrice de Rotations Pluriannuelles</h3>
        </div>
        <label class="field" style="margin-bottom:12px;">
          Choisir la planche / serre à analyser
          <select class="input" id="rot-plot-select">
            ${state.plots.map((p) => `<option value="${p.id}" ${p.id === selectedPlot.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
          </select>
        </label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${state.plots.map((p) => {
            const cur = getCropById(p.cropId);
            const n1 = p.history?.[0] ? getCropById(p.history[0].cropId) : null;
            const n2 = p.history?.[1] ? getCropById(p.history[1].cropId) : null;
            const bestNext = CROP_CATALOG.map((c) => evaluateRotation(p, c.id)).sort((a, b) => b.score - a.score)[0];
            return `
              <div style="padding:9px;border-radius:10px;background:var(--bg-soft);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <strong>${esc(p.id)} · ${esc(p.name)}</strong>
                  ${pill(`N+1 conseillé : ${bestNext.candidate.icon} ${bestNext.candidate.name} (${bestNext.score}/100)`, "ok")}
                </div>
                <div class="muted" style="margin-top:4px;">
                  N-2 : ${n2 ? `${n2.icon} ${esc(n2.name)}` : "—"} →
                  N-1 : ${n1 ? `${n1.icon} ${esc(n1.name)}` : "—"} →
                  <strong>En cours : ${cur.icon} ${esc(cur.name)} (${cur.family})</strong>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🎯 Recommandations N+1 pour ${esc(selectedPlot.id)}</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:480px;overflow-y:auto;">
          ${ranked.map((r) => {
            const tone = r.score >= 80 ? "ok" : r.score >= 60 ? "warn" : "bad";
            return `
              <div style="padding:9px;border-radius:10px;background:var(--bg-soft);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <strong>${r.candidate.icon} ${esc(r.candidate.name)} <span class="muted">(${esc(r.candidate.family)})</span></strong>
                  <div style="display:flex;gap:6px;align-items:center;">
                    ${pill(`${r.score}/100 · ${r.verdict}`, tone)}
                    <button class="btn btn-primary btn-sm" data-apply-rot="${r.candidate.id}">Planifier</button>
                  </div>
                </div>
                ${r.positives.map((msg) => `<div style="font-size:11.5px;color:#86efac;margin-top:3px;">✓ ${esc(msg)}</div>`).join("")}
                ${r.warnings.map((msg) => `<div style="font-size:11.5px;color:#fcd34d;margin-top:3px;">⚠ ${esc(msg)}</div>`).join("")}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;

  el.querySelector("#rot-plot-select").addEventListener("change", (e) => {
    uiState.rotPlotId = e.target.value;
    ctx.rerender();
  });

  el.querySelectorAll("[data-apply-rot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPlot.nextCropId = btn.dataset.applyRot;
      const c = getCropById(btn.dataset.applyRot);
      ctx.toast(`Rotation N+1 enregistrée sur ${selectedPlot.id} : ${c.name}`);
      ctx.save();
      ctx.rerender();
    });
  });
}

function renderPlanningSection(el, ctx) {
  const { state } = ctx;
  const totalSeedsCost = state.plots.reduce((acc, p) => acc + p.areaM2 * getCropById(p.cropId).seedCostPerM2, 0);
  const totalLaborH = state.plots.reduce((acc, p) => acc + (p.areaM2 / 100) * getCropById(p.cropId).laborHoursPer100m2, 0);

  el.innerHTML = `
    <div class="grid-3" style="margin-bottom:14px;">
      <div class="kpi-card"><div class="kpi-label">Coût total semences / plants cycle</div><div class="kpi-value">${fmtEur(totalSeedsCost)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Charge travail totale cultures</div><div class="kpi-value">${Math.round(totalLaborH)} h</div></div>
      <div class="kpi-card"><div class="kpi-label">Planches en pépinière / semis direct</div><div class="kpi-value">${state.plots.length} lots</div></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">📅 Diagramme de Gantt Semis → Pépinière → Culture → Récolte</h3>
      </div>
      <div>
        ${state.plots.map((p, idx) => {
          const c = getCropById(p.cropId);
          const seedCount = Math.round(p.areaM2 * c.seedsPerM2);
          const startPct = Math.min(60, (idx * 9) % 45);
          const nurseryW = c.nurseryDays > 0 ? Math.max(8, Math.round((c.nurseryDays / 180) * 100)) : 0;
          const fieldW = Math.max(18, Math.round((c.daysToHarvest / 180) * 100));
          return `
            <div class="gantt-row">
              <div>
                <strong>${c.icon} ${esc(p.id)} · ${esc(c.name)}</strong>
                <div class="muted">${seedCount.toLocaleString("fr-FR")} graines · ${Math.round((p.areaM2 / 100) * c.laborHoursPer100m2)} h MO</div>
              </div>
              <div class="gantt-track">
                ${nurseryW ? `<div class="gantt-bar" style="left:${startPct}%;width:${nurseryW}%;background:#38bdf8;">Pépinière ${c.nurseryDays}j</div>` : ""}
                <div class="gantt-bar" style="left:${startPct + nurseryW}%;width:${Math.min(100 - startPct - nurseryW, fieldW)}%;background:${c.color};color:#fff;">
                  Plein champ/Serre (${c.daysToHarvest}j)
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderDiseasesAndProdSection(el, ctx) {
  const { state } = ctx;
  const wx = state.weather.current;

  el.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🩺 Diagnostic Maladies & Pression Météo Live</h3>
          ${pill(`T° ${wx.tempC}°C · HR ${wx.rhPct}%`, wx.rhPct > 80 ? "warn" : "ok")}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:390px;overflow-y:auto;margin-bottom:12px;">
          ${DISEASE_CATALOG.map((d) => {
            const activeCond = wx.tempC >= d.tempMin && wx.tempC <= d.tempMax && wx.rhPct >= d.rhMin;
            return `
              <div style="padding:9px;border-radius:10px;background:var(--bg-soft);border:1px solid ${activeCond ? "rgba(245,158,11,0.55)" : "var(--border)"};">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <strong>${esc(d.name)}</strong>
                  ${pill(activeCond ? "Favorable aujourd'hui !" : "Risque faible", activeCond ? "warn" : "ok")}
                </div>
                <div class="muted">Cibles : ${esc(d.target)} · Seuil : ${d.tempMin}–${d.tempMax}°C, HR ≥ ${d.rhMin}%</div>
                <div style="font-size:12px;margin-top:4px;"><strong>Symptômes :</strong> ${esc(d.symptoms)}</div>
                <div style="font-size:12px;color:#86efac;margin-top:2px;"><strong>Biocontrôle :</strong> ${esc(d.biocontrol)}</div>
              </div>
            `;
          }).join("")}
        </div>

        <form id="form-disease-log" class="form-row">
          <input class="input" name="target" placeholder="Planche / Lot (ex: S1 Tomates)" style="flex:1;" required />
          <select class="input" name="diseaseId" style="width:150px;">
            ${DISEASE_CATALOG.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}
          </select>
          <input class="input" name="actionTaken" placeholder="Traitement / Action" style="flex:1;" required />
          <button class="btn btn-primary btn-sm" type="submit">Journaliser</button>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🧺 Enregistrement & Suivi de Production</h3>
        </div>
        <form id="form-prod-log" class="form-row" style="margin-bottom:12px;">
          <input class="input" name="target" placeholder="Origine (ex: P1 Carottes)" style="flex:1;" required />
          <input class="input" name="qty" type="number" step="0.5" placeholder="Qté" style="width:85px;" required />
          <select class="input" name="unit" style="width:85px;">
            <option value="kg">kg</option>
            <option value="œufs">œufs</option>
            <option value="bottes">bottes</option>
            <option value="L">L</option>
          </select>
          <input class="input" name="valueEur" type="number" placeholder="Valeur €" style="width:95px;" required />
          <button class="btn btn-primary btn-sm" type="submit">+ Récolte</button>
        </form>

        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Origine</th><th>Quantité</th><th>Valeur</th></tr></thead>
            <tbody>
              ${state.productionLogs.slice(0, 12).map((l) => `
                <tr>
                  <td>${esc(l.date)}</td>
                  <td>${esc(l.target)}</td>
                  <td><strong>${l.qty} ${esc(l.unit)}</strong></td>
                  <td>${fmtEur(l.valueEur)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  el.querySelector("#form-disease-log").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.diseaseLogs.unshift({
      id: `DIS-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      target: fd.get("target"),
      diseaseId: fd.get("diseaseId"),
      severity: "Observée",
      actionTaken: fd.get("actionTaken"),
    });
    ctx.toast("Observation sanitaire enregistrée !");
    ctx.save();
    ctx.rerender();
  });

  el.querySelector("#form-prod-log").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const val = Number(fd.get("valueEur")) || 0;
    state.productionLogs.unshift({
      id: `PROD-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      target: fd.get("target"),
      qty: Number(fd.get("qty")),
      unit: fd.get("unit"),
      valueEur: val,
    });
    state.finances.ledger.unshift({
      id: `TX-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      type: "recette",
      atelier: "Production",
      label: `Récolte ${fd.get("target")}`,
      amount: val,
    });
    ctx.toast("Récolte ajoutée au journal et à la trésorerie !");
    ctx.save();
    ctx.rerender();
  });
}
