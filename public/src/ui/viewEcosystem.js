import { ACTIVITY_DEFS, buildPresetState, CLIMATE_LOCATIONS, SCALE_PRESETS, TROPHIES_DEF } from "../data/presets.js";
import { pushHudAlert } from "../engine/automation.js";
import { buildSyntheticForecast, searchCity, syncOpenMeteo } from "../engine/weather.js";
import { esc, pill, renderRadarSvg } from "./components.js";

export function renderViewEcosystem(container, ctx) {
  const { state, forecast, serverStatus } = ctx;
  const mcpUrl = `${location.origin}/mcp`;
  const glassesUrl = `${location.origin}/glasses.html`;
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        "sg-vision-farmer": {
          type: "http",
          url: mcpUrl,
        },
      },
    },
    null,
    2
  );

  container.innerHTML = `
    <div class="grid-2" style="margin-bottom:14px;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🏆 Score d'Autonomie & Trophées Ludiques</h3>
          ${pill(`Score Global ${forecast.globalScore} / 100`, forecast.globalScore >= 75 ? "ok" : "info")}
        </div>
        <div class="grid-2" style="align-items:center;">
          <div>
            ${renderRadarSvg(forecast.autonomyRadar)}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${TROPHIES_DEF.map((t) => {
              const unlocked = forecast.unlockedTrophies.includes(t.id);
              return `
                <div class="trophy-card ${unlocked ? "unlocked" : ""}">
                  <span style="font-size:20px;">${unlocked ? t.icon : "🔒"}</span>
                  <div>
                    <strong>${esc(t.title)}</strong>
                    <div class="muted">${esc(t.desc)}</div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🌍 Localisation, Climat & Échelle de Ferme</h3>
        </div>
        <form id="form-farm-meta" class="form-row" style="margin-bottom:10px;">
          <label class="field" style="flex:1;min-width:170px;">
            Nom de l'exploitation
            <input class="input" name="name" value="${esc(state.farm.name)}" required />
          </label>
          <label class="field" style="width:110px;">
            Surface (ha)
            <input class="input" type="number" step="0.1" name="areaHa" value="${state.farm.areaHa}" required />
          </label>
          <button class="btn btn-primary btn-sm" type="submit">Enregistrer</button>
        </form>

        <div style="margin-bottom:10px;">
          <div class="muted" style="margin-bottom:4px;">Activités actives sur la ferme :</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${ACTIVITY_DEFS.map((a) => {
              const on = state.farm.activities.includes(a.id);
              return `<button class="btn btn-sm ${on ? "active" : ""}" data-toggle-act="${a.id}">${a.icon} ${esc(a.label)}</button>`;
            }).join("")}
          </div>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:8px;">
          <div class="muted" style="margin-bottom:6px;">
            Climat actuel : <strong>${esc(state.farm.location.name)}</strong> (${state.farm.location.lat}°, ${state.farm.location.lon}°) — ${esc(state.farm.location.climate)}
          </div>
          <div class="form-row" style="margin-bottom:8px;">
            <input class="input" id="city-search-input" placeholder="Rechercher une ville / commune (Open-Meteo)..." style="flex:1;" />
            <button class="btn btn-sm" id="btn-city-search">🔍 Chercher</button>
            <button class="btn btn-primary btn-sm" id="btn-sync-geo-wx">🛰️ Météo Live</button>
          </div>
          <div id="city-search-results" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${CLIMATE_LOCATIONS.map((loc) => `
              <button class="btn btn-sm ${state.farm.location.id === loc.id ? "active" : ""}" data-loc-preset="${loc.id}">${esc(loc.name.split("/")[0].trim())}</button>
            `).join("")}
          </div>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px;">
          <div class="muted" style="margin-bottom:6px;">Changer d'échelle / Charger un modèle d'exploitation :</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${SCALE_PRESETS.map((p) => `
              <button class="btn btn-sm ${state.farm.presetId === p.id ? "btn-amber" : ""}" data-load-preset="${p.id}" title="${esc(p.desc)}">${esc(p.label)}</button>
            `).join("")}
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🥽 Lunettes Connectées AR & Pilotage Vocal</h3>
          <a class="btn btn-primary btn-sm" href="/glasses.html" target="_blank">Ouvrir HUD Lunettes AR ↗</a>
        </div>
        <div class="muted" style="margin-bottom:8px;">
          URL tête haute : <code>${esc(glassesUrl)}</code> · Synchronisée en direct par <code>BroadcastChannel</code> et <code>/api/hud</code>.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <input class="input" id="hud-msg-input" placeholder="Envoyer une consigne aux lunettes AR (ex: Vérifier goutteur P2)..." />
          <button class="btn btn-primary btn-sm" id="btn-hud-push">Envoyer AR</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:190px;overflow-y:auto;">
          ${(state.hud?.alerts || []).map((a) => `
            <div style="padding:7px 9px;border-radius:8px;background:var(--bg-soft);border:1px solid var(--border);font-size:12px;">
              ${pill(a.severity, a.severity === "warn" ? "warn" : "info")} ${esc(a.message)}
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🧠 Connecteur Autres IA, MCP & Domotique IoT</h3>
          ${pill(serverStatus.online ? "Serveur local + MCP actif" : "Mode statique navigateur", serverStatus.online ? "ok" : "warn")}
        </div>
        <div class="muted" style="margin-bottom:8px;">
          Connectez Antigravity, Claude Desktop, Cursor, Home Assistant ou un modèle local <strong>Ollama</strong>.
        </div>
        <form id="form-ai-cfg" class="form-row" style="margin-bottom:10px;">
          <label class="field" style="width:145px;">
            Moteur IA Chat
            <select class="input" name="provider">
              <option value="local" ${state.aiSettings?.provider === "local" ? "selected" : ""}>IA Agro Locale (Hors-ligne)</option>
              <option value="ollama" ${state.aiSettings?.provider === "ollama" ? "selected" : ""}>Ollama Local</option>
            </select>
          </label>
          <label class="field" style="flex:1;min-width:160px;">
            URL Ollama
            <input class="input" name="ollamaUrl" value="${esc(state.aiSettings?.ollamaUrl || "http://localhost:11434")}" />
          </label>
          <label class="field" style="width:110px;">
            Modèle
            <input class="input" name="model" value="${esc(state.aiSettings?.model || "mistral")}" />
          </label>
          <button class="btn btn-primary btn-sm" type="submit">Appliquer</button>
        </form>

        <div class="muted" style="margin-bottom:4px;">Configuration MCP Streamable HTTP (<code>POST /mcp</code> · ${serverStatus.mcpTools || 6} outils) :</div>
        <pre style="background:rgba(4,10,16,0.9);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:11.5px;overflow-x:auto;margin:0 0 8px;">${esc(mcpSnippet)}</pre>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" id="btn-copy-mcp">📋 Copier Config MCP</button>
          <button class="btn btn-sm" id="btn-test-webhook">📡 Tester Webhook IoT (/api/telemetry)</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#form-farm-meta").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.farm.name = fd.get("name");
    state.farm.areaHa = Number(fd.get("areaHa")) || 1;
    ctx.toast("Informations de l'exploitation enregistrées !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-toggle-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleAct;
      const idx = state.farm.activities.indexOf(id);
      if (idx >= 0) state.farm.activities.splice(idx, 1);
      else state.farm.activities.push(id);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelectorAll("[data-loc-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const loc = CLIMATE_LOCATIONS.find((l) => l.id === btn.dataset.locPreset);
      if (!loc) return;
      state.farm.location = { id: loc.id, name: loc.name, lat: loc.lat, lon: loc.lon, climate: loc.climate };
      state.weather.forecast = buildSyntheticForecast(loc.id, 14);
      ctx.toast(`Climat basculé sur ${loc.name}`);
      ctx.save();
      ctx.rerender();
    });
  });

  container.querySelector("#btn-city-search").addEventListener("click", async () => {
    const q = container.querySelector("#city-search-input").value;
    const list = await searchCity(q);
    const box = container.querySelector("#city-search-results");
    if (!list.length) {
      box.innerHTML = `<span class="muted">Aucun résultat trouvé.</span>`;
      return;
    }
    box.innerHTML = list.map((c) => `
      <button class="btn btn-sm" data-pick-city='${esc(JSON.stringify(c))}'>📍 ${esc(c.name)}</button>
    `).join("");
    box.querySelectorAll("[data-pick-city]").forEach((cb) => {
      cb.addEventListener("click", async () => {
        const c = JSON.parse(cb.dataset.pickCity);
        state.farm.location = { id: c.id, name: c.name, lat: c.lat, lon: c.lon, climate: c.climate };
        const wx = await syncOpenMeteo(c.lat, c.lon, c.id);
        state.weather.source = wx.source;
        state.weather.current = wx.current;
        state.weather.forecast = wx.forecast;
        ctx.toast(`Localisation définie sur ${c.name}`);
        ctx.save();
        ctx.rerender();
      });
    });
  });

  container.querySelector("#btn-sync-geo-wx").addEventListener("click", async () => {
    const wx = await syncOpenMeteo(state.farm.location.lat, state.farm.location.lon, state.farm.location.id);
    state.weather.source = wx.source;
    state.weather.current = wx.current;
    state.weather.forecast = wx.forecast;
    ctx.toast(wx.ok ? "Météo Open-Meteo mise à jour !" : "Repli modèle climatique local actif.");
    ctx.save();
    ctx.rerender();
  });

  container.querySelectorAll("[data-load-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = buildPresetState(btn.dataset.loadPreset);
      ctx.replaceState(next);
      ctx.toast(`Profil chargé : ${next.farm.name}`);
    });
  });

  container.querySelector("#btn-hud-push").addEventListener("click", () => {
    const inp = container.querySelector("#hud-msg-input");
    const msg = inp.value.trim();
    if (!msg) return;
    pushHudAlert(state, msg, "info");
    inp.value = "";
    ctx.toast("Message envoyé aux lunettes connectées AR !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelector("#form-ai-cfg").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.aiSettings = {
      provider: fd.get("provider"),
      ollamaUrl: fd.get("ollamaUrl"),
      model: fd.get("model"),
    };
    ctx.toast("Configuration IA enregistrée !");
    ctx.save();
    ctx.rerender();
  });

  container.querySelector("#btn-copy-mcp").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mcpSnippet);
      ctx.toast("Configuration MCP copiée dans le presse-papiers !");
    } catch {
      ctx.toast("Sélectionnez le bloc JSON MCP pour le copier.");
    }
  });

  container.querySelector("#btn-test-webhook").addEventListener("click", async () => {
    try {
      const resp = await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sensor: "soil_probe_P1", moisturePct: 59, tempC: state.weather.current.tempC }),
      });
      ctx.toast(resp.ok ? "Webhook IoT /api/telemetry testé avec succès !" : "Serveur local requis pour /api/telemetry.");
    } catch {
      ctx.toast("Démarrez DEMARRER-FARMER.bat pour activer les webhooks locaux.");
    }
  });
}
