import { CLIMATE_LOCATIONS, CROP_CATALOG, TROPHIES_DEF } from "../data/presets.js";

export const SCENARIOS = [
  { id: "normal", label: "Trajectoire Nominale (Météo prévue)", tempDelta: 0, rainMult: 1, energyPriceMult: 1, yieldMult: 1 },
  { id: "heatwave", label: "Canicule & Stress Hydrique (+5 °C, -60 % pluie)", tempDelta: 5.0, rainMult: 0.4, energyPriceMult: 1.15, yieldMult: 0.88 },
  { id: "drought", label: "Sécheresse Prolongée (-80 % pluie)", tempDelta: 2.2, rainMult: 0.2, energyPriceMult: 1.05, yieldMult: 0.82 },
  { id: "frost", label: "Gel Tardif & Printemps Froid (-4,5 °C)", tempDelta: -4.5, rainMult: 1.1, energyPriceMult: 1.25, yieldMult: 0.84 },
  { id: "energy_spike", label: "Flambée Énergie & Intrants (x1,85)", tempDelta: 0, rainMult: 1, energyPriceMult: 1.85, yieldMult: 1.0 },
  { id: "growth_opt", label: "Optimisation Totale (IA + Biocontrôle + Paillage)", tempDelta: 0, rainMult: 1, energyPriceMult: 0.85, yieldMult: 1.16 },
];

export function getCropById(cropId) {
  return CROP_CATALOG.find((c) => c.id === cropId) || CROP_CATALOG[0];
}

/**
 * Evalue la qualite agronomique d'une rotation sur une planche donnee.
 */
export function evaluateRotation(plot, candidateCropId) {
  const candidate = getCropById(candidateCropId);
  const hist = plot.history || [];
  const n1 = hist.find((h) => h.season === "N-1");
  const n2 = hist.find((h) => h.season === "N-2");
  const currentCrop = plot.cropId ? getCropById(plot.cropId) : null;

  let score = 92;
  const warnings = [];
  const positives = [];

  const checkPrev = (prevId, penalty, label) => {
    if (!prevId) return;
    const prev = getCropById(prevId);
    if (prev.id === candidate.id) {
      score -= penalty * 1.4;
      warnings.push(`Même espèce que ${label} (${prev.name}) : fort risque pathogènes telluriques.`);
    } else if (prev.family === candidate.family) {
      score -= penalty;
      warnings.push(`Même famille (${candidate.family}) que ${label} (${prev.name}).`);
    } else {
      positives.push(`Bonne rupture de famille après ${prev.family} (${label}).`);
    }
    if (prev.nitrogenNeed === "Fixateur N2" && candidate.nitrogenNeed === "Elevé") {
      score += 8;
      positives.push(`Synergie azote : ${prev.name} enrichit le sol pour ${candidate.name}.`);
    }
    if (prev.nitrogenNeed === "Elevé" && candidate.nitrogenNeed === "Elevé" && label === "En cours/N-1") {
      score -= 10;
      warnings.push(`Succession de deux cultures exigeantes en azote : prévoir apport compost.`);
    }
  };

  if (currentCrop) checkPrev(currentCrop.id, 30, "Culture actuelle");
  if (n1) checkPrev(n1.cropId, 24, "N-1");
  if (n2) checkPrev(n2.cropId, 12, "N-2");

  if (plot.zone === "Serre" && !candidate.greenhouseCompatible) {
    score -= 30;
    warnings.push(`${candidate.name} est peu adaptée à la conduite sous serre.`);
  }
  if (candidate.id === "engrais_vert") {
    score = Math.min(100, score + 12);
    positives.push("Régénération humus, structure du sol et piégeage nitrates.");
  }

  score = Math.max(10, Math.min(100, Math.round(score)));
  const verdict = score >= 80 ? "Excellente" : score >= 60 ? "Correcte" : "Risquée";
  return { score, verdict, warnings, positives, candidate };
}

