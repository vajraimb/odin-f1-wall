function pct(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return (100 * x).toFixed(1) + "%";
}

function pctInt(x) {
  return (100 * (Number(x) || 0)).toFixed(0) + "%";
}

function lapMark(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? "L" + v : "—";
}

function renderPredictions(preds) {
  const el = document.getElementById("predict-body");
  if (!preds || !preds.length) {
    el.innerHTML = `<div class="empty">还没有赛前预测。跑 odin run cmd/predict 后再 publish。</div>`;
    return;
  }
  el.innerHTML = preds
    .map((p) => {
      const rows = (p.candidates || [])
        .slice()
        .sort((a, b) => (b.win_prob || 0) - (a.win_prob || 0))
        .slice(0, 8)
        .map((c) => {
          const cls = c.prior ? "actual" : c.label === p.best_label ? "best" : "";
          return `<div class="srow ${cls}">
            <div><div class="slabel">${c.prior ? "● " : ""}${c.label}</div></div>
            <div class="pct">${pct(c.win_prob)}</div>
            <div class="epos">E${Number(c.expected_pos).toFixed(1)}</div>
          </div>`;
        })
        .join("");
      const notes = (p.notes || []).map((n) => `<div>${n}</div>`).join("");
      return `<div class="call-kicker">${p.circuit || ""} · ${p.acronym} #${p.driver} · 先验 P${p.grid_pos || "?"} · 不是复盘</div>
        <div class="call-action stay">${p.best_label || "—"}</div>
        <div class="metrics">
          <div class="metric"><div class="lbl">P(WIN)</div><div class="val">${pct(p.win_prob)}</div><div class="sub">先验 ${p.prior_label || "—"}</div></div>
          <div class="metric"><div class="lbl">E[POS]</div><div class="val">${Number(p.expected_pos).toFixed(1)}</div><div class="sub">领奖台 ${pct(p.podium_prob)}</div></div>
        </div>
        <div class="call-note">气候窗口 ${p.window_start ? "L" + p.window_start + "–L" + p.window_end : "—"} · 首次进站中位 ${p.median_first_stop ? "L" + p.median_first_stop : "—"}</div>
        <div style="margin-top:14px">${rows}</div>
        <div class="caveats" style="padding:10px 0 0">${notes}</div>`;
    })
    .join("<hr style='border:0;border-top:1px solid #1c222b;margin:18px 0' />");
}

function useStaticApi() {
  return location.hostname.endsWith("github.io") || location.protocol === "https:";
}

function insightsUrl() {
  return useStaticApi() ? "api/insights.json" : "/api/insights";
}

async function loadInsights() {
  let r = await fetch(insightsUrl(), { cache: "no-store" });
  if (!r.ok) {
    r = await fetch("api/insights.json", { cache: "no-store" });
  }
  if (!r.ok) {
    document.getElementById("pace").innerHTML = `<div class="empty">还没有速度榜数据。先跑 odin run cmd/pace。</div>`;
    document.getElementById("predict-body").innerHTML = `<div class="empty">还没有赛前预测。</div>`;
    document.getElementById("climate").innerHTML = `<div class="empty">还没有气候数据。先跑 odin run cmd/climate。</div>`;
    return;
  }
  const data = await r.json();
  renderPredictions(data.predictions || []);
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
  const ckeys = Object.keys(climates).sort((a, b) =>
    String(climates[a].circuit || a).localeCompare(climates[b].circuit || b)
  );
  const countEl = document.getElementById("climate-count");
  if (countEl) countEl.textContent = ckeys.length ? String(ckeys.length) : "";
  if (!ckeys.length) {
    croot.innerHTML = `<div class="empty">还没有气候数据。先跑 odin run cmd/climate。</div>`;
    return;
  }
  croot.innerHTML = ckeys
    .map((k) => {
      const c = climates[k];
      const sessions = (c.sessions || []).join(" · ") || k;
      const window =
        Number(c.window_start) > 0
          ? lapMark(c.window_start) + "–" + lapMark(c.window_end)
          : "—";
      return `<div class="card">
        <h3>${c.circuit || k}</h3>
        <div class="card-kicker">样本 ${c.n_races || 0} 场 · ${sessions}</div>
        <div class="card-row"><span>SC/红旗场次</span><b>${pctInt(c.sc_race_frac)}</b></div>
        <div class="card-row"><span>中性化圈</span><b>${pct(c.sc_lap_frac)}</b></div>
        <div class="card-row"><span>降雨场次</span><b>${pctInt(c.rain_race_frac)}</b></div>
        <div class="card-row"><span>首次进站</span><b>${lapMark(c.median_first_stop)}</b></div>
        <div class="card-row"><span>窗口</span><b>${window}</b></div>
      </div>`;
    })
    .join("");
}
loadInsights();
