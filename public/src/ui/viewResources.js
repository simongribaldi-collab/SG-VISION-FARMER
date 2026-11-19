import { esc, fmtEur, kpiCard, pill, progressBar, renderLineChartSvg } from "./components.js";

export function renderViewResources(container, ctx) {
  const { state, forecast } = ctx;
  const totalStaffHoursWeek = state.staff.reduce((a, s) => a + s.weeklyHours, 0);
  const humanNeedWeek = Number((forecast.totals.avgHumanHoursDay * 7).toFixed(1));
  const robotSavedWeek = Number((forecast.totals.avgRobotHoursDay * 7).toFixed(1));
  const workloadDelta = Number((humanNeedWeek - totalStaffHoursWeek).toFixed(1));

  const lowStocks = state.resources.filter((r) => r.stock <= r.reorderPoint);

  container.innerHTML = `
    <div class="grid-4" style="margin-bottom:14px;">
      ${kpiCard("Alertes Approvisionnement", `${lowStocks.length} seuils`, lowStocks.length ? lowStocks.map((l) => l.category).join(", ") : "Tous stocks confortables", lowStocks.length ? "warn" : "ok")}
      ${kpiCard("Capacité Équipe / sem.", `${totalStaffHoursWeek} h`, `${state.staff.length} personnes actives`, "info")}
      ${kpiCard("Besoin Travail Calculé", `${humanNeedWeek} h/sem`, `Robots économisent ${robotSavedWeek} h/sem`, workloadDelta > 0 ? "warn" : "ok")}
      ${kpiCard("Balance Énergie (J+0)", `${forecast.daily[0].netEnergyKwh >= 0 ? "+" : ""}${forecast.daily[0].netEnergyKwh} kWh`, `PV ${forecast.daily[0].solarKwh} + Éolien ${forecast.daily[0].windKwh} kWh`, forecast.daily[0].netEnergyKwh >= 0 ? "ok" : "warn")}
    </div>

    <div class="grid-2" style="margin-bottom:14px;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📦 Ressources & Approvisionnements (Eau, Élec, Semences, Aliments, Agrofournitures)</h3>
          <button class="btn btn-primary btn-sm" id="btn-restock-low">🛒 Réapprovisionner seuils bas</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:12px;">
          ${state.resources.map((r) => {
            const pct = Math.round((r.stock / Math.max(1, r.max)) * 100);
            const daysLeft = r.dailyUse > 0 ? Math.floor(r.stock / r.dailyUse) : 999;
            const isLow = r.stock <= r.reorderPoint;
            const barColor = isLow ? "#f59e0b" : pct > 60 ? "#22c55e" : "#38bdf8";
            return `
              <div style="padding:9px;border-radius:10px;background:var(--bg-soft);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong>${esc(r.name)}</strong>
                  <div style="display:flex;gap:6px;align-items:center;">
                    ${pill(`${r.stock} / ${r.max} ${r.unit}`, isLow ? "warn" : "ok")}
                    ${pill(`Autonomie ~${daysLeft} j`, daysLeft < 10 ? "bad" : "info")}
                    <button class="btn btn-sm" data-restock-id="${r.id}">+25%</button>
                  </div>
                </div>
                <div class="muted" style="margin:4px 0 6px;">Catégorie : ${esc(r.category)} · Conso : ${r.dailyUse} ${r.unit}/j · Seuil commande : ${r.reorderPoint} ${r.unit}</div>
                ${progressBar(pct, barColor)}
              </div>
            `;
          }).join("")}
        </div>

        <form id="form-add-resource" class="form-row">
          <input class="input" name="name" placeholder="Nouvel intrant / agrofourniture" style="flex:1;" required />
          <select class="input" name="category" style="width:130px;">
            <option>Agrofourniture</option>
            <option>Semences</option>
            <option>Alimentation</option>
            <option>Eau</option>
            <option>Électricité</option>
          </select>
          <input class="input" name="stock" type="number" value="100" style="width:80px;" required />
          <input class="input" name="unit" value="kg" style="width:65px;" required />
          <button class="btn btn-primary btn-sm" type="submit">+ Stock</button>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">👷 Besoins en Personnel & Équilibre Humain / Robot</h3>
          ${workloadDelta > 0 ? pill(`Déficit ${workloadDelta} h/sem`, "warn") : pill("Charge maîtrisée", "ok")}
        </div>
        <div class="table-wrap" style="margin-bottom:12px;">
          <table class="data-table">
            <thead><tr><th>Profil</th><th>Rôle</th><th>Heures/sem</th><th>Coût/h</th><th>Action</th></tr></thead>
            <tbody>
              ${state.staff.map((s) => `
                <tr>
                  <td><strong>${esc(s.name)}</strong></td>
                  <td>${esc(s.role)}</td>
                  <td>${s.weeklyHours} h</td>
                  <td>${s.hourlyCost} €/h</td>
                  <td><button class="btn btn-danger btn-sm" data-del-staff="${s.id}">×</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <form id="form-add-staff" class="form-row" style="margin-bottom:14px;">
          <input class="input" name="name" placeholder="Ex: Saisonnier Récolte Été" style="flex:1;" required />
          <input class="input" name="role" placeholder="Poste" value="Renfort terrain" style="width:130px;" />
          <input class="input" name="weeklyHours" type="number" value="35" style="width:70px;" required />
          <input class="input" name="hourlyCost" type="number" step="0.5" value="16" style="width:70px;" required />
          <button class="btn btn-primary btn-sm" type="submit">+ Personnel</button>
        </form>

        <h4 style="margin:6px 0;">⚡ Projection Énergie Solaire + Éolienne vs Consommation</h4>
        ${renderLineChartSvg(
          [
            { label: "Production EnR (kWh/j)", color: "#22c55e", values: forecast.daily.map((d) => Number((d.solarKwh + d.windKwh).toFixed(1))) },
            { label: "Consommation (kWh/j)", color: "#f59e0b", values: forecast.daily.map((d) => d.consumedKwh) },
          ],
          forecast.daily.map((d) => d.date)
        )}
      </div>
    </div>
  `;

  container.querySelectorAll("[data-restock-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = state.resources.find((x) => x.id === btn.dataset.restockId);
      if (!r) return;
      const add = Math.max(1, Math.round(r.max * 0.25));
      const newStock = Math.min(r.max, r.stock + add);
      const cost = Math.round((newStock - r.stock) * r.unitCost);
      r.stock = newStock;
      if (cost > 0) {
        state.finances.ledger.unshift({
          id: `TX-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          type: "charge",
          atelier: "Approvisionnement",
          label: `Réappro ${r.name} (+${add} ${r.unit})`,
          amount: -cost,
        });
        state.finances.cashBalance = (state.finances.cashBalance || 0) - cost;
      }
      ctx.toast(`Stock ${r.name} réapprovisionné (${fmtEur(cost)})`);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#btn-restock-low").addEventListener("click", () => {
    let totalCost = 0;
    let count = 0;
    state.resources.forEach((r) => {
      if (r.stock <= r.reorderPoint) {
        const diff = Math.max(0, r.max * 0.8 - r.stock);
        r.stock = Math.round(r.stock + diff);
        totalCost += Math.round(diff * r.unitCost);
        count++;
      }
    });
    if (count > 0 && totalCost > 0) {
      state.finances.ledger.unshift({
        id: `TX-${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        type: "charge",
        atelier: "Approvisionnement",
        label: `Commande groupée (${count} lignes)`,
        amount: -totalCost,
      });
      state.finances.cashBalance = (state.finances.cashBalance || 0) - totalCost;
    }
    ctx.toast(count ? `${count} stock(s) complété(s) pour ${fmtEur(totalCost)}` : "Aucun stock sous le seuil d'alerte !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelector("#form-add-resource").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const stock = Number(fd.get("stock")) || 50;
    state.resources.push({
      id: `RES-${Date.now()}`,
      name: fd.get("name"),
      category: fd.get("category"),
      unit: fd.get("unit"),
      stock,
      max: stock * 2,
      dailyUse: Math.max(0.5, Number((stock / 45).toFixed(1))),
      unitCost: 2.5,
      reorderPoint: Math.round(stock * 0.3),
    });
    ctx.toast("Nouvelle ressource ajoutée !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelector("#form-add-staff").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.staff.push({
      id: `ST-${Date.now()}`,
      name: fd.get("name"),
      role: fd.get("role"),
      weeklyHours: Number(fd.get("weeklyHours")) || 35,
      hourlyCost: Number(fd.get("hourlyCost")) || 16,
    });
    ctx.toast("Membre d'équipe ajouté au planning !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-del-staff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.staff = state.staff.filter((s) => s.id !== btn.dataset.delStaff);
      ctx.save();
      ctx.rerender();
    });
  });
}
