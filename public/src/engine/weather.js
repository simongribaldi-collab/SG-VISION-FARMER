import { CLIMATE_LOCATIONS } from "../data/presets.js";

/**
 * Calcule la position solaire simplifiee (elevation/azimut + vecteur 3D)
 * selon la latitude et l'heure du jour pour l'eclairage 3D et le PV.
 */
export function computeSunPosition(lat = 45, hourOfDay = 12, dayOfYear = 172) {
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin(rad * (360 / 365) * (dayOfYear - 81));
  const hourAngle = (hourOfDay - 12) * 15;
  const sinEl =
    Math.sin(lat * rad) * Math.sin(decl * rad) +
    Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(hourAngle * rad);
  const elRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const elDeg = elRad / rad;

  const azRad = Math.atan2(
    Math.sin(hourAngle * rad),
    Math.cos(hourAngle * rad) * Math.sin(lat * rad) - Math.tan(decl * rad) * Math.cos(lat * rad)
  );
  const azDeg = (azRad / rad + 180) % 360;

  const dist = 48;
  const cosEl = Math.cos(Math.max(0.08, elRad));
  const x = Math.sin(azRad) * cosEl * dist;
  const y = Math.max(4, Math.sin(Math.max(0.08, elRad)) * dist);
  const z = -Math.cos(azRad) * cosEl * dist;

  const intensity = Math.max(0.06, Math.min(1, Math.sin(Math.max(0, elRad)) * 1.15));
  return {
    elevationDeg: Number(elDeg.toFixed(1)),
    azimuthDeg: Number(azDeg.toFixed(1)),
    x,
    y,
    z,
    intensity,
    isDay: elDeg > 0,
  };
}

/**
 * Genere une trajectoire meteo coherente hors-ligne depuis un profil climatique.
 */
export function buildSyntheticForecast(locationId = "drome", days = 14) {
  const loc = CLIMATE_LOCATIONS.find((l) => l.id === locationId) || CLIMATE_LOCATIONS[0];
  const baseDate = new Date();
  const list = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    const m = d.getMonth();
    const baseT = loc.avgTemp[m];
    const wave = Math.sin((i + d.getDate()) * 0.65) * 3.1;
    const rainTrigger = (i + d.getDate()) % 5 === 0 ? 12.4 : (i + d.getDate()) % 7 === 0 ? 4.8 : 0;
    const wind = Math.round(loc.windBase + Math.abs(Math.sin(i * 1.3)) * 16);
    const rh = Math.min(95, Math.max(36, Math.round(loc.rhBase + (rainTrigger > 0 ? 18 : -wave * 1.5))));
    const solar = Number(Math.max(0.7, loc.solarKwhM2[m] * (rainTrigger > 0 ? 0.45 : 1.04)).toFixed(2));
    const tMin = Number((baseT - 4.4 + wave).toFixed(1));
    const tMax = Number((baseT + 5.8 + wave).toFixed(1));
    const etp = Number(Math.max(0.5, 0.21 * Math.max(2, tMax) * (1 - rh / 225)).toFixed(2));

    list.push({
      dayOffset: i,
      date: d.toISOString().slice(0, 10),
      tempMin: tMin,
      tempMax: tMax,
      rainMm: rainTrigger,
      windMaxKmh: wind,
      rhAvgPct: rh,
      solarKwhM2: solar,
      etpMm: etp,
    });
  }
  return list;
}

/**
 * Synchronise la meteo reelle via Open-Meteo (sans cle API), avec repli hors-ligne propre.
 */