function getDayWeatherFromModel(state, dayIndex, scenario) {
  const fc = state.weather.forecast || [];
  if (dayIndex < fc.length) {
    const d = fc[dayIndex];
    const tMin = Number((d.tempMin + scenario.tempDelta).toFixed(1));
    const tMax = Number((d.tempMax + scenario.tempDelta).toFixed(1));
    const rain = Number((d.rainMm * scenario.rainMult).toFixed(1));
    const rh = Math.min(98, Math.max(25, Math.round(d.rhAvgPct + (scenario.rainMult < 0.5 ? -10 : 0))));
    return {
      ...d,
      tempMin: tMin,
      tempMax: tMax,
      rainMm: rain,
      rhAvgPct: rh,
      etpMm: Number((d.etpMm * (1 + Math.max(0, scenario.tempDelta) * 0.06)).toFixed(2)),
    };
  }

  const loc = CLIMATE_LOCATIONS.find((l) => l.id === state.farm.location?.id) || CLIMATE_LOCATIONS[0];
  const d = new Date(Date.now() + dayIndex * 86400000);
  const m = d.getMonth();
  const wave = Math.sin(dayIndex * 0.43) * 2.6;
  const rainRaw = dayIndex % 6 === 0 ? loc.rainMm[m] / 5 : 0;
  const tMin = Number((loc.avgTemp[m] - 4.2 + wave + scenario.tempDelta).toFixed(1));
  const tMax = Number((loc.avgTemp[m] + 5.6 + wave + scenario.tempDelta).toFixed(1));
  const rain = Number((rainRaw * scenario.rainMult).toFixed(1));
  const rh = Math.min(96, Math.max(28, Math.round(loc.rhBase + (rain > 0 ? 15 : -4) - scenario.tempDelta * 1.2)));
  const solar = Number(Math.max(0.7, loc.solarKwhM2[m] * (rain > 0 ? 0.45 : 1.02)).toFixed(2));
  const etp = Number(Math.max(0.6, 0.21 * Math.max(2, tMax) * (1 - rh / 225)).toFixed(2));

  return {
    dayOffset: dayIndex,
    date: d.toISOString().slice(0, 10),
    tempMin: tMin,
    tempMax: tMax,
    rainMm: rain,
    windMaxKmh: Math.round(loc.windBase + Math.abs(Math.cos(dayIndex * 0.7)) * 14),
    rhAvgPct: rh,
    solarKwhM2: solar,
    etpMm: etp,
  };
}

/**
 * Simule la trajectoire agricole, hydrique, sanitaire, energetique et financiere jusqu'a +horizonDays.
 */
