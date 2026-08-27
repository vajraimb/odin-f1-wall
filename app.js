const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const state = {
  session: params.get("session") || "9636",
  driver: params.get("driver") || "4",
  react: params.get("react") ?? "",
};

function tyreClass(compound) {
  const u = (compound || "").toUpperCase();
  if (u.startsWith("SOFT")) return "S";
  if (u.startsWith("MED")) return "M";
  if (u.startsWith("HARD")) return "H";
  if (u.startsWith("INT")) return "I";
  if (u.startsWith("WET")) return "W";
  return "?";
}

function pct(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return (100 * x).toFixed(1) + "%";
}

function pos(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return Number(x).toFixed(1);
}

function useStaticApi() {
  return location.hostname.endsWith("github.io") || location.protocol === "https:";
}

function catalogUrl() {
  return useStaticApi() ? "api/catalog.json" : "/api/catalog";
}

function boardUrl() {
  if (!useStaticApi()) {
    const q = new URLSearchParams({
      session: state.session,
      driver: state.driver,
      react: state.react,
    });
    return "/api/board?" + q.toString();
  }
  const react = state.react === "1" ? "-react" : "";
  return `api/${state.session}-${state.driver}${react}.json`;
}

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(url + " " + r.status);
  }
  return r.json();
}

async function loadCatalog() {
  const cat = await loadJSON(catalogUrl());
  const sel = $("session");
  sel.innerHTML = "";
  for (const s of cat.sessions) {
    const opt = document.createElement("option");
    opt.value = s.session_key;
    opt.textContent = `${s.session_key}  ${s.circuit} ${s.session_name}  ${s.date}${s.wet ? "  WET" : ""}`;
    sel.appendChild(opt);
  }
  if (![...sel.options].some((o) => o.value === state.session) && sel.options.length) {
    state.session = sel.options[0].value;
  }
  sel.value = state.session;
}

function fillDrivers(board) {
  const sel = $("driver");
  const prev = state.driver;
  sel.innerHTML = "";
  for (const row of board.tower) {
    const opt = document.createElement("option");
    opt.value = row.driver;
    opt.textContent = `${row.acronym}  #${row.driver}`;
    sel.appendChild(opt);
  }
  if (![...sel.options].some((o) => o.value === String(prev)) && sel.options.length) {
    state.driver = sel.options[0].value;
  } else {
    state.driver = prev;
  }
  sel.value = state.driver;
  $("react").value = state.react;
}

function renderTower(board) {
  $("tower-sub").textContent = `L${board.fork_lap}`;
  const root = $("tower");
  root.innerHTML = "";
  for (const row of board.tower) {
    const div = document.createElement("div");
    div.className = "trow" + (row.target ? " target" : "") + (row.dnf ? " dnf" : "");
    const cls = tyreClass(row.compound);
    const age = row.compound ? `${cls}${row.tyre_age}` : "—";
    const fin = row.finish && row.finish !== row.position ? `<span class="finish-tag">F${row.finish}</span>` : "";
    div.innerHTML = `
      <span>${row.position ?? "—"}</span>
      <span class="acr"><span class="team-pip" style="background:${row.color}"></span>${row.acronym}${fin}</span>
      <span class="gap">${row.gap}</span>
      <span class="tyre ${cls}">${age}</span>`;
    div.title = `${row.name} · ${row.team}${row.finish ? " · finish P" + row.finish : ""}`;
    div.addEventListener("click", () => {
      state.driver = String(row.driver);
      refresh();
    });
    root.appendChild(div);
  }
}

