async function loadInsights() {
  const r = await fetch("api/insights.json");
  if (!r.ok) {
    document.getElementById("pace").innerHTML = `<div class="empty">还没有速度榜数据。先跑 odin run cmd/pace。</div>`;
    return;
  }
  const data = await r.json();
  const paces = data.paces || {};
  const keys = Object.keys(paces).sort((a, b) => Number(b) - Number(a));
  const paceRoot = document.getElementById("pace");
  if (!keys.length) {
    paceRoot.innerHTML = `<div class="empty">还没有速度榜。</div>`;
  } else {
    paceRoot.innerHTML = keys
      .map((k) => {
        const b = paces[k];
        const rows = (b.rows || [])
          .slice(0, 12)
          .map(
            (row) =>
              `<tr><td>${row.rank}</td><td>${row.acronym} #${row.driver}</td><td>${row.team || ""}</td><td class="num">${Number(row.base).toFixed(3)}</td><td class="num">+${Number(row.delta).toFixed(3)}</td><td class="num">${row.n_samples}</td><td>${row.finish ? "P" + row.finish : "—"}</td></tr>`
          )
          .join("");
        return `<h3 style="font-size:12px;letter-spacing:0.12em;color:#7d8794">${k} · ${b.circuit || ""}</h3>
          <table class="insight-table">
            <thead><tr><th>P</th><th>DRIVER</th><th>TEAM</th><th>BASE</th><th>DELTA</th><th>N</th><th>FINISH</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      })
      .join("");
  }
  const climates = data.climates || {};
  const croot = document.getElementById("climate");
  const ckeys = Object.keys(climates);
  if (!ckeys.length) {
    croot.innerHTML = `<div class="empty">还没有气候数据。先跑 odin run cmd/climate。</div>`;
    return;
  }
  croot.innerHTML = ckeys
    .map((k) => {
      const c = climates[k];
      return `<div class="card">
        <h3>${c.circuit || k}</h3>
        <div>样本 ${c.n_races} 场</div>
        <div>SC/红旗场次 ${(100 * (c.sc_race_frac || 0)).toFixed(0)}%</div>
        <div>中性化圈 ${(100 * (c.sc_lap_frac || 0)).toFixed(1)}%</div>
        <div>降雨场次 ${(100 * (c.rain_race_frac || 0)).toFixed(0)}%</div>
        <div>首次进站 ${c.median_first_stop ? "L" + c.median_first_stop : "—"}</div>
        <div>窗口 ${c.window_start ? "L" + c.window_start + "–L" + c.window_end : "—"}</div>
      </div>`;
    })
    .join("");
}
loadInsights();
