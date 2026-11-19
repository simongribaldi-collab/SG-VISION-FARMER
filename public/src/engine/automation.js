/**
 * Moteur d'automatisations Si -> Alors, cinematique des robots 3D et pilotage d'actionneurs.
 */

export function pushHudAlert(state, message, severity = "info") {
  if (!state.hud) state.hud = { alerts: [], voiceHistory: [] };
  const entry = {
    id: `HUD-${Date.now()}-${Math.floor(Math.random() * 999)}`,
    timestamp: new Date().toISOString(),
    severity,
    message,
  };
  state.hud.alerts = [entry, ...(state.hud.alerts || [])].slice(0, 14);
  return entry;
}

function getRobotBasePos(state) {
  const baseStruct =
    (state.structures || []).find((s) => s.type === "hangar") ||
    (state.structures || []).find((s) => s.type === "solar_array");
  if (!baseStruct) return { x: 11, z: -6 };
  return { x: Number(baseStruct.x) || 11, z: Number((baseStruct.z || -8) + 2.2) };
}

export function dispatchRobot(state, robotId, plotId, taskLabel = "") {
  const bot = state.equipment.find((e) => e.id === robotId);
  if (!bot) return { ok: false, message: "Robot introuvable." };

  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) {
    const base = getRobotBasePos(state);
    bot.status = "returning";
    bot.targetPlotId = null;
    bot.targetX = base.x;
    bot.targetZ = base.z;
    bot.task = "Retour base / Recharge";
    return { ok: true, message: `${bot.name} rappelé à la base.` };
  }

  bot.status = "working";
  bot.targetPlotId = plot.id;
  bot.targetX = plot.x;
  bot.targetZ = plot.z;
  bot.task = taskLabel || `${bot.kind === "drone" ? "Scan NDVI" : "Intervention"} sur ${plot.name}`;
  pushHudAlert(state, `${bot.name} envoyé sur ${plot.name}`, "info");
  return { ok: true, message: `${bot.name} déployé sur ${plot.name}.` };
}

export function toggleIrrigation(state, plotId, forceOpen = null) {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) return { ok: false, message: "Planche introuvable." };
  plot.irrigationValveOpen = forceOpen === null ? !plot.irrigationValveOpen : Boolean(forceOpen);
  if (plot.irrigationValveOpen) {
    plot.moisturePct = Math.min(88, (plot.moisturePct || 40) + 12);
    const water = state.resources.find((r) => r.id === "RES-EAU");
    if (water) water.stock = Math.max(0, Number((water.stock - Math.max(0.5, plot.areaM2 * 0.004)).toFixed(1)));
  }
  return {
    ok: true,
    message: `Vanne ${plot.name} ${plot.irrigationValveOpen ? "OUVERTE (irrigation active)" : "FERMÉE"}.`,
  };
}

export function setGreenhouseVent(state, plotId, pct) {
  const plot = state.plots.find((p) => p.id === plotId && p.zone === "Serre");
  if (!plot) return { ok: false, message: "Serre introuvable." };
  plot.ventOpeningPct = Math.max(0, Math.min(100, Number(pct)));
  if (plot.ventOpeningPct > 40) {
    plot.indoorTempC = Math.max(18, Number(((plot.indoorTempC || 26) - 2.4).toFixed(1)));
    plot.indoorRhPct = Math.max(52, Math.round((plot.indoorRhPct || 75) - 7));
  }
  return { ok: true, message: `Ouvrants ${plot.name} réglés à ${plot.ventOpeningPct} %.` };
}