export async function syncOpenMeteo(lat, lon, locationId = "drome") {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,surface_pressure,shortwave_radiation` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,shortwave_radiation_sum,et0_fao_evapotranspiration,relative_humidity_2m_mean` +
    `&forecast_days=14&timezone=auto`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const d = data.daily || {};
    const times = d.time || [];
    const forecast = times.map((dateStr, i) => ({
      dayOffset: i,
      date: dateStr,
      tempMin: Number((d.temperature_2m_min?.[i] ?? 10).toFixed(1)),
      tempMax: Number((d.temperature_2m_max?.[i] ?? 20).toFixed(1)),
      rainMm: Number((d.precipitation_sum?.[i] ?? 0).toFixed(1)),
      windMaxKmh: Math.round(d.wind_speed_10m_max?.[i] ?? 15),
      rhAvgPct: Math.round(d.relative_humidity_2m_mean?.[i] ?? 65),
      solarKwhM2: Number((((d.shortwave_radiation_sum?.[i] ?? 14) * 0.2778)).toFixed(2)),
      etpMm: Number((d.et0_fao_evapotranspiration?.[i] ?? 3.2).toFixed(2)),
    }));

    const cur = data.current || {};
    return {
      ok: true,
      source: "Open-Meteo Live (Station Satellite + Modèle)",
      lastSync: new Date().toISOString(),
      current: {
        tempC: Number((cur.temperature_2m ?? forecast[0]?.tempMax ?? 18).toFixed(1)),
        rhPct: Math.round(cur.relative_humidity_2m ?? forecast[0]?.rhAvgPct ?? 65),
        windKmh: Math.round(cur.wind_speed_10m ?? forecast[0]?.windMaxKmh ?? 14),
        rainMm: Number((cur.precipitation ?? 0).toFixed(1)),
        solarWm2: Math.round(cur.shortwave_radiation ?? 420),
        leafWetnessPct: (cur.precipitation ?? 0) > 0 || (cur.relative_humidity_2m ?? 65) > 82 ? 78 : 20,
        pressureHpa: Math.round(cur.surface_pressure ?? 1015),
      },
      forecast: forecast.length ? forecast : buildSyntheticForecast(locationId, 14),
    };
  } catch (err) {
    const fallback = buildSyntheticForecast(locationId, 14);
    return {
      ok: false,
      error: err.message,
      source: "Station Locale + Modèle Climatique (hors-ligne)",
      lastSync: new Date().toISOString(),
      current: {
        tempC: Number((fallback[0].tempMax - 1.5).toFixed(1)),
        rhPct: fallback[0].rhAvgPct,
        windKmh: fallback[0].windMaxKmh,
        rainMm: fallback[0].rainMm,
        solarWm2: Math.round(fallback[0].solarKwhM2 * 145),
        leafWetnessPct: fallback[0].rhAvgPct > 80 ? 72 : 24,
        pressureHpa: 1015,
      },
      forecast: fallback,
    };
  }
}

/**
 * Recherche geographique Open-Meteo avec repli sur les profils climatiques locaux.
 */
export async function searchCity(query) {
  const clean = (query || "").trim();
  if (!clean) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=6&language=fr&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) throw new Error("Geocoding failed");
    const data = await resp.json();
    if (Array.isArray(data.results) && data.results.length) {
      return data.results.map((r) => ({
        id: `geo_${r.id}`,
        name: `${r.name}${r.admin1 ? " (" + r.admin1 + ")" : ""}, ${r.country_code || ""}`,
        lat: Number(r.latitude.toFixed(3)),
        lon: Number(r.longitude.toFixed(3)),
        climate: `Altitude ${r.elevation ?? 120}m · Lat ${r.latitude.toFixed(1)}°`,
      }));
    }
  } catch {
    // Repli local silencieux
  }
  const low = clean.toLowerCase();
  return CLIMATE_LOCATIONS.filter(
    (c) => c.name.toLowerCase().includes(low) || c.climate.toLowerCase().includes(low)
  );
}

/**
 * Permet d'injecter un evenement meteo sur la station connectee pour tester les automatisations.
 */
export function injectWeatherEvent(state, eventType) {
  const cur = state.weather.current;
  const events = {
    heatwave: () => {
      cur.tempC = 34.5;
      cur.rhPct = 32;
      cur.solarWm2 = 860;
      cur.rainMm = 0;
      cur.leafWetnessPct = 5;
      state.plots.forEach((p) => {
        if (p.zone === "Serre") p.indoorTempC = 33.2;
      });
    },
    storm: () => {
      cur.windKmh = 62;
      cur.rainMm = 18.5;
      cur.rhPct = 91;
      cur.solarWm2 = 120;
      cur.leafWetnessPct = 95;
      cur.pressureHpa = 994;
    },
    frost: () => {
      cur.tempC = -2.5;
      cur.rhPct = 78;
      cur.windKmh = 4;
      cur.rainMm = 0;
      cur.solarWm2 = 180;
    },
    rain_gentle: () => {
      cur.rainMm = 9.0;
      cur.rhPct = 86;
      cur.tempC = 17.5;
      cur.windKmh = 12;
      cur.leafWetnessPct = 88;
      const waterRes = state.resources.find((r) => r.id === "RES-EAU");
      if (waterRes) waterRes.stock = Math.min(waterRes.max, waterRes.stock + Math.round(waterRes.max * 0.08));
      state.plots.forEach((p) => {
        if (p.zone !== "Serre") p.moisturePct = Math.min(92, p.moisturePct + 16);
      });
    },
    clear_sunny: () => {
      cur.tempC = 22.0;
      cur.rhPct = 56;
      cur.windKmh = 11;
      cur.rainMm = 0;
      cur.solarWm2 = 680;
      cur.leafWetnessPct = 15;
      cur.pressureHpa = 1021;
    },
  };
  if (events[eventType]) events[eventType]();
}