export function simulateFuture(state, horizonDays = 30, scenarioId = "normal") {
  const days = Math.max(1, Math.min(365, Number(horizonDays) || 30));
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];

  // Clones legers des variables d'etat simulees
  const plotSim = state.plots.map((p) => ({
    id: p.id,
    name: p.name,
    zone: p.zone,
    areaM2: p.areaM2,
    crop: getCropById(p.cropId),
    gdd: p.gddAccumulated || 0,
    moisture: p.moisturePct ?? 55,
    health: p.healthPct ?? 90,
    diseaseRisk: p.diseaseRisk ?? 15,
    harvestedKgTotal: 0,
    cycleDone: false,
  }));

  const solarKwPeak = state.structures
    .filter((s) => s.type === "solar_array")
    .reduce((acc, s) => acc + (s.kwPeak || 8), 0);
  const windKwPeak = state.structures
    .filter((s) => s.type === "wind_turbine")
    .reduce((acc, s) => acc + (s.kwPeak || 5), 0);

  const waterRes = state.resources.find((r) => r.id === "RES-EAU");
  const elecRes = state.resources.find((r) => r.id === "RES-ELEC");
  const feedRes = state.resources.find((r) => r.id === "RES-ALIM-P");
  const seedRes = state.resources.find((r) => r.id === "RES-SEM");
  const agroRes = state.resources.find((r) => r.id === "RES-AGRO");
  const fuelRes = state.resources.find((r) => r.id === "RES-GNR");

  let waterStock = waterRes ? waterRes.stock : 200;
  const waterMax = waterRes ? waterRes.max : 400;
  let elecBattery = elecRes ? elecRes.stock : 50;
  const elecMax = elecRes ? elecRes.max : 100;
  let feedStock = feedRes ? feedRes.stock : 500;
  let seedStock = seedRes ? seedRes.stock : 150;
  let agroStock = agroRes ? agroRes.stock : 120;
  let fuelStock = fuelRes ? fuelRes.stock : 250;

  let cash = state.finances.cashBalance || 25000;
  const fixedDailyCost = (state.finances.monthlyFixedCosts || 2500) / 30;
  const totalStaffHoursPerDay = state.staff.reduce((a, s) => a + s.weeklyHours / 7, 0);
  const avgStaffHourlyCost =
    state.staff.length > 0
      ? state.staff.reduce((a, s) => a + s.hourlyCost, 0) / state.staff.length
      : 18;
  const robotCount = state.equipment.filter((e) => e.autonomous).length;
  const autoIrrigEnabled = state.automations.some((a) => a.enabled && a.action.type === "irrigate_dry_plots");

  const daily = [];
  const stockoutDays = {
    water: null,
    feed: null,
    seeds: null,
    agro: null,
    fuel: null,
  };

  const layingFlocks = state.livestock.filter((l) => l.kind === "ponte");
  const herdFlocks = state.livestock.filter((l) => l.kind === "elevage");

  for (let d = 0; d <= days; d++) {
    const wx = getDayWeatherFromModel(state, d, scenario);
    const tMean = (wx.tempMin + wx.tempMax) / 2;

    // 1) Energie Solaire + Eolien vs Conso
    const solarKwh = Number((solarKwPeak * wx.solarKwhM2 * 0.78).toFixed(1));
    const windFactor = Math.min(1, Math.pow(wx.windMaxKmh / 35, 1.6));
    const windKwh = Number((windKwPeak * 24 * windFactor * 0.35).toFixed(1));
    const baseConsKwh = elecRes ? elecRes.dailyUse : 25;
    const hvacExtra = wx.tempMax > 29 ? (wx.tempMax - 28) * 1.8 : wx.tempMin < 3 ? (4 - wx.tempMin) * 2.4 : 0;
    const consumedKwh = Number((baseConsKwh + hvacExtra).toFixed(1));
    const netKwh = solarKwh + windKwh - consumedKwh;
    elecBattery = Math.max(0, Math.min(elecMax, elecBattery + netKwh));
    const gridImportKwh = netKwh < 0 && elecBattery <= 0 ? Math.abs(netKwh) : 0;

    // 2) Eau & Cultures
    const rainHarvestM3 = Number((wx.rainMm * 0.32 * Math.max(1, state.structures.length * 0.4)).toFixed(2));
    let irrigationUsedM3 = 0;
    let harvestKgToday = 0;
    let cropRevenueToday = 0;
    let laborHoursToday = 0;

    for (const ps of plotSim) {
      const c = ps.crop;
      const inGreenhouse = ps.zone === "Serre";
      const effTemp = inGreenhouse ? tMean + 3.2 : tMean;
      const effRain = inGreenhouse ? 0 : wx.rainMm;
      const effEtp = inGreenhouse ? wx.etpMm * 0.75 : wx.etpMm;

      // Bilan hydrique journalier (simplifie en % reserve utile)
      const waterLossPct = effEtp * c.kc * 2.1;
      const rainGainPct = effRain * 1.8;
      ps.moisture = Math.max(8, Math.min(96, ps.moisture + rainGainPct - waterLossPct));

      // Declenchement irrigation auto si seuil < 38% et eau dispo
      if (autoIrrigEnabled && ps.moisture < 38 && waterStock > 2) {
        const neededM3 = Math.min(waterStock * 0.25, (ps.areaM2 * 4.5) / 1000);
        irrigationUsedM3 += neededM3;
        waterStock -= neededM3;
        ps.moisture = Math.min(72, ps.moisture + 24);
      }

      // Croissance GDD
      const gddToday = Math.max(0, effTemp - c.baseTemp) * (ps.moisture < 24 ? 0.55 : 1);
      ps.gdd += gddToday;
      const progress = ps.gdd / c.gddTarget;

      // Risque maladie
      const humidityTrigger = inGreenhouse ? Math.min(94, wx.rhAvgPct + 8) : wx.rhAvgPct;
      let riskDelta = -4;
      if (humidityTrigger >= 80 && effTemp >= 13 && effTemp <= 26) riskDelta += 11;
      if (wx.tempMax >= 32) riskDelta += 5;
      if (scenario.id === "growth_opt") riskDelta -= 4;
      ps.diseaseRisk = Math.max(4, Math.min(96, ps.diseaseRisk + riskDelta));

      // Sante
      const stressPenalty = (ps.moisture < 25 ? 2.5 : 0) + (ps.diseaseRisk > 65 ? 1.8 : 0);
      ps.health = Math.max(30, Math.min(100, ps.health + (stressPenalty === 0 ? 0.5 : -stressPenalty)));

      // Recolte etalee quand progress >= 0.85
      if (progress >= 0.85 && !ps.cycleDone) {
        const totalExpectedKg = ps.areaM2 * c.yieldKgPerM2 * (ps.health / 100) * scenario.yieldMult;
        const dailyKg = totalExpectedKg / 22;
        harvestKgToday += dailyKg;
        ps.harvestedKgTotal += dailyKg;
        cropRevenueToday += dailyKg * c.pricePerKg;
        laborHoursToday += (ps.areaM2 / 100) * (c.laborHoursPer100m2 / 22);
        if (progress >= 1.25) {
          ps.cycleDone = true;
        }
      } else {
        laborHoursToday += (ps.areaM2 / 100) * (c.laborHoursPer100m2 / Math.max(30, c.daysToHarvest)) * 0.45;
      }
    }

    // 3) Elevage & Ponte
    let eggsToday = 0;
    let animalRevToday = 0;
    let animalWaterM3 = 0;
    let animalFeedKg = 0;

    for (const fl of layingFlocks) {
      const heatStress = wx.tempMax > 30 ? 0.91 : wx.tempMin < 2 ? 0.94 : 1.0;
      const ageFactor = Math.max(0.65, 1 - Math.max(0, fl.ageWeeks + d / 7 - 45) * 0.004);
      const rate = Math.min(0.95, (fl.layingRatePct / 100) * heatStress * ageFactor);
      const eggs = Math.round(fl.count * rate);
      eggsToday += eggs;
      animalRevToday += eggs * (fl.eggPriceUnit || 0.36);
      animalFeedKg += (fl.count * (fl.feedGramsPerDay || 120)) / 1000;
      animalWaterM3 += (fl.count * (fl.waterLitersPerDay || 0.25)) / 1000;
      laborHoursToday += Math.max(0.6, fl.count / 500);
    }

    for (const hd of herdFlocks) {
      animalWaterM3 += (hd.count * (hd.waterLitersPerDay || 50)) / 1000;
      animalRevToday += hd.count * 2.4;
      laborHoursToday += Math.max(0.8, hd.count / 35);
    }

    // 4) Mise a jour stocks ressources
    waterStock = Math.max(0, Math.min(waterMax, waterStock + rainHarvestM3 - irrigationUsedM3 - animalWaterM3 - 0.5));
    feedStock = Math.max(0, feedStock - animalFeedKg);
    seedStock = Math.max(0, seedStock - (seedRes?.dailyUse || 2));
    agroStock = Math.max(0, agroStock - (agroRes?.dailyUse || 2.5));
    fuelStock = Math.max(0, fuelStock - (fuelRes?.dailyUse || 4));

    if (stockoutDays.water === null && waterStock <= 1) stockoutDays.water = d;
    if (stockoutDays.feed === null && feedStock <= 1 && layingFlocks.length > 0) stockoutDays.feed = d;
    if (stockoutDays.seeds === null && seedStock <= 1) stockoutDays.seeds = d;
    if (stockoutDays.agro === null && agroStock <= 1) stockoutDays.agro = d;
    if (stockoutDays.fuel === null && fuelStock <= 1) stockoutDays.fuel = d;

    // 5) Robots vs Main d'oeuvre humaine
    const robotHoursSaved = Number((robotCount * 3.4).toFixed(1));
    const humanHoursNeeded = Number(Math.max(1.5, laborHoursToday - robotHoursSaved * 0.65).toFixed(1));
    const overtimeHours = Math.max(0, humanHoursNeeded - totalStaffHoursPerDay);

    // 6) Finances du jour
    const energyCost = gridImportKwh * 0.23 * scenario.energyPriceMult;
    const varInputCost = (animalFeedKg * 0.6 + irrigationUsedM3 * 0.45 + 14) * scenario.energyPriceMult;
    const staffCost = (totalStaffHoursPerDay * avgStaffHourlyCost + overtimeHours * avgStaffHourlyCost * 1.25) / 1.0;
    const revenueEur = Number((cropRevenueToday + animalRevToday).toFixed(0));
    const costEur = Number((fixedDailyCost + energyCost + varInputCost + staffCost * 0.35).toFixed(0));
    cash += revenueEur - costEur;

    const avgMoisturePct =
      plotSim.length > 0 ? Math.round(plotSim.reduce((a, p) => a + p.moisture, 0) / plotSim.length) : 60;
    const maxDiseaseRisk =
      plotSim.length > 0 ? Math.round(Math.max(...plotSim.map((p) => p.diseaseRisk))) : 10;

    daily.push({
      dayOffset: d,
      date: wx.date,
      tempMin: wx.tempMin,
      tempMax: wx.tempMax,
      rainMm: wx.rainMm,
      solarKwh,
      windKwh,
      consumedKwh,
      netEnergyKwh: Number(netKwh.toFixed(1)),
      waterStockM3: Number(waterStock.toFixed(1)),
      waterUsedM3: Number((irrigationUsedM3 + animalWaterM3).toFixed(1)),
      harvestKg: Number(harvestKgToday.toFixed(1)),
      eggsCount: eggsToday,
      revenueEur,
      costEur,
      cashBalance: Math.round(cash),
      avgMoisturePct,
      maxDiseaseRisk,
      humanHoursNeeded,
      robotHoursSaved,
      teamCapacityHours: Number(totalStaffHoursPerDay.toFixed(1)),
    });
  }

  const plotSnapshots = plotSim.map((ps) => {
    const progressPct = Math.min(100, Math.round((ps.gdd / ps.crop.gddTarget) * 100));
    const stage =
      progressPct < 15 ? "Semis / Levée" :
      progressPct < 55 ? "Croissance" :
      progressPct < 85 ? "Floraison / Grossissement" :
      progressPct < 100 ? "Maturité / Récolte" : "Fin de cycle (Rotation)";
    return {
      id: ps.id,
      name: ps.name,
      cropId: ps.crop.id,
      progressPct,
      stage,
      moisturePct: Math.round(ps.moisture),
      healthPct: Math.round(ps.health),
      diseaseRisk: Math.round(ps.diseaseRisk),
      projectedHarvestKg: Math.round(ps.harvestedKgTotal),
    };
  });

  // Calcul Radar Autonomie & Trophees ludiques
  const lastDay = daily[daily.length - 1] || daily[0];
  const waterScore = Math.min(100, Math.round(((waterRes ? waterRes.stock / waterRes.max : 0.6) * 100 + 15)));
  const energyRatio = lastDay.consumedKwh > 0 ? (lastDay.solarKwh + lastDay.windKwh) / lastDay.consumedKwh : 1;
  const energyScore = Math.min(100, Math.round(energyRatio * 75));
  const avgRotScore =
    state.plots.length > 0
      ? Math.round(state.plots.reduce((a, p) => a + evaluateRotation(p, p.cropId).score, 0) / state.plots.length)
      : 80;
  const welfareScore =
    state.livestock.length > 0
      ? Math.round(state.livestock.reduce((a, l) => a + (l.welfarePct || 88), 0) / state.livestock.length)
      : 88;
  const robotScore = Math.min(100, robotCount * 22 + state.automations.filter((a) => a.enabled).length * 10);
  const totalRev = daily.reduce((a, x) => a + x.revenueEur, 0);
  const totalCost = daily.reduce((a, x) => a + x.costEur, 0);
  const marginScore = totalCost > 0 ? Math.max(15, Math.min(100, Math.round((totalRev / totalCost) * 65))) : 70;

  const autonomyRadar = [
    { label: "Eau", score: waterScore },
    { label: "Énergie", score: energyScore },
    { label: "Sol & Rotations", score: avgRotScore },
    { label: "Santé & Bien-être", score: welfareScore },
    { label: "Robotique & Auto", score: robotScore },
    { label: "Rentabilité", score: marginScore },
  ];
  const globalScore = Math.round(autonomyRadar.reduce((a, x) => a + x.score, 0) / autonomyRadar.length);

  const unlockedTrophies = TROPHIES_DEF.filter((t) => {
    if (t.id === "water_saver") return waterScore >= 75 && autoIrrigEnabled;
    if (t.id === "solar_autonomy") return lastDay.netEnergyKwh >= 0;
    if (t.id === "rotation_master") return avgRotScore >= 80;
    if (t.id === "robot_crew") return robotCount >= 2 && state.automations.filter((a) => a.enabled).length >= 2;
    if (t.id === "egg_gold") return layingFlocks.some((l) => l.layingRatePct >= 85 && l.welfarePct >= 88);
    if (t.id === "future_planner") return state.farm.gamification?.simulatedFutureUsed || days >= 30;
    return false;
  }).map((t) => t.id);

  return {
    horizonDays: days,
    scenario,
    daily,
    plotSnapshots,
    stockoutDays,
    totals: {
      harvestKg: Math.round(daily.reduce((a, x) => a + x.harvestKg, 0)),
      eggsCount: daily.reduce((a, x) => a + x.eggsCount, 0),
      revenueEur: Math.round(totalRev),
      costEur: Math.round(totalCost),
      netMarginEur: Math.round(totalRev - totalCost),
      endCashEur: lastDay.cashBalance,
      avgHumanHoursDay: Number((daily.reduce((a, x) => a + x.humanHoursNeeded, 0) / daily.length).toFixed(1)),
      avgRobotHoursDay: Number((daily.reduce((a, x) => a + x.robotHoursSaved, 0) / daily.length).toFixed(1)),
      peakDiseaseRisk: Math.max(...daily.map((x) => x.maxDiseaseRisk)),
    },
    autonomyRadar,
    globalScore,
    unlockedTrophies,
  };
}