export function toggleCoopDoor(state, lotId = null, forceOpen = null, structureId = null) {
  if (structureId) {
    const struct = state.structures.find((s) => s.id === structureId);
    if (!struct) return { ok: false, message: "Poulailler introuvable." };
    const nextOpen = forceOpen === null ? !struct.doorOpen : Boolean(forceOpen);
    struct.doorOpen = nextOpen;
    state.livestock
      .filter((l) => l.kind === "ponte" && (!l.coopStructureId || l.coopStructureId === structureId))
      .forEach((l) => {
        l.doorOpen = nextOpen;
      });
    return { ok: true, message: `Trappe ${struct.label} ${nextOpen ? "OUVERTE" : "FERMÉE"}.` };
  }

  const lots = lotId
    ? state.livestock.filter((l) => l.id === lotId)
    : state.livestock.filter((l) => l.kind === "ponte");
  if (!lots.length) return { ok: false, message: "Aucun poulailler trouvé." };
  lots.forEach((l) => {
    l.doorOpen = forceOpen === null ? !l.doorOpen : Boolean(forceOpen);
    const struct = state.structures.find((s) => s.id === l.coopStructureId);
    if (struct) struct.doorOpen = l.doorOpen;
  });
  const isOpen = lots[0].doorOpen;
  return { ok: true, message: `Trappe(s) poulailler ${isOpen ? "OUVERTE(S)" : "FERMÉE(S)"}.` };
}

function readConditionMetric(state, sensor) {
  const cur = state.weather.current;
  const greenhouses = state.plots.filter((p) => p.zone === "Serre");
  const rovers = state.equipment.filter((e) => e.autonomous && e.kind === "rover");

  const map = {
    plot_min_moisture: () => (state.plots.length ? Math.min(...state.plots.map((p) => p.moisturePct)) : 60),
    greenhouse_temp: () => (greenhouses.length ? Math.max(...greenhouses.map((g) => g.indoorTempC || cur.tempC + 4)) : cur.tempC),
    wind_kmh: () => cur.windKmh || 0,
    night_time: () => (state.simulation.hourOfDay < 6.5 || state.simulation.hourOfDay > 20.5 ? 1 : 0),
    rover_idle_battery: () => {
      const idle = rovers.find((r) => r.status === "idle");
      return idle ? idle.batteryPct : 0;
    },
    disease_max_risk: () => (state.plots.length ? Math.max(...state.plots.map((p) => p.diseaseRisk || 0)) : 0),
  };
  return map[sensor] ? map[sensor]() : 0;
}

function compareMetric(actual, op, expected) {
  switch (op) {
    case "<": return actual < expected;
    case ">": return actual > expected;
    case "<=": return actual <= expected;
    case ">=": return actual >= expected;
    case "==": return actual === expected;
    default: return false;
  }
}

/**
 * Evalue toutes les regles actives et execute leurs actions si declenchees.
 */
export function evaluateAutomations(state) {
  const triggered = [];
  const nextRain12h = (state.weather.forecast?.[0]?.rainMm || 0) > 4;

  for (const rule of state.automations) {
    if (!rule.enabled) continue;
    const metric = readConditionMetric(state, rule.condition.sensor);
    let matched = compareMetric(metric, rule.condition.op, Number(rule.condition.value));
    if (rule.condition.noRainNext12h && nextRain12h) matched = false;
    if (!matched) continue;

    let desc = "";
    const act = rule.action;
    if (act.type === "irrigate_dry_plots") {
      const dry = state.plots.filter((p) => p.moisturePct < Number(rule.condition.value));
      dry.forEach((p) => {
        p.irrigationValveOpen = true;
        p.moisturePct = Math.min(72, p.moisturePct + 14);
      });
      if (dry.length) desc = `Irrigation ouverte sur ${dry.map((d) => d.id).join(", ")}`;
    } else if (act.type === "open_vents") {
      state.plots
        .filter((p) => p.zone === "Serre")
        .forEach((g) => {
          g.ventOpeningPct = act.pct || 80;
          g.indoorTempC = Math.max(20, Number(((g.indoorTempC || 28) - 2.5).toFixed(1)));
        });
      desc = `Ouvrants serres réglés à ${act.pct || 80} %`;
    } else if (act.type === "storm_protect") {
      const base = getRobotBasePos(state);
      state.plots.filter((p) => p.zone === "Serre").forEach((g) => (g.ventOpeningPct = 0));
      state.equipment
        .filter((e) => e.kind === "drone")
        .forEach((d) => {
          d.status = "returning";
          d.targetPlotId = null;
          d.targetX = base.x;
          d.targetZ = base.z;
          d.task = "Rappel vent fort";
        });
      desc = "Protection tempête : drone rappelé & serres fermées";
    } else if (act.type === "coop_door_auto") {
      toggleCoopDoor(state, null, false);
      desc = "Trappes poulaillers fermées (nuit)";
    } else if (act.type === "dispatch_rover") {
      const idleRover = state.equipment.find((e) => e.autonomous && e.kind === "rover" && e.status === "idle");
      const targetPlot = state.plots.find((p) => p.id === act.plotId) || state.plots[0];
      if (idleRover && targetPlot) {
        dispatchRobot(state, idleRover.id, targetPlot.id, `Mission auto (${rule.name})`);
        desc = `${idleRover.name} déployé sur ${targetPlot.id}`;
      }
    }

    if (desc) {
      rule.lastTriggered = new Date().toISOString();
      rule.triggerCount = (rule.triggerCount || 0) + 1;
      triggered.push({ ruleId: rule.id, name: rule.name, desc });
      pushHudAlert(state, `[Auto] ${desc}`, "info");
    }
  }
  return triggered;
}

