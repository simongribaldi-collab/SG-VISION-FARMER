import { ANIMAL_SPECIES } from "../data/presets.js";
import { toggleCoopDoor } from "../engine/automation.js";
import { esc, fmtEur, kpiCard, pill, progressBar, renderLineChartSvg } from "./components.js";

function getSpeciesMeta(lot) {
  return (
    ANIMAL_SPECIES.find((s) => s.id === lot.speciesId) ||
    (lot.kind === "ponte" ? ANIMAL_SPECIES[0] : ANIMAL_SPECIES[2])
  );
}

export function renderViewLivestock(container, ctx) {
  const { state, forecast } = ctx;
  const layingLots = state.livestock.filter((l) => l.kind === "ponte");
  const herdLots = state.livestock.filter((l) => l.kind === "elevage");

  const totalHens = layingLots.reduce((a, l) => a + l.count, 0);
  const totalEggsDay = layingLots.reduce((a, l) => a + (l.eggsToday || Math.round((l.count * l.layingRatePct) / 100)), 0);
  const totalAnimals = state.livestock.reduce((a, l) => a + l.count, 0);
  const feedDailyKg = state.livestock.reduce((a, l) => a + (l.count * l.feedGramsPerDay) / 1000, 0);

  container.innerHTML = `
    <div class="grid-4" style="margin-bottom:14px;">
      ${kpiCard("Effectif total cheptel", totalAnimals.toLocaleString("fr-FR"), `${state.livestock.length} lots actifs (visibles en 3D)`, "ok")}
      ${kpiCard("Ponte du jour", `${totalEggsDay.toLocaleString("fr-FR")} œufs`, totalHens ? `${Math.round((totalEggsDay / totalHens) * 100)} % taux moyen` : "Aucun lot ponte", "ok")}
      ${kpiCard("Ration journalière", `${Math.round(feedDailyKg)} kg/j`, "Céréales, fourrage & compléments", "info")}
      ${kpiCard("Œufs prévus (+H)", forecast.totals.eggsCount.toLocaleString("fr-FR"), `Horizon ${forecast.horizonDays} jours`, "ok")}
    </div>

    <div class="grid-2" style="margin-bottom:14px;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🥚 Élevage de Ponte, Volailles & Poulaillers Connectés</h3>
          <button class="btn btn-primary btn-sm" id="btn-coop-all">🚪 Basculer Trappes</button>
        </div>
        ${layingLots.length === 0 ? `<div class="muted">Aucun lot de ponte. Ajoutez-en un ci-dessous !</div>` : ""}
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${layingLots.map((l) => {
            const sp = getSpeciesMeta(l);
            const eggs = l.eggsToday || Math.round((l.count * l.layingRatePct) / 100);
            const calS = Math.round(eggs * 0.12);
            const calM = Math.round(eggs * 0.46);
            const calL = Math.round(eggs * 0.34);
            const calXL = Math.max(0, eggs - calS - calM - calL);
            return `
              <div style="padding:11px;border-radius:11px;background:var(--bg-soft);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong>${sp.icon} ${esc(l.name)} (${l.count} sujets · ${l.ageWeeks} sem.)</strong>
                  ${pill(l.doorOpen ? "Trappe OUVERTE" : "Trappe FERMÉE", l.doorOpen ? "ok" : "warn")}
                </div>
                <div class="grid-3" style="gap:8px;margin:8px 0;">
                  <div>Taux de ponte : <strong>${l.layingRatePct}%</strong></div>
                  <div>Œufs/j : <strong>${eggs}</strong> (${fmtEur(eggs * (l.eggPriceUnit || 0.38))})</div>
                  <div>Bien-être : <strong>${l.welfarePct}%</strong> · Lumière ${esc(l.lightSchedule)}</div>
                </div>
                <div class="muted" style="margin-bottom:6px;">
                  Calibres estimés : S (${calS}) · M (${calM}) · L (${calL}) · XL (${calXL}) · Risque pou rouge : ${l.parasiteRiskPct}%
                </div>
                ${progressBar(l.layingRatePct, "#f59e0b")}
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                  <button class="btn btn-sm" data-coop-toggle="${l.id}">🚪 ${l.doorOpen ? "Fermer trappe" : "Ouvrir trappe"}</button>
                  <button class="btn btn-primary btn-sm" data-collect-eggs="${l.id}">🧺 Collecter ${eggs} œufs</button>
                  <button class="btn btn-danger btn-sm" data-del-lot="${l.id}">🗑️</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🐄 Élevage Multi-Espèces & Pâturage Tournant 3D</h3>
        </div>
        ${herdLots.length === 0 ? `<div class="muted" style="margin-bottom:10px;">Aucun troupeau herbivore configuré (ajoutez-en un ci-dessous).</div>` : ""}
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;">
          ${herdLots.map((h) => {
            const sp = getSpeciesMeta(h);
            return `
              <div style="padding:11px;border-radius:11px;background:var(--bg-soft);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                  <strong>${sp.icon} ${esc(h.name)} (${h.count} têtes · ${esc(sp.label)})</strong>
                  ${pill(h.paddockName, "ok")}
                </div>
                <div class="muted" style="margin:6px 0;">
                  Eau : ${Math.round(h.count * h.waterLitersPerDay)} L/j · Ration : ${Math.round((h.count * h.feedGramsPerDay) / 1000)} kg MS/j · Bien-être : ${h.welfarePct}%
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="btn btn-sm" data-rotate-paddock="${h.id}">🔄 Changer de Paddock</button>
                  <button class="btn btn-danger btn-sm" data-del-lot="${h.id}">🗑️ Retirer</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <h4 style="margin:8px 0;">📈 Prévision de ponte (horizon ${forecast.horizonDays} j)</h4>
        ${renderLineChartSvg(
          [{ label: "Œufs / jour", color: "#f59e0b", values: forecast.daily.map((d) => d.eggsCount) }],
          forecast.daily.map((d) => d.date)
        )}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">➕ Ajouter une Espèce Animale au Cheptel (Modélisée dans le Jumeau 3D)</h3>
      </div>
      <form id="form-add-livestock" class="form-row">
        <label class="field" style="flex:1;min-width:190px;">
          Nom du lot / troupeau
          <input class="input" name="name" placeholder="Ex: Troupeau Chèvres Alpines / Lot Poules Marans" required />
        </label>
        <label class="field" style="width:230px;">
          Espèce (apparence 3D dédiée)
          <select class="input" name="speciesId">
            ${ANIMAL_SPECIES.map((s) => `<option value="${s.id}">${s.icon} ${esc(s.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field" style="width:105px;">
          Effectif
          <input class="input" type="number" name="count" value="25" min="1" required />
        </label>
        <label class="field" style="width:115px;">
          Taux ponte %
          <input class="input" type="number" name="layingRatePct" value="88" min="0" max="100" />
        </label>
        <button class="btn btn-primary" type="submit">Ajouter au cheptel & 3D</button>
      </form>
    </div>
  `;

  container.querySelector("#btn-coop-all").addEventListener("click", () => {
    const res = toggleCoopDoor(state);
    ctx.toast(res.message);
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-coop-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = toggleCoopDoor(state, btn.dataset.coopToggle);
      ctx.toast(res.message);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelectorAll("[data-collect-eggs]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lot = state.livestock.find((l) => l.id === btn.dataset.collectEggs);
      if (!lot) return;
      const eggs = lot.eggsToday || Math.round((lot.count * lot.layingRatePct) / 100);
      const rev = Math.round(eggs * (lot.eggPriceUnit || 0.38));
      state.productionLogs.unshift({
        id: `PROD-${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        target: lot.name,
        qty: eggs,
        unit: "œufs",
        valueEur: rev,
      });
      state.finances.ledger.unshift({
        id: `TX-${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        type: "recette",
        atelier: "Élevage de ponte",
        label: `Collecte ${lot.name} (${eggs} œufs)`,
        amount: rev,
      });
      state.finances.cashBalance = (state.finances.cashBalance || 0) + rev;
      ctx.toast(`+${eggs} œufs enregistrés (+${rev} €) !`);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelectorAll("[data-rotate-paddock]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lot = state.livestock.find((l) => l.id === btn.dataset.rotatePaddock);
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

  container.querySelectorAll("[data-del-lot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.livestock = state.livestock.filter((l) => l.id !== btn.dataset.delLot);
      ctx.toast("Lot retiré du cheptel.");
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#form-add-livestock").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const speciesId = fd.get("speciesId") || "bovin_lait";
    const sp = ANIMAL_SPECIES.find((s) => s.id === speciesId) || ANIMAL_SPECIES[0];
    const isPonte = speciesId === "ponte" || speciesId === "canard";
    const kind = isPonte ? "ponte" : "elevage";
    const count = Number(fd.get("count")) || 20;
    const rate = Number(fd.get("layingRatePct")) || (speciesId === "canard" ? 45 : 85);
    const linkedStruct = isPonte
      ? state.structures.find((s) => s.type === "coop_mobile" || s.type === "coop_fixed")
      : state.structures.find((s) => s.type === "barn_livestock" || s.type === "paddock");

    state.livestock.push({
      id: `LOT-${Date.now()}`,
      kind,
      speciesId,
      name: fd.get("name"),
      species: sp.label,
      count,
      ageWeeks: 28,
      layingRatePct: isPonte ? rate : 0,
      eggsToday: isPonte ? Math.round((count * rate) / 100) : 0,
      eggPriceUnit: speciesId === "canard" ? 0.55 : 0.38,
      feedGramsPerDay: sp.defaultFeedG,
      waterLitersPerDay: sp.defaultWaterL,
      welfarePct: 95,
      doorOpen: true,
      lightSchedule: isPonte ? "06:00 - 20:30" : "Naturel",
      paddockName: "Parcours Paddock A",
      coopStructureId: linkedStruct?.id || null,
      parasiteRiskPct: 7,
    });
    ctx.toast(`${sp.icon} ${sp.label} ajouté au cheptel et visible en 3D !`);
    ctx.save();
    ctx.rerender();
  });
}
