const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const state = {
  session: params.get("session") || "11353",
  pack: null,
  events: [],
  idx: -1,
  timer: null,
  playing: false,
};

function useStaticApi() {
  if (document.documentElement.dataset.static === "1") return true;
  return location.hostname.endsWith("github.io") || location.protocol === "https:" || location.protocol === "file:";
}

function catalogUrl() {
  return useStaticApi() ? "api/catalog.json" : "/api/catalog";
}

function replayUrl() {
  if (!useStaticApi()) {
    return "/api/replay?session=" + encodeURIComponent(state.session);
  }
  return "api/" + state.session + "-replay.json";
}

async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

function driverMap(pack) {
  const m = {};
  for (const d of pack.drivers || []) m[d.driver] = d;
  return m;
}

function filteredEvents(pack) {
  const mode = $("filter").value;
  return (pack.events || []).filter((e) => {
    if (mode === "track") return e.kind === "track";
    if (mode === "lead") return e.position === 1;
    return true;
  });
}

function orderAfter(pack, events, idx) {
  const order = (pack.grid || []).slice();
  const seen = new Set(order);
  for (const d of pack.drivers || []) {
    if (!seen.has(d.driver)) {
      order.push(d.driver);
      seen.add(d.driver);
    }
  }
  for (let i = 0; i <= idx; i += 1) {
    const e = events[i];
    if (!e) continue;
    const a = order.indexOf(e.passer);
    const b = order.indexOf(e.passed);
    if (a < 0 && b < 0) continue;
    if (a < 0) {
      order.splice(Math.max(0, (e.position || 1) - 1), 0, e.passer);
      continue;
    }
    if (b < 0) continue;
    if (e.position > 0) {
      order.splice(a, 1);
      const dest = Math.min(order.length, e.position - 1);
      order.splice(dest, 0, e.passer);
    } else if (a > b) {
      order.splice(a, 1);
      order.splice(b, 0, e.passer);
    }
  }
  return order;
}

function renderStage(pack, events, idx) {
  const by = driverMap(pack);
  const order = orderAfter(pack, events, idx);
  const ev = idx >= 0 ? events[idx] : null;
  const stage = $("stage");
  const h = 28;
  stage.style.height = Math.max(160, order.length * h) + "px";
  if (!stage.dataset.ready) {
    stage.innerHTML = order
      .map((id) => {
        const d = by[id] || { acronym: "#" + id, color: "#7d8794", team: "" };
        return `<div class="rrow" data-id="${id}">
          <span class="rpos"></span>
          <span class="team-pip" style="background:${d.color}"></span>
          <span class="acr">${d.acronym}</span>
          <span class="rteam">${d.team || ""}</span>
        </div>`;
      })
      .join("");
    stage.dataset.ready = "1";
  }
  const rows = [...stage.querySelectorAll(".rrow")];
  const have = new Set(rows.map((el) => Number(el.dataset.id)));
  for (const id of order) {
    if (have.has(id)) continue;
    const d = by[id] || { acronym: "#" + id, color: "#7d8794", team: "" };
    const div = document.createElement("div");
    div.className = "rrow";
    div.dataset.id = String(id);
    div.innerHTML = `<span class="rpos"></span><span class="team-pip" style="background:${d.color}"></span><span class="acr">${d.acronym}</span><span class="rteam">${d.team || ""}</span>`;
    stage.appendChild(div);
    rows.push(div);
  }
  for (const el of rows) {
    const id = Number(el.dataset.id);
    const p = order.indexOf(id);
    el.classList.toggle("pass", Boolean(ev && id === ev.passer));
    el.classList.toggle("victim", Boolean(ev && id === ev.passed));
    el.classList.toggle("gone", p < 0);
    if (p >= 0) {
      el.style.transform = `translateY(${p * h}px)`;
      el.querySelector(".rpos").textContent = String(p + 1);
    }
  }
}

function scrollLogToCurrent(idx) {
  const log = $("log");
  const on = log.querySelector(`.log-row[data-i="${idx}"]`);
  if (!on) return;
  const top = on.offsetTop - log.clientHeight / 2 + on.offsetHeight / 2;
  log.scrollTop = Math.max(0, top);
}

