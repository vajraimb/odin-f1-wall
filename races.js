const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const state = {
  sessions: [],
  backend: null, // null = unknown, true = local strat_wall.py, false = static export
  runner: null,
  jobs: [],
  seen: new Map(), // job id -> last status, to detect transitions
  year: params.get("year") || "",
  status: params.get("status") || "",
  q: params.get("q") || "",
  focus: params.get("session") || "",
  pollTimer: null,
  openLogs: new Set(),
  dialog: null, // { kind, session }
};

const POLL_MS = 2000;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function useStaticApi() {
  if (document.documentElement.dataset.static === "1") return true;
  return location.hostname.endsWith("github.io") || location.protocol === "https:" || location.protocol === "file:";
}

function catalogUrl() {
  return useStaticApi() ? "api/catalog.json" : "/api/catalog";
}

async function loadJSON(url, opts) {
  const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
  let body = null;
  try {
    body = await r.json();
  } catch (_) {
    body = null;
  }
  if (!r.ok) {
    const msg = body && body.error ? body.error : url + " " + r.status;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return body;
}

async function detectBackend() {
  if (useStaticApi()) {
    state.backend = false;
    return;
  }
  try {
    const data = await loadJSON("/api/jobs");
    state.backend = true;
    state.runner = data.runner || null;
    state.jobs = data.jobs || [];
  } catch (_) {
    state.backend = false;
  }
}

async function loadCatalog() {
  let cat;
  try {
    cat = await loadJSON(catalogUrl());
  } catch (err) {
    if (!useStaticApi()) {
      cat = await loadJSON("api/catalog.json");
    } else {
      throw err;
    }
  }
  state.sessions = (cat.sessions || []).slice();
}

function years() {
  const ys = new Set(state.sessions.map((s) => Number(s.year) || 0));
  return [...ys].filter(Boolean).sort((a, b) => b - a);
}

// Older catalog.json exports (static site) only carry result_files, so derive the
// review list and status from those when the newer fields are missing.
function reviewList(s) {
  if (Array.isArray(s.reviews)) return s.reviews;
  const drivers = new Map();
  for (const d of s.review_drivers || []) drivers.set(Number(d), { driver: Number(d), acronym: `#${d}`, react: false });
  for (const f of s.result_files || []) {
    const m = /^(\d+)-(\d+)(-react)?\.json$/.exec(f);
    if (!m) continue;
    const n = Number(m[2]);
    const cur = drivers.get(n) || { driver: n, acronym: `#${n}`, react: false };
    if (m[3]) cur.react = true;
    drivers.set(n, cur);
  }
  return [...drivers.values()].sort((a, b) => a.driver - b.driver);
}

function statusOf(s) {
  if (s.status) return s.status;
  if (reviewList(s).length) return "simulated";
  return s.has_laps === false ? "pending" : "raw";
}

function matches(s) {
  if (state.year && String(s.year) !== state.year) return false;
  if (state.status && statusOf(s) !== state.status) return false;
  if (state.q) {
    const hay = `${s.session_key} ${s.circuit} ${s.location || ""} ${s.country} ${s.country_code || ""} ${s.date} ${s.session_name || ""}`.toLowerCase();
    if (!hay.includes(state.q.toLowerCase())) return false;
  }
  return true;
}

function activeJobsFor(sessionKey) {
  return state.jobs.filter((j) => String(j.session) === String(sessionKey) && (j.status === "queued" || j.status === "running"));
}

function runnerOk() {
  return state.backend === true && state.runner && state.runner.available;
}

function localOnly() {
  return `<span class="local-hint" title="需要本机 odin 与 python3 scripts/strat_wall.py">本地版可运行</span>`;
}

function boardHref(s, driver) {
  const d = driver ?? (reviewList(s)[0] || {}).driver;
  return `index.html?session=${encodeURIComponent(s.session_key)}&driver=${encodeURIComponent(d ?? "")}`;
}

function statusBadge(s) {
  const st = statusOf(s);
  if (st === "simulated") return `<span class="badge ok">SIMULATED</span>`;
  if (st === "raw") {
    const fetchFirst = (s.missing_raw || []).length ? " needs-fetch" : "";
    const title = fetchFirst ? `missing ${s.missing_raw.join(", ")} · Run will fetch first` : "raw OpenF1 cache, not simulated yet";
    return `<span class="badge raw${fetchFirst}" title="${esc(title)}">RAW</span>`;
  }
  return `<span class="badge dim" title="${esc((s.missing_raw || []).join(", ") || "no laps")}">NO LAPS</span>`;
}

function reviewChips(s) {
  const chips = [];
  for (const r of reviewList(s)) {
    chips.push(
      `<a class="chip" href="${boardHref(s, r.driver)}" title="open board · ${esc(r.acronym)} #${r.driver}${r.react ? " · react file" : ""}">${esc(r.acronym)}${r.react ? "<i>R</i>" : ""}</a>`
    );
  }
  for (const p of s.predictions || []) {
    chips.push(`<a class="chip predict" href="insights.html#predict" title="pre-race prediction · ${esc(p.acronym)} #${p.driver}">${esc(p.acronym)}<i>P</i></a>`);
  }
  return chips.join("") || `<span class="dimtext">—</span>`;
}

function actionButtons(s) {
  const out = [];
  const st = statusOf(s);
  const hasLaps = s.has_laps !== false && st !== "pending";
  if (hasLaps && state.backend !== false) {
    out.push(`<a class="btn sm" href="replay.html?session=${encodeURIComponent(s.session_key)}">REPLAY</a>`);
  }
  if (st === "simulated") {
    out.push(`<a class="btn sm" href="${boardHref(s)}">BOARD</a>`);
  } else {
    out.push(`<span class="btn sm disabled" title="no simulation result yet">BOARD</span>`);
  }
  if (state.backend === true) {
    const running = activeJobsFor(s.session_key);
    if (running.length) {
      out.push(`<span class="badge run" title="${esc(running.map((j) => `${j.kind} #${j.driver} ${j.status}`).join(", "))}"><span class="spin"></span>${running[0].status.toUpperCase()}</span>`);
    }
    if (hasLaps) {
      const dis = runnerOk() ? "" : " disabled";
      const title = runnerOk() ? (s.missing_raw || []).length ? "fetch + simulate" : "odin run cmd/simulate" : esc((state.runner && state.runner.hint) || "odin not available");
      out.push(`<button type="button" class="btn sm primary${dis}" data-run="simulate" data-session="${s.session_key}" title="${title}"${dis ? " disabled" : ""}>RUN SIM</button>`);
    } else if (s.predict_inputs) {
      const dis = runnerOk() ? "" : " disabled";
      out.push(
        `<button type="button" class="btn sm${dis}" data-run="predict" data-session="${s.session_key}" title="odin run cmd/predict --pace ${s.predict_inputs.pace} --circuit ${s.predict_inputs.circuit}"${dis ? " disabled" : ""}>PREDICT</button>`
      );
    }
  } else if (state.backend === false) {
    if (hasLaps) {
      out.push(`<span class="btn sm disabled" aria-disabled="true">RUN SIM</span>${localOnly()}`);
    } else if (s.predict_inputs) {
      out.push(`<span class="btn sm disabled" aria-disabled="true">PREDICT</span>${localOnly()}`);
    }
  }
  return out.join("");
}

function cardHtml(s) {
  const rnd = s.local_round ? `R${s.local_round}` : "—";
  const focus = state.focus && String(s.session_key) === String(state.focus) ? " focus" : "";
  const name = (s.session_name || "Race") === "Race" ? "" : `<span class="sess-tag">${esc(s.session_name)}</span>`;
  return `<article class="race-card${focus}" data-key="${s.session_key}">
    <div class="race-card-top"><b>${esc(s.circuit || "?")}</b>${name}<span>${esc(s.country || "")}</span>${statusBadge(s)}</div>
    <div class="race-card-meta">${rnd} · ${esc(s.date)} · key ${s.session_key}${s.wet ? " · WET" : ""} · ${s.driver_count ?? "—"} drv</div>
    <div class="reviews">${reviewChips(s)}</div>
    <div class="actions">${actionButtons(s)}</div>
  </article>`;
}

function rowHtml(s) {
  const rnd = s.local_round ? `R${s.local_round}` : "—";
  const name = (s.session_name || "Race") === "Race" ? "" : `<span class="sess-tag">${esc(s.session_name)}</span>`;
  const focus = state.focus && String(s.session_key) === String(state.focus) ? " focus" : "";
  return `<tr class="race-row${focus}" data-key="${s.session_key}">
    <td class="num rnd" title="${s.local_rounds ? `${s.local_round} of ${s.local_rounds} local races in ${s.year}` : ""}">${rnd}</td>
    <td class="mono date">${esc(s.date)}</td>
    <td class="circuit"><b>${esc(s.circuit || "?")}</b>${name}<span class="country">${esc(s.country || "")}</span></td>
    <td class="flags-cell">${s.wet ? `<span class="pill wet">WET</span>` : ""}</td>
    <td class="num">${s.driver_count ?? "—"}</td>
    <td class="mono key">${s.session_key}</td>
    <td>${statusBadge(s)}</td>
    <td class="reviews">${reviewChips(s)}</td>
    <td class="actions">${actionButtons(s)}</td>
  </tr>`;
}

function renderYearSelect() {
  const sel = $("year");
  const keep = state.year;
  sel.innerHTML = `<option value="">all</option>` + years().map((y) => `<option value="${y}">${y}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
  state.year = sel.value;
  $("status").value = state.status;
  $("search").value = state.q;
}

function renderSummary(all, shown) {
  const count = (list, st) => list.filter((s) => statusOf(s) === st).length;
  const pills = [
    `<span class="pill">${shown.length}${shown.length !== all.length ? ` / ${all.length}` : ""} RACES</span>`,
    `<span class="pill ok">${count(shown, "simulated")} SIMULATED</span>`,
    `<span class="pill rawp">${count(shown, "raw")} RAW</span>`,
    `<span class="pill">${count(shown, "pending")} NO LAPS</span>`,
  ];
  if (state.backend === false) {
    pills.push(`<span class="pill dimp" title="RUN SIM / PREDICT / 未缓存的 AI 解读需要本机 python3 scripts/strat_wall.py">只读 · 本地版可运行</span>`);
  } else if (state.backend === true && state.runner && !state.runner.available) {
    pills.push(`<span class="pill red" title="${esc(state.runner.hint || "")}">ODIN NOT FOUND</span>`);
  } else if (state.backend === true) {
    pills.push(`<span class="pill ok" title="${esc(state.runner && state.runner.odin)}">ODIN READY</span>`);
  }
  $("summary").innerHTML = pills.join("");
  const sim = count(all, "simulated");
  $("meta").textContent = `${all.length} local races · ${sim} simulated · ${all.length - sim} waiting`;
}

function renderRaces() {
  const all = state.sessions;
  const shown = all.filter(matches).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.session_key - a.session_key);
  renderSummary(all, shown);
  const root = $("races");
  if (!shown.length) {
    root.innerHTML = `<section class="panel"><div class="empty">${all.length ? "No race matches the filter." : "No races in data/raw yet. Run scripts/fetch_calendar.py or odin run cmd/fetch."}</div></section>`;
    return;
  }
  const groups = new Map();
  for (const s of shown) {
    const y = Number(s.year) || 0;
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(s);
  }
  const head = `<thead><tr>
    <th>RND</th><th>DATE</th><th>CIRCUIT</th><th></th><th>DRV</th><th>KEY</th><th>STATUS</th><th>REVIEWS</th><th>ACTIONS</th>
  </tr></thead>`;
  root.innerHTML = [...groups.keys()]
    .sort((a, b) => b - a)
    .map((y) => {
      const rows = groups.get(y);
      const sim = rows.filter((s) => statusOf(s) === "simulated").length;
      return `<section class="panel race-year" id="year-${y}">
        <h2>${y || "—"} <span>${rows.length} races · ${sim} simulated</span></h2>
        <div class="race-cards">${rows.map(cardHtml).join("")}</div>
        <div class="table-wrap"><table class="race-table">${head}<tbody>${rows.map(rowHtml).join("")}</tbody></table></div>
      </section>`;
    })
    .join("");
  if (state.focus) {
    const row = root.querySelector(`tr[data-key="${CSS.escape(String(state.focus))}"]`);
    if (row) row.scrollIntoView({ block: "center" });
    state.focus = "";
  }
}

// --- jobs ------------------------------------------------------------------

function fmtAge(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

function fmtDuration(j) {
  if (!j.started_at) return "queued";
  const end = j.finished_at || Date.now() / 1000;
  return fmtAge(Date.now() / 1000 - (end - j.started_at));
}

function sessionLabel(key) {
  const s = state.sessions.find((x) => String(x.session_key) === String(key));
  return s ? `${s.circuit} ${s.year}` : String(key);
}

function jobRowHtml(j) {
  const cls = j.status === "done" ? "ok" : j.status === "failed" ? "bad" : j.status === "cancelled" ? "dim" : "run";
  const spin = j.status === "running" || j.status === "queued" ? `<span class="spin"></span>` : "";
  const link =
    j.status === "done" && j.kind === "simulate"
      ? `<a class="btn sm" href="index.html?session=${j.session}&driver=${j.driver}${j.meta && j.meta.react ? "&react=1" : ""}">OPEN BOARD</a>`
      : j.status === "done" && j.kind === "predict"
        ? `<a class="btn sm" href="insights.html#predict">OPEN INSIGHTS</a>`
        : "";
  const cancel = j.status === "running" || j.status === "queued" ? `<button type="button" class="btn sm" data-cancel="${j.id}">CANCEL</button>` : "";
  const logOpen = state.openLogs.has(j.id);
  const stepTxt = j.steps > 1 ? ` · step ${j.step}/${j.steps}${j.meta && j.meta.fetch_first && j.step === 1 ? " fetch" : ""}` : "";
  const err = j.error ? `<div class="job-error">${esc(j.error)}</div>` : "";
  return `<div class="job ${cls}" data-job="${j.id}">
    <div class="job-head">
      <span class="badge ${cls}">${spin}${j.status.toUpperCase()}</span>
      <span class="job-title"><b>${esc(j.kind.toUpperCase())}</b> ${esc(sessionLabel(j.session))} · #${j.driver || "—"}${j.meta && j.meta.from_lap ? ` · L${j.meta.from_lap}–${j.meta.to_lap}` : ""}${j.meta && j.meta.react ? ` · react #${j.meta.react}` : ""}${stepTxt}</span>
      <span class="job-time mono">${fmtDuration(j)}</span>
      <span class="job-actions">${link}${cancel}<button type="button" class="btn sm" data-log="${j.id}">${logOpen ? "HIDE LOG" : "LOG"}</button></span>
    </div>
    ${err}
    ${logOpen ? `<pre class="job-log" id="log-${j.id}">${esc((j.log || []).join("\n")) || "…"}</pre>` : ""}
  </div>`;
}

async function renderJobs() {
  const panel = $("jobs-panel");
  if (state.backend !== true || !state.jobs.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const active = state.jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  $("jobs-sub").textContent = active ? `${active} active` : `${state.jobs.length} recent`;
  const withLogs = await Promise.all(
    state.jobs.slice(0, 12).map(async (j) => {
      if (!state.openLogs.has(j.id)) return j;
      try {
        return await loadJSON(`/api/jobs/${encodeURIComponent(j.id)}?tail=200`);
      } catch (_) {
        return j;
      }
    })
  );
  $("jobs").innerHTML = withLogs.map(jobRowHtml).join("");
  for (const pre of $("jobs").querySelectorAll(".job-log")) pre.scrollTop = pre.scrollHeight;
}

async function pollJobs() {
  if (state.backend !== true) return;
  let data;
  try {
    data = await loadJSON("/api/jobs");
  } catch (_) {
    return;
  }
  state.runner = data.runner || state.runner;
  state.jobs = data.jobs || [];
  let finished = false;
  for (const j of state.jobs) {
    const prev = state.seen.get(j.id);
    if (prev && prev !== j.status && (j.status === "done" || j.status === "failed" || j.status === "cancelled")) finished = true;
    state.seen.set(j.id, j.status);
  }
  if (finished) {
    await loadCatalog();
  }
  renderRaces();
  await renderJobs();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  const active = state.jobs.some((j) => j.status === "running" || j.status === "queued");
  if (active) state.pollTimer = setTimeout(pollJobs, POLL_MS);
}

// --- run dialog --------------------------------------------------------------

function fillSelect(sel, drivers, firstOption) {
  sel.innerHTML = firstOption ? `<option value="">${firstOption}</option>` : "";
  for (const d of drivers) {
    const opt = document.createElement("option");
    opt.value = d.driver;
    opt.textContent = `${d.acronym}  #${d.driver}  ${d.team || ""}`.trim();
    sel.appendChild(opt);
  }
}

function previewCommand() {
  const d = state.dialog;
  if (!d) return;
  const driver = $("run-driver").value || "<n>";
  let cmd;
  if (d.kind === "simulate") {
    const from = $("run-from").value || 20;
    const to = $("run-to").value || 32;
    const react = $("run-react").value;
    const iter = $("run-iter").value;
    const pre = (d.session.missing_raw || []).length ? `odin run cmd/fetch    -- --session ${d.session.session_key}\n` : "";
    cmd = `${pre}odin run cmd/simulate -- --session ${d.session.session_key} --driver ${driver} --from-lap ${from} --to-lap ${to}`;
    if (iter) cmd += ` --iterations ${iter}`;
    if (react) cmd += ` --react ${react} --result data/results/${d.session.session_key}-${driver}-react.json`;
  } else {
    const inp = d.session.predict_inputs || {};
    cmd = `odin run cmd/predict  -- --session ${d.session.session_key} --driver ${driver} --pace ${inp.pace} --circuit ${inp.circuit}`;
  }
  $("run-cmd").textContent = cmd;
}

async function openRun(kind, sessionKey) {
  const s = state.sessions.find((x) => String(x.session_key) === String(sessionKey));
  if (!s) return;
  state.dialog = { kind, session: s, drivers: [] };
  const dlg = $("run-dialog");
  $("run-title").textContent = kind === "predict" ? "PRE-RACE PREDICT" : "RUN SIMULATION";
  $("run-kicker").textContent = `${s.circuit} ${s.year} · ${s.date} · session ${s.session_key}`;
  $("run-error").textContent = "";
  $("run-submit").disabled = true;
  for (const el of dlg.querySelectorAll(".sim-only")) el.hidden = kind !== "simulate";
  $("run-from").value = 20;
  $("run-to").value = 32;
  $("run-iter").value = "";
  if (kind === "simulate") {
    $("run-note").textContent = (s.missing_raw || []).length
      ? `data/raw/${s.session_key} is missing ${s.missing_raw.join(", ")}: odin run cmd/fetch runs first, then simulate. Defaults match the README (fork L20, pit window 20–32, 128 Monte Carlo rolls).`
      : "Defaults match the README: fork at lap 20, test pit laps 20–32, 128 Monte Carlo rolls. Leave RIVAL REACT empty for the frozen-field review.";
  } else {
    const inp = s.predict_inputs || {};
    $("run-note").textContent = `No race laps yet. Pace comes from ${sessionLabel(inp.pace)} (${inp.pace}); lap count and climate from ${sessionLabel(inp.circuit)} (${inp.circuit}). Output goes to data/predict and the INSIGHTS page.`;
  }
  fillSelect($("run-driver"), [], "loading…");
  fillSelect($("run-react"), [], "frozen (none)");
  previewCommand();
  if (!dlg.open) dlg.showModal();
  try {
    const data = await loadJSON(`/api/drivers?session=${encodeURIComponent(s.session_key)}`);
    state.dialog.drivers = data.drivers || [];
  } catch (err) {
    $("run-error").textContent = err.message;
    return;
  }
  const drivers = state.dialog.drivers;
  fillSelect($("run-driver"), drivers, "");
  fillSelect($("run-react"), drivers, "frozen (none)");
  const reviewed = new Set(reviewList(s).map((r) => String(r.driver)));
  const fresh = drivers.find((d) => !reviewed.has(String(d.driver)));
  $("run-driver").value = String((fresh || drivers[0] || {}).driver ?? "");
  $("run-submit").disabled = !drivers.length;
  if (!drivers.length) $("run-error").textContent = "drivers.json is empty for this session";
  previewCommand();
}

async function submitRun(ev) {
  ev.preventDefault();
  const d = state.dialog;
  if (!d) return;
  const body = { session: d.session.session_key, driver: Number($("run-driver").value) };
  let url = "/api/predict";
  if (d.kind === "simulate") {
    url = "/api/simulate";
    body.from_lap = Number($("run-from").value);
    body.to_lap = Number($("run-to").value);
    if ($("run-react").value) body.react = Number($("run-react").value);
    if ($("run-iter").value) body.iterations = Number($("run-iter").value);
  }
  $("run-submit").disabled = true;
  $("run-error").textContent = "";
  try {
    const job = await loadJSON(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    state.openLogs.add(job.id);
    state.seen.set(job.id, job.status);
    $("run-dialog").close();
    state.dialog = null;
    await pollJobs();
    $("jobs-panel").scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (err) {
    $("run-error").textContent = err.message;
    $("run-submit").disabled = false;
  }
}

// --- wiring ------------------------------------------------------------------

function syncUrl() {
  const q = new URLSearchParams();
  if (state.year) q.set("year", state.year);
  if (state.status) q.set("status", state.status);
  if (state.q) q.set("q", state.q);
  const qs = q.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

$("year").addEventListener("change", (e) => {
  state.year = e.target.value;
  syncUrl();
  renderRaces();
});
$("status").addEventListener("change", (e) => {
  state.status = e.target.value;
  syncUrl();
  renderRaces();
});
$("search").addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  syncUrl();
  renderRaces();
});

$("races").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-run]");
  if (!btn || btn.disabled) return;
  openRun(btn.dataset.run, btn.dataset.session);
});

