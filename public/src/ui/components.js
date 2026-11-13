/**
 * Composants UI partages et generateurs de graphiques SVG sans dependance.
 */

export function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtEur(val) {
  return `${Math.round(Number(val) || 0).toLocaleString("fr-FR")} €`;
}

export function kpiCard(label, value, sub = "", tone = "") {
  const color =
    tone === "ok" ? "color:#4ade80" :
    tone === "warn" ? "color:#fbbf24" :
    tone === "bad" ? "color:#fb7185" : "";
  return `
    <div class="kpi-card">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value" style="${color}">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}
    </div>
  `;
}

export function progressBar(pct, color = "#22c55e") {
  const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return `
    <div class="progress-bar">
      <div class="progress-fill" style="width:${clamped}%;background:${color};"></div>
    </div>
  `;
}

export function pill(text, tone = "info") {
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

/**
 * Genere un graphique SVG multi-series propre (lignes ou courbes de prevision).
 */
export function renderLineChartSvg(seriesList, labels = [], height = 175) {
  const width = 560;
  const padL = 44, padR = 14, padT = 16, padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allVals = seriesList.flatMap((s) => s.values);
  let minV = Math.min(...allVals, 0);
  let maxV = Math.max(...allVals, 10);
  if (Math.abs(maxV - minV) < 1e-3) maxV = minV + 10;

  const mapY = (v) => padT + innerH - ((v - minV) / (maxV - minV)) * innerH;
  const maxLen = Math.max(2, ...seriesList.map((s) => s.values.length));
  const mapX = (i) => padL + (i / (maxLen - 1)) * innerW;

  const gridLines = [0, 0.5, 1].map((t) => {
    const y = padT + innerH * t;
    const val = Math.round(maxV - (maxV - minV) * t);
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3 3"/>
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#93a7b8">${val}</text>
    `;
  }).join("");

  const paths = seriesList.map((s) => {
    const pts = s.values.map((v, i) => `${mapX(i).toFixed(1)},${mapY(v).toFixed(1)}`).join(" ");
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>`;
  }).join("");

  const legend = seriesList.map((s) =>
    `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#cbd5e1;">
      <span style="width:10px;height:3px;background:${s.color};display:inline-block;border-radius:2px;"></span>${esc(s.label)}
    </span>`
  ).join("");

  const startLbl = labels[0] || "";
  const midLbl = labels[Math.floor(labels.length / 2)] || "";
  const endLbl = labels[labels.length - 1] || "";

  return `
    <div>
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block;">
        ${gridLines}
        ${paths}
        <text x="${padL}" y="${height - 6}" font-size="10" fill="#93a7b8">${esc(startLbl)}</text>
        <text x="${padL + innerW / 2}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#93a7b8">${esc(midLbl)}</text>
        <text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="#93a7b8">${esc(endLbl)}</text>
      </svg>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">${legend}</div>
    </div>
  `;
}

/**
 * Genere un graphique Radar SVG 6 axes pour le Score d'Autonomie ludique.
 */
export function renderRadarSvg(items, size = 230) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const n = items.length || 6;

  const ring = (ratio) => {
    const pts = items.map((_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return `${(cx + Math.cos(a) * r * ratio).toFixed(1)},${(cy + Math.sin(a) * r * ratio).toFixed(1)}`;
    }).join(" ");
    return `<polygon points="${pts}" fill="none" stroke="rgba(148,163,184,0.22)" stroke-width="1"/>`;
  };

  const axes = items.map((it, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const lx = cx + Math.cos(a) * (r + 22);
    const ly = cy + Math.sin(a) * (r + 16);
    const anchor = Math.cos(a) > 0.2 ? "start" : Math.cos(a) < -0.2 ? "end" : "middle";
    return `
      <line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}" stroke="rgba(148,163,184,0.2)"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="#cbd5e1">${esc(it.label)} (${it.score})</text>
    `;
  }).join("");

  const polyPts = items.map((it, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rad = r * Math.max(0.1, Math.min(1, it.score / 100));
    return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
  }).join(" ");

  return `
    <svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px;height:auto;display:block;margin:0 auto;">
      ${ring(0.33)} ${ring(0.66)} ${ring(1)}
      ${axes}
      <polygon points="${polyPts}" fill="rgba(34,197,94,0.26)" stroke="#22c55e" stroke-width="2"/>
    </svg>
  `;
}
