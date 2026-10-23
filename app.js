const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const state = {
  session: params.get("session") || "",
  driver: params.get("driver") || "",
  react: params.get("react") ?? "",
};
let catalogCache = { sessions: [] };

function sessionEntry(key) {
  return (catalogCache.sessions || []).find((s) => String(s.session_key) === String(key));
}

function reviewedDrivers(key) {
  const s = sessionEntry(key);
  return (s && s.review_drivers) || [];
}

function pickDriverForSession(key, preferred) {
  const reviewed = reviewedDrivers(key).map(String);
  if (preferred && reviewed.includes(String(preferred))) return String(preferred);
  if (!preferred && reviewed.length) return reviewed[0];
  if (preferred) return String(preferred);
  if (reviewed.length) return reviewed[0];
  return "1";
}

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
  if (document.documentElement.dataset.static === "1") return true;
  return location.hostname.endsWith("github.io") || location.protocol === "https:" || location.protocol === "file:";
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

async function loadJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = url + " " + r.status;
    try {
      const body = await r.json();
      if (body && body.error) msg = body.error;
    } catch (_) {
      /* keep the status message */
    }
    throw new Error(msg);
  }
  return r.json();
}

async function loadCatalog() {
  const cat = await loadJSON(catalogUrl());
  const races = (cat.sessions || [])
    .filter((s) => (s.session_name || "Race") === "Race")
    .slice()
    .sort((a, b) => {
      const ar = (a.review_drivers || []).length ? 0 : 1;
      const br = (b.review_drivers || []).length ? 0 : 1;
      if (ar !== br) return ar - br;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  catalogCache = { sessions: races };
  const sel = $("session");
  sel.innerHTML = "";
  for (const s of races) {
    const opt = document.createElement("option");
    opt.value = s.session_key;
    const mark = (s.review_drivers || []).length ? "  ●" : "";
    opt.textContent = `${s.session_key}  ${s.circuit} ${s.session_name}  ${s.date}${s.wet ? "  WET" : ""}${mark}`;
    sel.appendChild(opt);
  }
  if (!state.session || ![...sel.options].some((o) => o.value === state.session)) {
    const withReview = races.find((s) => (s.review_drivers || []).length);
    state.session = String((withReview || races[0] || {}).session_key || "");
  }
  sel.value = state.session;
  state.driver = pickDriverForSession(state.session, state.driver);
}

function fillDrivers(board) {
  const sel = $("driver");
  const reviewed = new Set(reviewedDrivers(state.session).map(String));
  sel.innerHTML = "";
  for (const row of board.tower) {
    const opt = document.createElement("option");
    opt.value = row.driver;
    opt.textContent = `${row.acronym}  #${row.driver}${reviewed.has(String(row.driver)) ? "  ●" : ""}`;
    sel.appendChild(opt);
  }
  if (![...sel.options].some((o) => o.value === String(state.driver))) {
    state.driver = pickDriverForSession(state.session, "");
    if (![...sel.options].some((o) => o.value === String(state.driver)) && sel.options.length) {
      state.driver = sel.options[0].value;
    }
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
    const run = useStaticApi()
      ? ""
      : `<div class="sim-hint">在 <a href="races.html?session=${encodeURIComponent(state.session)}&run=${encodeURIComponent(state.session)}">RACES</a> 页为 ${t.acronym || "#" + t.driver} 运行模拟；完成后这里会自动刷新。</div><div class="sim-hint" id="job-hint"></div>`;
    el.innerHTML = `<div class="empty">本场还没有复盘模拟。未开赛请看 <a href="insights.html#predict">赛前粗预测</a>。${run}</div>`;
    watchJobs();
    return;
  }
  stopWatchingJobs();
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

// While the board has no simulation, poll the local job runner so a result written by
// the RACES page (or by hand) shows up without a manual reload.
let jobTimer = null;
let jobSeen = new Map();

function stopWatchingJobs() {
  clearTimeout(jobTimer);
  jobTimer = null;
}

function watchJobs() {
  stopWatchingJobs();
  if (useStaticApi()) return;
  const session = state.session;
  const driver = state.driver;
  const tick = async () => {
    if (state.session !== session || state.driver !== driver) return;
    let data;
    try {
      data = await loadJSON(`/api/jobs?session=${encodeURIComponent(session)}&driver=${encodeURIComponent(driver)}`);
    } catch (_) {
      return; // no backend: stop polling
    }
    const jobs = (data.jobs || []).filter((j) => j.kind === "simulate");
    const active = jobs.find((j) => j.status === "running" || j.status === "queued");
    const hint = $("job-hint");
    let finished = false;
    for (const j of jobs) {
      const prev = jobSeen.get(j.id);
      if (prev && prev !== j.status && j.status === "done") finished = true;
      jobSeen.set(j.id, j.status);
    }
    if (finished) {
      await loadCatalog();
      await refresh();
      return;
    }
    if (hint) {
      hint.textContent = active ? `simulation ${active.status}${active.steps > 1 ? ` · step ${active.step}/${active.steps}` : ""} …` : "";
    }
    jobTimer = setTimeout(tick, active ? 2000 : 8000);
  };
  tick();
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
  if (useStaticApi()) pills.push(`<span class="pill dimp" title="模拟和未缓存的 AI 解读需要本机 strat_wall.py">只读 · 本地版可运行</span>`);
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

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Minimal Markdown for the LLM text: headings, bullets, bold, inline code, paragraphs.
function miniMarkdown(text) {
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^(?:[-*•]|\d+[.、)])\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(`<h4>${inline(h[2])}</h4>`);
    } else if (li) {
      list.push(`<li>${inline(li[1])}</li>`);
    } else {
      flush();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

const CONF_ZH = { high: "可信度高", medium: "可信度中", low: "可信度低" };

function renderAnalysis(board) {
  const panel = $("explain-panel");
  const a = board.analysis;
  if (!a) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const conf = a.confidence || "medium";
  $("explain-sub").innerHTML = `<span class="pill conf ${conf}">${CONF_ZH[conf] || conf}</span>`;
  if (a.error) {
    $("explain").innerHTML = `<div class="empty">${esc(a.error)}</div>`;
    return;
  }
  const sections = (a.sections || [])
    .map((s) => `<div class="xsec"><h4>${esc(s.title)}</h4><ul>${(s.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`)
    .join("");
  const steps = (a.next_steps || []).length
    ? `<div class="xsec"><h4>下一步</h4>${a.next_steps
        .map((n) => `<div class="xstep"><span>${esc(n.why)}</span><code>${esc(n.cmd)}</code></div>`)
        .join("")}</div>`
    : "";
  const run = a.run || {};
  const runLine = run.command
    ? `<div class="xrun">${esc(run.command)}${run.finished_at ? ` · ${esc(run.finished_at)}` : ""}</div>`
    : "";
  let llm = "";
  const canAsk = !useStaticApi() && a.llm_available;
  if (a.llm && a.llm.text) {
    llm = `<div class="xsec xllm">
      <h4>AI 解读 <span class="xmeta">${esc(a.llm.model || "")} · ${esc(a.llm.generated_at || "")}</span>
        ${canAsk ? `<button type="button" class="btn sm" id="llm-btn" data-force="1">重新生成</button>` : ""}</h4>
      <div class="xllm-body">${miniMarkdown(a.llm.text)}</div></div>`;
  } else if (canAsk) {
    llm = `<div class="xsec xllm"><button type="button" class="btn sm primary" id="llm-btn">AI 解读（调用 LLM）</button>
      <span class="xmeta" id="llm-status">把上面的数字交给 ODIN_LLM_MODEL 写一段工程简报；结果缓存到 data/explain。</span></div>`;
  } else if (useStaticApi()) {
    llm = `<div class="xsec xllm"><button type="button" class="btn sm disabled" disabled>AI 解读</button>
      <span class="local-hint">本地版可运行</span>
      <span class="xmeta">在线看板只展示已缓存的解读，不会调用模型。</span></div>`;
  }
  $("explain").innerHTML = `<div class="xverdict">${esc(a.verdict)}</div>${runLine}<div class="xgrid">${sections}${steps}</div>${llm}${reportBlock(board)}`;
  const btn = $("llm-btn");
  if (btn && !useStaticApi()) btn.addEventListener("click", () => askLlm(btn.dataset.force === "1"));
}

function reportBlock(board) {
  const md = board && board.report;
  if (!md) return "";
  return `<details class="xreport"><summary>复盘报告 <span class="xmeta">${esc((board && board.result_file) || "")}</span></summary><div class="xllm-body">${miniMarkdown(md)}</div></details>`;
}

async function askLlm(force) {
  if (useStaticApi()) return;
  const btn = $("llm-btn");
  const status = $("llm-status");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "生成中…";
  }
  try {
    const analysis = await loadJSON("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: state.session, driver: state.driver, react: state.react, force }),
    });
    renderAnalysis({ analysis });
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = force ? "重新生成" : "AI 解读（调用 LLM）";
    }
    if (status) status.textContent = err.message;
    else if (btn) btn.insertAdjacentHTML("afterend", `<span class="xmeta xerr">${esc(err.message)}</span>`);
  }
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
  renderAnalysis(board);
  renderStints(board);
  renderCaveats(board);
}

$("session").addEventListener("change", async (e) => {
  state.session = e.target.value;
  state.driver = pickDriverForSession(state.session, "");
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