$("jobs").addEventListener("click", async (e) => {
  const log = e.target.closest("button[data-log]");
  if (log) {
    const id = log.dataset.log;
    if (state.openLogs.has(id)) state.openLogs.delete(id);
    else state.openLogs.add(id);
    await renderJobs();
    return;
  }
  const cancel = e.target.closest("button[data-cancel]");
  if (cancel) {
    cancel.disabled = true;
    try {
      await loadJSON(`/api/jobs/${encodeURIComponent(cancel.dataset.cancel)}/cancel`, { method: "POST" });
    } catch (_) {
      /* the poll will show the real state */
    }
    await pollJobs();
  }
});

$("run-form").addEventListener("submit", submitRun);
$("run-cancel").addEventListener("click", () => {
  $("run-dialog").close();
  state.dialog = null;
});
for (const id of ["run-driver", "run-from", "run-to", "run-react", "run-iter"]) {
  $(id).addEventListener("input", previewCommand);
  $(id).addEventListener("change", previewCommand);
}

async function init() {
  await Promise.all([detectBackend(), loadCatalog()]);
  for (const j of state.jobs) state.seen.set(j.id, j.status);
  renderYearSelect();
  renderRaces();
  await renderJobs();
  schedulePoll();
  const run = params.get("run");
  if (run && state.backend === true) {
    const s = state.sessions.find((x) => String(x.session_key) === String(run));
    if (s) openRun(statusOf(s) === "pending" ? "predict" : "simulate", run);
  }
}

init().catch((err) => {
  $("meta").textContent = "failed to load catalog";
  $("races").innerHTML = `<section class="panel"><div class="empty">${esc(err.message)}</div></section>`;
});
