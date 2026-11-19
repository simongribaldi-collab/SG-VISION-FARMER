import { computeGrangesFinancialPlan } from "../data/presets.js";
import { getCropById, SCENARIOS, simulateFuture } from "../engine/predictor.js";
import { esc, fmtEur, kpiCard, pill, renderLineChartSvg } from "./components.js";

function renderProjectPlanSection(projectPlan) {
  const deferred24m = projectPlan.loan?.deferred24m !== false;
  const calc = computeGrangesFinancialPlan({ deferred24m });
  const idInfo = projectPlan.identity || {};
  const fin = projectPlan.financing || {};
  const workshops = projectPlan.workshopsTarget2031 || [];
  const barriers = projectPlan.barriers || [];
  const meetings = projectPlan.meetings || [];

  return `
    <div class="card" style="margin-bottom:14px;border:1px solid rgba(234,179,8,0.45);background:linear-gradient(135deg, rgba(234,179,8,0.08), rgba(15,23,42,0.72));">
      <div class="card-header">
        <div>
          <h3 class="card-title">📋 Dossier Reprise & Plan Financier — Granges-les-Beaumont (EARL à l'IR)</h3>
          <div class="muted" style="font-size:12px;margin-top:3px;">
            ${esc(idInfo.cadastralSummary || "ZE 309 + ZE 375 (1,65 ha)")} · ${esc(idInfo.legalStructure || "EARL à l'IR")} · Cible SAFER <strong>${fmtEur(idInfo.saferTargetPriceEur || 195000)}</strong> (plafond ≤ ${fmtEur(idInfo.saferHardCeilingEur || 200000)})
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${pill(`Trésorerie 01/01/2028 : +${fmtEur(fin.netCashJan2028Eur || 9700)}`, "ok")}
          <select class="input" id="sel-loan-mode" style="width:270px;">
            <option value="deferred" ${deferred24m ? "selected" : ""}>Prêt 185 116 € · Différé 24 m (2 + 18 ans) [Recommandé]</option>
            <option value="nodef" ${!deferred24m ? "selected" : ""}>Alternative · Sans différé (20 ans linéaire)</option>
          </select>
        </div>
      </div>

      <div class="grid-4" style="margin-bottom:14px;">
        ${kpiCard(
          "Mensualité Prêt EARL (185 116 €)",
          `${fmtEur(calc.monthly2829)} / m`,
          deferred24m ? `2028–2029 intérêts seuls · puis ${fmtEur(calc.monthlyPost)}/m (2030–2047)` : `Linéaire 20 ans · ${fmtEur(calc.annualPost)}/an`,
          "ok"
        )}
        ${kpiCard(
          "Couverture Bancaire (EBE 29 000 €)",
          `${calc.coverageNoPh} (hors PH) / ${calc.coverageWithPh} (avec PH)`,
          `Seuil EBE vendeur ratio ≥ 2 : ${fmtEur(calc.minSellerEbeNoPh)} / ${fmtEur(calc.minSellerEbeWithPh)}`,
          calc.coverageNoPh >= 2.0 ? "ok" : "warn"
        )}
        ${kpiCard(
          "Croisière 2031–2033 (1,65 ha)",
          `${fmtEur(calc.cruiseCaEur)} CA`,
          `${calc.cruiseCaPerHaEur.toLocaleString("fr-FR")} €/ha · Marge EBE ${calc.cruiseEbeMarginPct} % · Coût différé ${fmtEur(calc.netDeferredCostEur)}`,
          "ok"
        )}
        ${kpiCard(
          "Transition 2028–2029 (+ARE 60 %)",
          `${fmtEur(calc.tot2829ApIrEur)} nets ap. IR`,
          `${fmtEur(calc.tot2829AvIrEur)} av. IR (${calc.tot2829AvIrMonthly.toLocaleString("fr-FR")} €/m) · Lissage ~${fmtEur(calc.smoothingCushionEur)} vs 72 000 €`,
          "warn"
        )}
      </div>

      <div class="grid-2" style="margin-bottom:14px;">
        <div class="card">
          <div class="card-header">
            <h4 class="card-title">📅 Trajectoire Revenu Net « Cap 3 000 €/mois » (2028–2033)</h4>
            ${pill(deferred24m ? "Option Différé 24 m (2+18)" : "Option Sans différé (20 ans)", "ok")}
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Année</th><th>CA</th><th>EBE</th><th>Dette+PH</th><th>MSA (Exo)</th><th>Net av. IR</th><th>IR 11 %</th><th>Net ap. IR / m</th>
                </tr>
              </thead>
              <tbody>
                ${calc.rows.map((r) => `
                  <tr>
                    <td><strong>${r.yr}</strong></td>
                    <td>${fmtEur(r.ca)}</td>
                    <td>${fmtEur(r.ebe)}</td>
                    <td>${fmtEur(r.dettePh)}</td>
                    <td>${fmtEur(r.msa)} <span class="muted">(-${r.exoPct}%)</span></td>
                    <td><strong>${fmtEur(r.netAvIrM)}/m</strong> <span class="muted">(${fmtEur(r.netAvIrAn)})</span></td>
                    <td>${fmtEur(r.ir11)}</td>
                    <td>${pill(`${fmtEur(r.netApIrM)}/m`, r.netApIrM >= 2950 ? "ok" : r.netApIrM >= 2400 ? "warn" : "bad")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="muted" style="font-size:12px;margin-top:8px;">
            Avec ARE 60 % (<strong>${fmtEur(calc.are60Eur)}</strong> = 9 mois), le cumul 2028–2029 atteint <strong>${fmtEur(calc.tot2829AvIrEur)}</strong> avant IR (${calc.tot2829AvIrMonthly.toLocaleString("fr-FR")} €/m, écart ${calc.gap2829AvIrEur.toLocaleString("fr-FR")} €) et <strong>${fmtEur(calc.tot2829ApIrEur)}</strong> après IR 11 % CGI 73 B (${calc.tot2829ApIrMonthly.toLocaleString("fr-FR")} €/m, écart ${calc.gap2829ApIrEur.toLocaleString("fr-FR")} € vs objectif 72 000 €).
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h4 class="card-title">📈 Évolution Revenu Mensuel Net vs Seuil 3 000 €/mois</h4>
          </div>
          ${renderLineChartSvg(
            [
              { label: "Net avant IR (€/mois)", color: "#22c55e", values: calc.rows.map((r) => r.netAvIrM) },
              { label: "Net après IR 11% (€/mois)", color: "#38bdf8", values: calc.rows.map((r) => r.netApIrM) },
              { label: "Cap vital 3 000 €/mois", color: "#eab308", values: calc.rows.map(() => 3000) },
            ],
            calc.rows.map((r) => String(r.yr))
          )}
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:14px;">
        <div class="card">
          <div class="card-header">
            <h4 class="card-title">🏦 Plan de Financement Démarrage (Zéro Double Comptage)</h4>
            ${pill(`Trésorerie 01/01/2028 : +${fmtEur(fin.netCashJan2028Eur || 9700)}`, "ok")}
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Poste (2027–2028)</th><th>Besoins</th><th>Ressources</th></tr></thead>
              <tbody>
                ${(fin.rows || []).map((row) => `
                  <tr>
                    <td>${esc(row.label)}</td>
                    <td>${row.besoin ? fmtEur(row.besoin) : "—"}</td>
                    <td>${row.ressource ? fmtEur(row.ressource) : "—"}</td>
                  </tr>
                `).join("")}
                <tr>
                  <td><strong>Total démarrage</strong></td>
                  <td><strong>${fmtEur(fin.totalNeedsEur || 213500)}</strong></td>
                  <td><strong>${fmtEur(fin.totalResourcesEur || 223200)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="muted" style="font-size:12px;margin-top:8px;">
            <strong>Phase 2 (2029–2030 hors base) :</strong> ${(fin.phase2Bonus || []).map((b) => esc(b)).join(" · ")}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h4 class="card-title">🎯 Ateliers Cibles Croisière 2031–2033 (135 900 € CA)</h4>
            ${pill("Marge EBE 49,4 %", "ok")}
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Atelier</th><th>CA Cible</th><th>Repère</th></tr></thead>
              <tbody>
                ${workshops.map((w) => `
                  <tr>
                    <td><strong>${esc(w.name)}</strong></td>
                    <td><strong>${fmtEur(w.caEur)}</strong></td>
                    <td class="muted">${esc(w.note)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h4 class="card-title">🛡️ 4 Barrières Non Négociables (Go / No-Go)</h4>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px;">
            ${barriers.map((b) => `
              <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;">
                <input type="checkbox" class="chk-project-barrier" data-barrier-id="${esc(b.id)}" ${b.checked ? "checked" : ""} />
                <span>${esc(b.label)}</span>
              </label>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h4 class="card-title">🗂️ Checklist des 4 Rendez-vous Clés</h4>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px;">
            ${meetings.map((m) => `
              <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;">
                <input type="checkbox" class="chk-project-meeting" data-meeting-id="${esc(m.id)}" ${m.done ? "checked" : ""} />
                <span><strong>${esc(m.actor)} :</strong> ${esc(m.points)}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderViewForecastFinance(container, ctx) {
  const { state, uiState } = ctx;
  const horizon = uiState.forecastHorizon || 60;
  const scenarioId = state.simulation.scenario || "normal";
  const sim = simulateFuture(state, horizon, scenarioId);
  state.farm.gamification.simulatedFutureUsed = true;

  const totalLedgerIn = state.finances.ledger.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const totalLedgerOut = state.finances.ledger.filter((t) => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0);

  const stockAlerts = Object.entries(sim.stockoutDays)
    .filter(([, day]) => day !== null)
    .map(([key, day]) => `${key.toUpperCase()} à J+${day}`);

  container.innerHTML = `
    ${state.projectPlan ? renderProjectPlanSection(state.projectPlan) : ""}
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header">
        <h3 class="card-title">🔮 Simulateur « Prévoir l'avenir » & Labo Scénarios What-If</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <select class="input" id="sel-horizon" style="width:140px;">
            ${[14, 30, 60, 90, 180, 365].map((d) => `<option value="${d}" ${horizon === d ? "selected" : ""}>Horizon +${d} j</option>`).join("")}
          </select>
          <select class="input" id="sel-scenario" style="width:280px;">
            ${SCENARIOS.map((s) => `<option value="${s.id}" ${scenarioId === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="grid-4">
        ${kpiCard(`CA Prévu (+${horizon} j)`, fmtEur(sim.totals.revenueEur), `Récoltes ${sim.totals.harvestKg} kg · ${sim.totals.eggsCount} œufs`, "ok")}
        ${kpiCard(`Marge Nette (+${horizon} j)`, fmtEur(sim.totals.netMarginEur), `Charges estimées ${fmtEur(sim.totals.costEur)}`, sim.totals.netMarginEur >= 0 ? "ok" : "bad")}
        ${kpiCard(`Trésorerie à J+${horizon}`, fmtEur(sim.totals.endCashEur), `Départ ${fmtEur(state.finances.cashBalance)}`, sim.totals.endCashEur >= 5000 ? "ok" : "warn")}
        ${kpiCard("Ruptures & Risque Maladie", stockAlerts.length ? stockAlerts.join(" · ") : "Zéro rupture ✅", `Pic risque sanitaire : ${sim.totals.peakDiseaseRisk}%`, stockAlerts.length || sim.totals.peakDiseaseRisk > 55 ? "warn" : "ok")}
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:14px;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">💶 Trajectoire de Trésorerie & Revenus (+${horizon} jours)</h3>
        </div>
        ${renderLineChartSvg(
          [
            { label: "Trésorerie cumulée (€)", color: "#22c55e", values: sim.daily.map((d) => d.cashBalance) },
          ],
          sim.daily.map((d) => d.date)
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">💧 Réserve Eau (m³) & Pic Risque Maladie (%)</h3>
        </div>
        ${renderLineChartSvg(
          [
            { label: "Eau en cuves/bassin (m³)", color: "#38bdf8", values: sim.daily.map((d) => d.waterStockM3) },
            { label: "Risque maladie max (%)", color: "#f43f5e", values: sim.daily.map((d) => d.maxDiseaseRisk) },
          ],
          sim.daily.map((d) => d.date)
        )}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📊 Rentabilité Prévisionnelle par Planche / Serre</h3>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Planche</th><th>Culture</th><th>Récolte Est.</th><th>CA Est.</th><th>€/h Travail</th></tr></thead>
            <tbody>
              ${state.plots.map((p) => {
                const c = getCropById(p.cropId);
                const kg = Math.round(p.areaM2 * c.yieldKgPerM2 * (p.healthPct / 100));
                const rev = Math.round(kg * c.pricePerKg);
                const hrs = Math.max(1, (p.areaM2 / 100) * c.laborHoursPer100m2);
                const eurPerH = Math.round(rev / hrs);
                return `
                  <tr>
                    <td><strong>${esc(p.id)}</strong> · ${esc(p.name)}</td>
                    <td>${c.icon} ${esc(c.name)}</td>
                    <td>${kg.toLocaleString("fr-FR")} kg</td>
                    <td><strong>${fmtEur(rev)}</strong></td>
                    <td>${pill(`${eurPerH} €/h`, eurPerH >= 35 ? "ok" : "warn")}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📒 Journal Financier & Trésorerie</h3>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" id="btn-export-csv">⬇ CSV</button>
            <button class="btn btn-sm" id="btn-export-json">⬇ Backup JSON</button>
          </div>
        </div>
        <div class="muted" style="margin-bottom:8px;">
          Trésorerie actuelle : <strong>${fmtEur(state.finances.cashBalance)}</strong> · Recettes journal : <span style="color:#4ade80;">+${fmtEur(totalLedgerIn)}</span> · Dépenses : <span style="color:#fda4af;">-${fmtEur(totalLedgerOut)}</span>
        </div>

        <form id="form-add-tx" class="form-row" style="margin-bottom:10px;">
          <select class="input" name="type" style="width:105px;">
            <option value="recette">Recette (+)</option>
            <option value="charge">Charge (-)</option>
          </select>
          <input class="input" name="atelier" placeholder="Atelier" value="Vente directe" style="width:120px;" />
          <input class="input" name="label" placeholder="Libellé écriture" style="flex:1;" required />
          <input class="input" name="amount" type="number" placeholder="€" style="width:85px;" required />
          <button class="btn btn-primary btn-sm" type="submit">+ Saisir</button>
        </form>

        <div class="table-wrap" style="max-height:240px;overflow-y:auto;">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Atelier</th><th>Libellé</th><th>Montant</th></tr></thead>
            <tbody>
              ${state.finances.ledger.slice(0, 15).map((tx) => `
                <tr>
                  <td>${esc(tx.date)}</td>
                  <td>${esc(tx.atelier)}</td>
                  <td>${esc(tx.label)}</td>
                  <td style="color:${tx.amount >= 0 ? "#4ade80" : "#fda4af"};font-weight:700;">${tx.amount >= 0 ? "+" : ""}${fmtEur(tx.amount)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#sel-horizon").addEventListener("change", (e) => {
    uiState.forecastHorizon = Number(e.target.value);
    ctx.rerender();
  });

  container.querySelector("#sel-scenario").addEventListener("change", (e) => {
    state.simulation.scenario = e.target.value;
    ctx.save();
    ctx.rerender();
  });

  container.querySelector("#form-add-tx").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const raw = Math.abs(Number(fd.get("amount")) || 0);
    const signed = fd.get("type") === "charge" ? -raw : raw;
    state.finances.ledger.unshift({
      id: `TX-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      type: fd.get("type"),
      atelier: fd.get("atelier"),
      label: fd.get("label"),
      amount: signed,
    });
    state.finances.cashBalance += signed;
    ctx.toast("Écriture financière ajoutée !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelector("#btn-export-csv").addEventListener("click", () => {
    const rows = ["Date;Type;Atelier;Libelle;Montant_EUR", ...state.finances.ledger.map((t) => `${t.date};${t.type};${t.atelier};"${t.label}";${t.amount}`)];
    downloadFile("sg-vision-farmer-finances.csv", rows.join("\n"), "text/csv;charset=utf-8");
  });

  container.querySelector("#btn-export-json").addEventListener("click", () => {
    downloadFile("sg-vision-farmer-backup.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
  });

  const selLoan = container.querySelector("#sel-loan-mode");
  if (selLoan && state.projectPlan) {
    selLoan.addEventListener("change", (e) => {
      state.projectPlan.loan = state.projectPlan.loan || {};
      state.projectPlan.loan.deferred24m = e.target.value === "deferred";
      ctx.toast(`Option prêt mise à jour : ${state.projectPlan.loan.deferred24m ? "Différé 24 mois (2 + 18 ans)" : "Sans différé (20 ans)"}`);
      ctx.save();
      ctx.rerender();
    });
  }

  container.querySelectorAll(".chk-project-barrier").forEach((chk) => {
    chk.addEventListener("change", () => {
      const item = (state.projectPlan?.barriers || []).find((b) => b.id === chk.dataset.barrierId);
      if (item) {
        item.checked = chk.checked;
        ctx.save();
      }
    });
  });

  container.querySelectorAll(".chk-project-meeting").forEach((chk) => {
    chk.addEventListener("change", () => {
      const item = (state.projectPlan?.meetings || []).find((m) => m.id === chk.dataset.meetingId);
      if (item) {
        item.done = chk.checked;
        ctx.save();
      }
    });
  });
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