function renderCall(board) {
  const el = $("call");
  const c = board.call;
  const t = board.target;
  if (!c) {
    el.innerHTML = `<div class="empty">本场还没有复盘模拟。未开赛请看 <a href="insights.html#predict">赛前粗预测</a>。</div>`;
    return;
  }
  const stay = (c.best_action || "").toLowerCase().includes("stay");
  const compound = c.best_compound_short && c.best_compound_short !== "?" ? c.best_compound_short : (c.best_compound || "");
  const action = stay ? "STAY OUT" : `PIT ${compound}`.trim();
  const dWin = c.delta;
  const dPos = (c.actual_pos ?? 0) - (c.best_pos ?? 0);
  const flags = board.flags || {};
  const rf = (flags.red_flag_laps || []).length
    ? `<br />Red flag L${flags.red_flag_laps.join(",")} · free tyre change on restart${flags.restart_lap ? " L" + flags.restart_lap : ""}.`
    : "";
  el.innerHTML = `
    <div class="call-kicker">${t.team || ""} · ${t.acronym} #${t.driver} · FORK L${c.lap}${flags.wet_race ? " · WET" : ""}</div>
    <div class="call-action ${stay ? "stay" : "pit"}">${action}</div>
    <div class="metrics">
      <div class="metric">
        <div class="lbl">P(WIN)</div>
        <div class="val">${pct(c.best_win)}</div>
        <div class="sub">actual ${pct(c.actual_win)}
          <span class="${dWin > 0 ? "delta-up" : "delta-down"}">${dWin >= 0 ? "+" : ""}${(100 * (dWin || 0)).toFixed(1)} pp</span>
        </div>
      </div>
      <div class="metric">
        <div class="lbl">E[POS]</div>
        <div class="val">${pos(c.best_pos)}</div>
        <div class="sub">actual ${pos(c.actual_pos)}
          <span class="${dPos > 0 ? "delta-up" : "delta-down"}">${dPos > 0 ? "▲" : "▼"} ${Math.abs(dPos).toFixed(1)}</span>
        </div>
      </div>
    </div>
    <div class="call-note">
      Actual remaining <code>${c.actual_label || "—"}</code><br />
      Best alternative <code>${c.best_label || "—"}</code>
      ${c.react ? `<br />Rival ${c.react} covers target stops.` : ""}
      ${c.iterations ? `<br />${c.iterations} Monte Carlo rolls · ${c.mode || ""}` : ""}
      ${rf}
    </div>`;
}

