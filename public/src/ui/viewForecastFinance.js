import { getCropById, SCENARIOS, simulateFuture } from "../engine/predictor.js";
import { esc, fmtEur, kpiCard, pill, renderLineChartSvg } from "./components.js";

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
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
