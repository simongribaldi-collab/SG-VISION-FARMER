import { CROP_CATALOG } from "../data/presets.js";
import { dispatchRobot, pushHudAlert, setGreenhouseVent, toggleCoopDoor, toggleIrrigation } from "./automation.js";
import { evaluateRotation } from "./predictor.js";

function findPlotInText(state, textLow) {
  return (
    state.plots.find(
      (p) =>
        textLow.includes(p.id.toLowerCase()) ||
        textLow.includes(p.name.toLowerCase()) ||
        (p.zone === "Serre" && textLow.includes("serre"))
    ) || state.plots[0]
  );
}

/**
 * Parseur intelligent & assistant agronomique 100 % autonome (hors-ligne + commandes vocales/lunettes).
 */
export function processNaturalCommand(state, rawText, forecastSnapshot) {
  const text = (rawText || "").trim();
  const low = text.toLowerCase();
  if (!text) return { reply: "Posez une question ou donnez une consigne (ex: « Envoie le rover sur P2 », « Quels risques à 30 jours ? »).", mutated: false };

  // 1) Commandes d'action directe (Robot / Serre / Irrigation / Poulailler / Recolte)
  if (/(envoie|deploie|déploie|lance|pilote).*(rover|robot|drone|tracteur)/i.test(low)) {
    const bot =
      low.includes("drone")
        ? state.equipment.find((e) => e.kind === "drone")
        : low.includes("tracteur")
          ? state.equipment.find((e) => e.kind === "tractor")
          : state.equipment.find((e) => e.kind === "rover");
    const target = findPlotInText(state, low);
    if (bot && target) {
      const res = dispatchRobot(state, bot.id, target.id, `Ordre IA/Voix sur ${target.id}`);
      return { reply: `🤖 ${res.message}`, mutated: true };
    }
  }

  if (/(rappelle|stop|pause|rentre).*(rover|robot|drone|tracteur)/i.test(low)) {
    const bot = state.equipment.find((e) => e.autonomous && e.status === "working") || state.equipment.find((e) => e.autonomous);
    if (bot) {
      const res = dispatchRobot(state, bot.id, null);
      return { reply: `🤖 ${res.message}`, mutated: true };
    }
  }

  if (/(arrose|irrigue|ouvre.*vanne|coupe.*arrosage|ferme.*vanne)/i.test(low)) {
    const target = findPlotInText(state, low);
    const shouldClose = /(coupe|ferme|arrete|arrête)/i.test(low);
    if (target) {
      const res = toggleIrrigation(state, target.id, !shouldClose);
      return { reply: `💧 ${res.message}`, mutated: true };
    }
  }

  if (/(serre|ouvrant|aere|aère|ventile)/i.test(low) && /(ouvre|ferme|regle|règle|aere|aère)/i.test(low)) {
    const gh = state.plots.find((p) => p.zone === "Serre");
    if (gh) {
      const pctMatch = low.match(/(\d{1,3})\s*%/);
      const pct = low.includes("ferme") ? 0 : pctMatch ? Number(pctMatch[1]) : 75;
      const res = setGreenhouseVent(state, gh.id, pct);
      return { reply: `🏡 ${res.message}`, mutated: true };
    }
  }

  if (/(trappe|poulailler)/i.test(low) && /(ouvre|ferme)/i.test(low)) {
    const open = low.includes("ouvre");
    const res = toggleCoopDoor(state, null, open);
    return { reply: `🐔 ${res.message}`, mutated: true };
  }

  const harvestMatch = low.match(/(?:note|recolte|récolte|ajoute)\s+(\d+(?:[.,]\d+)?)\s*(kg|oeufs|œufs)/i);
  if (harvestMatch) {
    const qty = Number(harvestMatch[1].replace(",", "."));
    const unit = harvestMatch[2].toLowerCase().includes("kg") ? "kg" : "œufs";
    const target = unit === "œufs" ? "Poulailler Ponte" : findPlotInText(state, low)?.name || "Maraîchage";
    const valueEur = Math.round(qty * (unit === "œufs" ? 0.38 : 3.5));
    state.productionLogs.unshift({
      id: `PROD-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      target,
      qty,
      unit,
      valueEur,
    });
    if (state.finances) {
      state.finances.ledger = state.finances.ledger || [];
      state.finances.ledger.unshift({
        id: `TX-${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        type: "recette",
        atelier: unit === "œufs" ? "Élevage de ponte" : "Production",
        label: `Récolte vocale ${target} (${qty} ${unit})`,
        amount: valueEur,
      });
      state.finances.cashBalance = (state.finances.cashBalance || 0) + valueEur;
    }
    pushHudAlert(state, `Production enregistrée : +${qty} ${unit} (${target})`, "info");
    return { reply: `✅ Production enregistrée : ${qty} ${unit} sur ${target} (≈ ${valueEur} €).`, mutated: true };
  }

  // 2) Requetes analytiques & previsions
  if (/(avenir|prevoi|prévoi|futur|demain|semaine|30 jours|simulation|tendance)/i.test(low)) {
    const t = forecastSnapshot.totals;
    const stockNotes = Object.entries(forecastSnapshot.stockoutDays)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k} dans ${v} j`);
    return {
      reply:
        `🔮 Projection à +${forecastSnapshot.horizonDays} j (${forecastSnapshot.scenario.label}) :\n` +
        `• Récolte estimée : ${t.harvestKg} kg · Œufs : ${t.eggsCount}\n` +
        `• CA prévu : ${t.revenueEur.toLocaleString("fr-FR")} € · Marge nette : ${t.netMarginEur.toLocaleString("fr-FR")} €\n` +
        `• Trésorerie finale : ${t.endCashEur.toLocaleString("fr-FR")} € · Pic risque maladie : ${t.peakDiseaseRisk} %\n` +
        `• Ruptures anticipées : ${stockNotes.length ? stockNotes.join(", ") : "Aucune sur la période ✅"}`,
      mutated: false,
    };
  }

  if (/(maladie|mildiou|oidium|oïdium|pou|sante|santé|risque)/i.test(low)) {
    const risky = [...state.plots].sort((a, b) => b.diseaseRisk - a.diseaseRisk).slice(0, 3);
    const lines = risky.map((p) => `• ${p.name} : risque ${p.diseaseRisk} %, santé ${p.healthPct} %, humidité ${p.moisturePct} %`);
    return {
      reply: `🩺 Veille sanitaire :\n${lines.join("\n")}\nConseil : privilégiez l'aération des serres le matin et le goutte-à-goutte au pied.`,
      mutated: false,
    };
  }

  if (/(rotation|associer|suivant|planche|semis)/i.test(low)) {
    const target = findPlotInText(state, low);
    if (target) {
      const ranked = CROP_CATALOG.map((c) => ({ c, ev: evaluateRotation(target, c.id) }))
        .sort((a, b) => b.ev.score - a.ev.score)
        .slice(0, 3);
      return {
        reply:
          `🔄 Meilleures rotations suggérées après ${target.name} :\n` +
          ranked.map((r, i) => `${i + 1}. ${r.c.icon} ${r.c.name} (${r.c.family}) — Score ${r.ev.score}/100 (${r.ev.verdict})`).join("\n"),
        mutated: false,
      };
    }
  }

  if (/(oeuf|œuf|poule|ponte|elevage|élevage|vache|cheptel)/i.test(low)) {
    const lines = state.livestock.map(
      (l) => `• ${l.name} (${l.count} têtes) : ${l.kind === "ponte" ? `${l.eggsToday} œufs/j (${l.layingRatePct}%)` : "Pâturage actif"}, trappe ${l.doorOpen ? "ouverte" : "fermée"}, bien-être ${l.welfarePct}%`
    );
    return { reply: lines.length ? `🐓 Cheptel en direct :\n${lines.join("\n")}` : "Aucun lot animal actif.", mutated: false };
  }

  if (/(stock|eau|electric|électric|energie|énergie|aliment|semence|appro|personnel|equipe|équipe|heure)/i.test(low)) {
    const resLines = state.resources.map((r) => {
      const daysLeft = r.dailyUse > 0 ? Math.floor(r.stock / r.dailyUse) : 999;
      return `• ${r.name} : ${r.stock} ${r.unit} (~${daysLeft} j)`;
    });
    const t = forecastSnapshot.totals;
    return {
      reply:
        `📦 Ressources & Main-d'œuvre :\n${resLines.join("\n")}\n` +
        `👷 Besoin humain estimé : ${t.avgHumanHoursDay} h/j · Robots économisent ${t.avgRobotHoursDay} h/j.`,
      mutated: false,
    };
  }

  if (/(meteo|météo|pluie|vent|temp|soleil|humidite|humidité)/i.test(low)) {
    const w = state.weather.current;
    return {
      reply: `🌦️ Station ${state.farm.location.name} (${state.weather.source}) :\n• Température : ${w.tempC} °C · Humidité : ${w.rhPct} %\n• Vent : ${w.windKmh} km/h · Pluie : ${w.rainMm} mm · Solaire : ${w.solarWm2} W/m²`,
      mutated: false,
    };
  }

  // Reponse generale contextuelle
  return {
    reply:
      `🌱 Synthèse ${state.farm.name} (${state.farm.areaHa} ha) :\n` +
      `• Score d'autonomie : ${forecastSnapshot.globalScore}/100\n` +
      `• Météo : ${state.weather.current.tempC} °C, vent ${state.weather.current.windKmh} km/h\n` +
      `• Commandes possibles : « Envoie le rover sur P2 », « Ouvre les serres à 80% », « Arrose P2 », « Quels risques à 30 jours ? », « Quelle rotation sur P1 ? », « Note 15 kg tomates sur S1 ».`,
    mutated: false,
  };
}