function keepOrderInView(idx) {
  const stage = $("stage");
  const pack = state.pack;
  const ev = idx >= 0 && pack ? state.events[idx] : null;
  const id = ev ? ev.passer : null;
  const row = id != null ? stage.querySelector(`.rrow[data-id="${id}"]`) : stage;
  const panel = stage.closest(".replay-tower-panel") || stage;
  const target = row || panel;
  const rect = target.getBoundingClientRect();
  const pad = 72;
  if (rect.top >= pad && rect.bottom <= window.innerHeight - 24) return;
  const y = window.scrollY + rect.top - pad;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

function renderLog(pack, events, idx) {
  const by = driverMap(pack);
  const acr = (id) => (by[id] && by[id].acronym) || "#" + id;
  const log = $("log");
  if (log.dataset.count !== String(events.length)) {
    log.innerHTML = events
      .map((e, i) => {
        const tag = e.kind === "pit" ? "PIT" : e.position === 1 ? "LEAD" : "PASS";
        return `<div class="log-row" data-i="${i}">
        <span>L${e.lap || "—"}</span>
        <span class="tag ${e.kind}${e.position === 1 ? " lead" : ""}">${tag}</span>
        <span>${acr(e.passer)} passes ${acr(e.passed)} → P${e.position}</span>
      </div>`;
      })
      .join("");
    log.dataset.count = String(events.length);
  }
  for (const el of log.querySelectorAll(".log-row")) {
    const i = Number(el.dataset.i);
    el.classList.toggle("on", i === idx);
    el.classList.toggle("done", i < idx);
  }
  if (idx >= 0) scrollLogToCurrent(idx);
}

function renderCall(pack, events, idx) {
  const by = driverMap(pack);
  const acr = (id) => (by[id] && by[id].acronym) || "#" + id;
  if (idx < 0) {
    $("call").textContent = "GRID · " + (pack.circuit || "") + " · " + (pack.date || "");
    $("lap-sub").textContent = "L0/" + (pack.total_laps || "?");
    return;
  }
  const e = events[idx];
  const kind = e.kind === "pit" ? "进站换位" : e.position === 1 ? "领跑权" : "赛道超车";
  $("call").textContent = `L${e.lap || "?"} · ${kind} · ${acr(e.passer)} 超过 ${acr(e.passed)} 升到 P${e.position}  ·  ${idx + 1}/${events.length}`;
  $("lap-sub").textContent = `L${e.lap || "?"} / ${pack.total_laps || "?"}`;
}

function syncUrl() {
  const q = new URLSearchParams({ session: state.session });
  history.replaceState(null, "", "replay.html?" + q.toString());
}

function apply() {
  const pack = state.pack;
  if (!pack) return;
  renderStage(pack, state.events, state.idx);
  renderLog(pack, state.events, state.idx);
  renderCall(pack, state.events, state.idx);
  $("scrub").value = String(state.idx + 1);
  $("btn-play").textContent = state.playing ? "PAUSE" : "PLAY";
  if (state.playing || state.idx >= 0) keepOrderInView(state.idx);
}

function stop() {
  state.playing = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  $("btn-play").textContent = "PLAY";
}

function step() {
  if (state.idx + 1 >= state.events.length) {
    stop();
    return;
  }
  state.idx += 1;
  apply();
}

function play() {
  if (state.idx >= state.events.length - 1) state.idx = -1;
  state.playing = true;
  $("btn-play").textContent = "PAUSE";
  const tick = () => {
    if (!state.playing) return;
    step();
    if (state.idx >= state.events.length - 1) {
      stop();
      return;
    }
    state.timer = setTimeout(tick, Number($("speed").value) || 350);
  };
  tick();
}

function resetView() {
  stop();
  state.idx = -1;
  apply();
}

function rebuildEvents() {
  if (!state.pack) return;
  stop();
  $("stage").dataset.ready = "";
  $("log").dataset.count = "";
  state.events = filteredEvents(state.pack);
  state.idx = -1;
  $("scrub").max = String(state.events.length);
  $("scrub").value = "0";
  const n = state.events.length;
  const track = state.events.filter((e) => e.kind === "track").length;
  const lead = state.events.filter((e) => e.position === 1).length;
  $("count-pill").textContent = `${n} swaps · ${track} on-track · ${lead} lead`;
  apply();
}

async function loadCatalog() {
  const cat = await loadJSON(catalogUrl());
  const sel = $("session");
  sel.innerHTML = "";
  for (const s of cat.sessions || []) {
    if ((s.session_name || "Race") !== "Race") continue;
    const opt = document.createElement("option");
    opt.value = s.session_key;
    opt.textContent = `${s.session_key}  ${s.circuit}  ${s.date}`;
    sel.appendChild(opt);
  }
  if (![...sel.options].some((o) => o.value === state.session) && sel.options.length) {
    state.session = sel.options[0].value;
  }
  sel.value = state.session;
}

async function loadReplay() {
  syncUrl();
  const pack = await loadJSON(replayUrl());
  state.pack = pack;
  $("meta").textContent = `${pack.circuit || ""} ${pack.year || ""} ${pack.name || ""}  ·  ${pack.date || ""}  ·  overtake replay`;
  $("caveats").textContent = pack.note || "";
  document.title = `OVERTAKE · ${pack.circuit || pack.session_key}`;
  rebuildEvents();
}

$("session").addEventListener("change", (e) => {
  state.session = e.target.value;
  $("stage").dataset.ready = "";
  loadReplay().catch((err) => {
    $("call").textContent = "没有这场回放：" + err.message;
  });
});
$("btn-play").addEventListener("click", () => {
  if (state.playing) stop();
  else play();
});
$("btn-step").addEventListener("click", () => {
  stop();
  step();
});
$("btn-reset").addEventListener("click", resetView);
$("filter").addEventListener("change", rebuildEvents);
$("scrub").addEventListener("input", (e) => {
  stop();
  state.idx = Number(e.target.value) - 1;
  apply();
});
$("log").addEventListener("click", (e) => {
  const row = e.target.closest(".log-row");
  if (!row) return;
  stop();
  state.idx = Number(row.dataset.i);
  apply();
});

loadCatalog()
  .then(loadReplay)
  .catch((err) => {
    $("call").textContent = "回放数据加载失败：" + err.message;
  });