function renderLadder(board) {
  const el = $("ladder");
  const rows = (board.strategies || []).slice();
  if (!rows.length) {
    el.innerHTML = `<div class="empty">No strategy search loaded.</div>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.win_prob || 0), 0.01);
  const bestLabel = board.call && board.call.best_label;
  el.innerHTML = rows
    .slice(0, 12)
    .map((r) => {
      const w = 100 * ((r.win_prob || 0) / max);
      const cls = r.actual ? "actual" : r.label === bestLabel ? "best" : "";
      return `<div class="srow ${cls}">
        <div>
          <div class="slabel">${r.actual ? "● " : ""}${r.label}</div>
          <div class="bar-wrap"><div class="bar" style="width:${w}%"></div></div>
        </div>
        <div class="pct">${pct(r.win_prob)}</div>
        <div class="epos">${r.expected_pos != null ? "E" + Number(r.expected_pos).toFixed(1) : ""}</div>
      </div>`;
    })
    .join("");
}

function bandHtml(board, total) {
  return (board.bands || [])
    .map((b) => {
      const left = (100 * (b.start - 1)) / total;
      const width = (100 * Math.max(1, b.end - b.start + 1)) / total;
      return `<div class="band ${b.kind}" style="left:${left}%;width:${width}%" title="${b.kind} L${b.start}–${b.end}"></div>`;
    })
    .join("");
}

function renderStints(board) {
  const el = $("stints");
  const total = board.session.total_laps || 50;
  const forkPct = (100 * board.fork_lap) / total;
  const bands = bandHtml(board, total);
  el.innerHTML = board.tower
    .map((row) => {
      const segs = (row.stints || [])
        .map((s) => {
          const start = s.start || 1;
          const end = s.end || start;
          const left = (100 * (start - 1)) / total;
          const width = (100 * Math.max(1, end - start + 1)) / total;
          return `<div class="seg ${s.compound || ""}" style="left:${left}%;width:${width}%" title="${s.compound} L${start}–${end}"></div>`;
        })
        .join("");
      const racing = (row.pits || [])
        .map((lap) => `<div class="rpit" style="left:${(100 * (lap - 0.5)) / total}%" title="racing pit L${lap}"></div>`)
        .join("");
      const halt = (row.halt_pits || [])
        .map((lap) => `<div class="halt" style="left:${(100 * (lap - 0.5)) / total}%" title="red-flag halt L${lap}"></div>`)
        .join("");
      return `<div class="smap ${row.target ? "target" : ""}">
        <span>${row.position ?? "—"}</span>
        <span class="acr">${row.acronym}</span>
        <div class="track">${bands}${segs}${racing}${halt}<div class="fork" style="left:${forkPct}%"></div></div>
      </div>`;
    })
    .join("");
}

function renderHeader(board) {
  const s = board.session;
  const t = board.target;
  const forkP = t.fork_position ? `fork P${t.fork_position} → ` : "";
  $("meta").textContent =
    `${s.circuit} ${s.year || ""} ${s.name}  ·  ${s.date}  ·  L${board.fork_lap}/${s.total_laps}  ·  ${t.acronym} ${forkP}P${t.result ?? "?"}  ·  ${t.strategy || ""}`;
  document.title = `STRAT WALL · ${s.circuit} · ${t.acronym}`;
}

function renderFlags(board) {
  const f = board.flags || {};
  const pills = [];
  if (f.wet_race) pills.push(`<span class="pill wet">WET</span>`);
  if (f.rainfall) pills.push(`<span class="pill rain">RAIN</span>`);
  if (f.phase_at_fork) pills.push(`<span class="pill phase ${f.phase_at_fork}">${String(f.phase_at_fork).replaceAll("_", " ")}</span>`);
  if (f.track_temp != null) pills.push(`<span class="pill">TRK ${Number(f.track_temp).toFixed(1)}°</span>`);
  if (f.air_temp != null) pills.push(`<span class="pill">AIR ${Number(f.air_temp).toFixed(1)}°</span>`);
  if ((f.red_flag_laps || []).length) pills.push(`<span class="pill red">RED L${f.red_flag_laps.join(",")}</span>`);
  if (f.restart_lap) pills.push(`<span class="pill">RESTART L${f.restart_lap}</span>`);
  if ((f.sc_laps || []).length) {
    const sc = f.sc_laps.length > 6 ? `${f.sc_laps[0]}–${f.sc_laps[f.sc_laps.length - 1]}` : f.sc_laps.join(",");
    pills.push(`<span class="pill sc">SC L${sc}</span>`);
  }
  if ((f.vsc_laps || []).length) pills.push(`<span class="pill vsc">VSC L${f.vsc_laps.join(",")}</span>`);
  const order = (f.restart_order || []).map((r) => r.acronym).filter(Boolean);
  if (order.length) {
    pills.push(`<span class="restart-line">ACTUAL RESTART <b>${order.slice(0, 8).join(" ")}</b>${order.length > 8 ? " …" : ""}</span>`);
  }
  $("flags").innerHTML = pills.join("");
}

function renderCaveats(board) {
  $("caveats").textContent = (board.caveats || []).join("  ·  ");
}

function syncUrl() {
  const q = new URLSearchParams({
    session: state.session,
    driver: state.driver,
    react: state.react,
  });
  history.replaceState(null, "", "?" + q.toString());
}

async function refresh() {
  syncUrl();
  let board;
  try {
    board = await loadJSON(boardUrl());
  } catch (err) {
    if (useStaticApi() && state.react === "1") {
      state.react = "";
      $("react").value = "";
      board = await loadJSON(boardUrl());
    } else {
      $("call").innerHTML = `<div class="empty">No board for this driver (${err.message}).</div>`;
      return;
    }
  }
  fillDrivers(board);
  renderHeader(board);
  renderFlags(board);
  renderTower(board);
  renderCall(board);
  renderLadder(board);
  renderStints(board);
  renderCaveats(board);
}

$("session").addEventListener("change", async (e) => {
  state.session = e.target.value;
  state.driver = "1";
  await refresh();
});
$("driver").addEventListener("change", (e) => {
  state.driver = e.target.value;
  refresh();
});
$("react").addEventListener("change", (e) => {
  state.react = e.target.value;
  refresh();
});

loadCatalog().then(refresh);