/**
 * Interroge une IA externe (Ollama local ou API compatible OpenAI) si configuree, sinon bascule sur l'IA locale.
 */
export async function askAssistant(state, text, forecastSnapshot) {
  const localRes = processNaturalCommand(state, text, forecastSnapshot);
  const cfg = state.aiSettings || { provider: "local" };
  if (cfg.provider === "local" || localRes.mutated) {
    return { ...localRes, engine: "IA Agronomique Locale" };
  }

  const contextSummary = JSON.stringify({
    farm: state.farm.name,
    areaHa: state.farm.areaHa,
    weather: state.weather.current,
    plots: state.plots.map((p) => ({ id: p.id, crop: p.cropId, moisture: p.moisturePct, risk: p.diseaseRisk })),
    totalsForecast: forecastSnapshot.totals,
    stockouts: forecastSnapshot.stockoutDays,
  });

  try {
    if (cfg.provider === "ollama") {
      const resp = await fetch(`${(cfg.ollamaUrl || "http://localhost:11434").replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model || "mistral",
          stream: false,
          messages: [
            { role: "system", content: "Tu es l'IA agronomique de SG Vision Farmer. Réponds en français de façon concise et pratique à partir du JSON ferme fourni." },
            { role: "user", content: `Données ferme: ${contextSummary}\n\nQuestion: ${text}` },
          ],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const content = data.message?.content;
        if (content) return { reply: content, mutated: false, engine: `Ollama (${cfg.model || "mistral"})` };
      }
    }
  } catch {
    // Repli transparent vers le moteur local
  }

  return { ...localRes, engine: "IA Locale (Repli)" };
}