/**
 * Anime les robots mobiles en 3D et met a jour batterie / patrouille sur la parcelle cible.
 */
export function tickRobots(state, dtSeconds, elapsedSec) {
  const base = getRobotBasePos(state);
  for (const eq of state.equipment) {
    if (!eq.autonomous) continue;
    if (eq.status === "working") {
      const plot = eq.targetPlotId ? state.plots.find((p) => p.id === eq.targetPlotId) : null;
      if (eq.targetPlotId && !plot) {
        eq.status = "returning";
        eq.targetPlotId = null;
        eq.targetX = base.x;
        eq.targetZ = base.z;
        eq.task = "Parcelle supprimée — retour base";
        continue;
      }
      if (plot) {
        // Trajectoire aller-retour le long des rangs de la planche cible
        const span = Math.max(1.5, (plot.w || 6) * 0.42);
        const speed = eq.kind === "drone" ? 1.4 : 0.7;
        eq.targetX = plot.x + Math.sin(elapsedSec * speed + eq.id.length) * span;
        eq.targetZ = plot.z + Math.cos(elapsedSec * speed * 0.5) * Math.max(0.4, (plot.d || 2) * 0.28);
      }
      const dx = (eq.targetX ?? eq.x) - eq.x;
      const dz = (eq.targetZ ?? eq.z) - eq.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, dtSeconds * (eq.kind === "drone" ? 4.8 : 2.1));
        eq.x += (dx / dist) * step;
        eq.z += (dz / dist) * step;
        eq.heading = Math.atan2(dx, dz);
      }
      eq.batteryPct = Math.max(12, Number((eq.batteryPct - dtSeconds * 0.06).toFixed(1)));
      eq.hoursTotal = Number((eq.hoursTotal + dtSeconds / 3600).toFixed(2));
      if (eq.batteryPct <= 15) {
        eq.status = "returning";
        eq.targetPlotId = null;
        eq.targetX = base.x;
        eq.targetZ = base.z;
        eq.task = "Batterie faible — retour charge solaire";
      }
    } else if (eq.status === "returning") {
      const dx = base.x - eq.x;
      const dz = base.z - eq.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.25) {
        const step = Math.min(dist, dtSeconds * 3.0);
        eq.x += (dx / dist) * step;
        eq.z += (dz / dist) * step;
        eq.heading = Math.atan2(dx, dz);
      } else {
        eq.status = "idle";
        eq.task = "En charge au hangar solaire";
      }
    } else if (eq.status === "idle") {
      eq.batteryPct = Math.min(100, Number((eq.batteryPct + dtSeconds * 0.35).toFixed(1)));
    }
  }
}
