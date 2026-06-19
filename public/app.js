const DATA_PATHS = {
  manifest: "./data/manifest.json",
  arenaSummary: "./data/arena_summary.json",
  latest: "./data/latest_leaderboard.json",
  rankSeries: "./data/rank_timeseries_top.json",
  activity: "./data/date_category_counts.json",
  organizations: "./data/organization_summary_latest.json",
  profiles: "./data/model_profiles_latest.json",
};

// high-contrast neon — palette[0]/[1] mirror CSS --accent / --accent-2
const palette = [
  "#19f0d8",
  "#ff6b3d",
  "#66f08a",
  "#b388ff",
  "#ffcf4a",
  "#ff5470",
  "#3da5ff",
  "#ff79c6",
  "#5af0c8",
  "#ffd93d",
  "#33d6ff",
  "#c77dff",
];

const state = {
  arena: "text",
  category: "overall",
  organization: "all",
  rankLimit: 15,
  activeView: "overview",
  // ---- global coordination layer ----
  focusArena: null, // arena explicitly selected from the Arena scale chart
  focusModel: null, // globally selected model (persists across tabs)
  focusOrg: null, // globally selected organization
  hoverKey: null, // transient {type, value} for linked highlighting
  search: "", // search box text
  timeWindow: null, // {start, end} in ms, shared brush window
  brushOrgs: null, // Set<org> from scatter rectangle brush
  hiddenSeries: new Set(), // evolution series hidden via legend
};

// Bar-chart-race playback state (kept separate from filter state)
const race = {
  dates: [], // sorted snapshot dates for current arena/category
  byDate: new Map(), // date -> [{model, org, rating, rank}]
  frame: 0, // current index into dates
  timer: null, // setInterval handle while playing
  playing: false,
  key: null, // "arena|category|rankLimit" of the currently-built race (rebuild guard)
};

const data = {
  manifest: null,
  arenaSummary: [],
  latest: [],
  rankSeries: [],
  activity: [],
  organizations: [],
  profiles: [],
};

const profileByModel = new Map();
const els = {};
const colorCache = new Map();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindShellEvents();

  try {
    if (window.__LMARENA_DATA__) {
      // standalone build: data inlined into the HTML, no fetch / server needed
      Object.assign(data, window.__LMARENA_DATA__);
    } else {
      const loaded = await Promise.all(
        Object.entries(DATA_PATHS).map(async ([key, path]) => [key, await fetchJson(path)]),
      );
      loaded.forEach(([key, value]) => {
        data[key] = value;
      });
    }
    (data.profiles || []).forEach((p) => profileByModel.set(p.model_name, p));
    initializeState();
    populateControls();
    renderAll();
    els.dataStatus.textContent = `最新快照 ${data.manifest.latest_snapshot_date}`;
  } catch (error) {
    console.error(error);
    els.dataStatus.textContent = "数据加载失败";
    document.querySelector("main").innerHTML =
      '<section class="panel empty">无法读取 public/data 下的 JSON。请通过本地服务器打开 public/index.html。</section>';
  }
}

function cacheElements() {
  [
    "dataStatus",
    "arenaSelect",
    "categorySelect",
    "organizationSelect",
    "rankLimit",
    "modelSearch",
    "searchResults",
    "contextBar",
    "kpiGrid",
    "hero",
    "heroKicker",
    "heroChampion",
    "heroMeta",
    "podiumStage",
    "podiumNote",
    "arenaBars",
    "timelineChart",
    "leaderboardChart",
    "leaderboardTable",
    "raceChart",
    "raceWatermark",
    "racePlay",
    "raceScrub",
    "raceSpeed",
    "raceDate",
    "evolutionChart",
    "orgScatter",
    "orgBars",
    "arenaScaleNote",
    "timelineNote",
    "leaderboardNote",
    "tableNote",
    "evolutionNote",
    "orgScatterNote",
    "orgBarsNote",
    "tooltip",
    "drawerOverlay",
    "detailDrawer",
    "drawerKicker",
    "drawerClose",
    "drawerBody",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindShellEvents() {
  els.arenaSelect.addEventListener("change", () => {
    state.arena = els.arenaSelect.value;
    const categories = getCategoriesForArena(state.arena);
    if (!categories.includes(state.category)) {
      state.category = categories.includes("overall") ? "overall" : categories[0];
    }
    clearInteractionTransient();
    clearArenaScopedState();
    populateControls();
    renderAll();
  });

  els.categorySelect.addEventListener("change", () => {
    clearInteractionTransient();
    state.category = els.categorySelect.value;
    resetSelections();
    populateOrganizationSelect();
    renderAll();
  });

  els.organizationSelect.addEventListener("change", () => {
    clearInteractionTransient();
    state.organization = els.organizationSelect.value;
    state.focusModel = null;
    state.brushOrgs = null;
    state.focusOrg = state.organization === "all" ? null : state.organization;
    renderAll();
  });

  els.rankLimit.addEventListener("change", () => {
    clearInteractionTransient();
    state.rankLimit = clamp(Number(els.rankLimit.value) || 15, 5, 50);
    els.rankLimit.value = state.rankLimit;
    renderAll();
  });

  els.modelSearch.addEventListener("input", () => {
    state.search = els.modelSearch.value;
    renderSearchResults();
    applyLinking();
  });
  els.modelSearch.addEventListener("focus", renderSearchResults);
  document.addEventListener("click", (event) => {
    if (!els.searchResults.contains(event.target) && event.target !== els.modelSearch) {
      els.searchResults.hidden = true;
    }
  });

  els.drawerClose.addEventListener("click", closeDrawer);
  els.drawerOverlay.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  // bar-chart-race transport
  els.racePlay.addEventListener("click", toggleRacePlay);
  els.raceScrub.addEventListener("input", () => {
    stopRace();
    race.frame = Number(els.raceScrub.value) || 0;
    drawRaceFrame();
  });
  els.raceSpeed.addEventListener("change", () => {
    if (race.playing) {
      stopRace();
      startRace();
    }
  });

  window.addEventListener("resize", debounce(renderViews, 140));
}

function resetSelections() {
  state.focusArena = null;
  state.focusModel = null;
  state.focusOrg = null;
  state.brushOrgs = null;
  state.timeWindow = null;
  clearInteractionTransient();
  state.hiddenSeries = new Set();
}

function clearArenaScopedState() {
  state.focusArena = null;
  state.brushOrgs = null;
  state.timeWindow = null;
  clearInteractionTransient();
  state.hiddenSeries = new Set();
}

function clearInteractionTransient() {
  state.hoverKey = null;
  hideTooltip();
}

function initializeState() {
  const arenas = data.arenaSummary.map((d) => d.arena);
  state.arena = arenas.includes("text") ? "text" : arenas[0];
  const categories = getCategoriesForArena(state.arena);
  state.category = categories.includes("overall") ? "overall" : categories[0];
}

function populateControls() {
  fillSelect(
    els.arenaSelect,
    data.arenaSummary.map((d) => d.arena),
    state.arena,
  );
  fillSelect(els.categorySelect, getCategoriesForArena(state.arena), state.category);
  populateOrganizationSelect();
  els.rankLimit.value = state.rankLimit;
}

function populateOrganizationSelect() {
  const organizations = unique(
    data.latest
      .filter((d) => d.arena === state.arena && d.category === state.category)
      .map((d) => d.organization || "unknown"),
  ).sort((a, b) => a.localeCompare(b));

  if (state.organization !== "all" && !organizations.includes(state.organization)) {
    state.organization = "all";
  }

  fillSelect(els.organizationSelect, ["all", ...organizations], state.organization, (value) =>
    value === "all" ? "全部机构" : value,
  );
}

function renderAll() {
  renderHero();
  renderKpis();
  renderContextBar();
  renderViews();
}

// Every panel is rendered into one dense bento grid (no folding, no long scroll).
function renderViews() {
  if (!data.manifest) return;
  renderOverview();
  renderLeaderboard();
  renderRace();
  renderEvolution();
  renderOrganizations();
  applyLinking();
}

/* ============================================================
 * Coordination layer: linked highlighting + cross filtering
 * ============================================================ */

// Tag an SVG mark / DOM node so applyLinking() can find it.
function tagMark(el, { model, org, arena } = {}) {
  if (!el) return el;
  el.dataset.mark = "1";
  if (model != null) el.dataset.model = String(model);
  if (org != null) el.dataset.org = String(org);
  if (arena != null) el.dataset.arena = String(arena);
  return el;
}

function linkHover(el, key) {
  if (!el) return el;
  el.addEventListener("mouseenter", () => {
    state.hoverKey = key;
    applyLinking();
  });
  el.addEventListener("mouseleave", () => {
    state.hoverKey = null;
    applyLinking();
  });
  return el;
}

// The single source of truth for what is currently emphasized. Multiple
// dimensions can be active at once: arena charts should keep their arena
// selection while model/org charts show their own selected state.
function getActiveKeys() {
  const keys = [];
  if (state.hoverKey) keys.push(state.hoverKey);
  const q = state.search.trim().toLowerCase();
  if (q) keys.push({ type: "search", value: q });
  if (state.brushOrgs && state.brushOrgs.size) keys.push({ type: "orgset", value: state.brushOrgs });
  if (state.focusModel) keys.push({ type: "model", value: state.focusModel });
  if (state.focusOrg) keys.push({ type: "org", value: state.focusOrg });
  if (state.organization !== "all") keys.push({ type: "org", value: state.organization });
  if (state.focusArena) keys.push({ type: "arena", value: state.focusArena });
  return keys;
}

// Returns true (match) / false (no match) / null (dimension not applicable).
function markMatches(el, active) {
  const { model, org } = el.dataset;
  switch (active.type) {
    case "model":
      return model == null ? null : model === active.value;
    case "org":
      return org == null ? null : org === active.value;
    case "arena":
      return el.dataset.arena == null ? null : el.dataset.arena === active.value;
    case "orgset":
      return org == null ? null : active.value.has(org);
    case "search": {
      if (model == null && org == null) return null;
      const hay = `${model || ""} ${org || ""}`.toLowerCase();
      return hay.includes(active.value);
    }
    default:
      return null;
  }
}

function applyLinking() {
  const activeKeys = getActiveKeys();
  document.querySelectorAll("[data-mark]").forEach((el) => {
    el.classList.remove("is-dim", "is-focus");
    if (!activeKeys.length) return;
    let matched = null;
    for (const active of activeKeys) {
      matched = markMatches(el, active);
      if (matched !== null) break;
    }
    if (matched === true) el.classList.add("is-focus");
    else if (matched === false) el.classList.add("is-dim");
  });
}

function setFocusModel(name) {
  if (!name) return;
  clearInteractionTransient();
  if (state.focusModel === name) {
    closeDrawer();
    return;
  }
  state.focusModel = name;
  state.focusOrg = null;
  state.brushOrgs = null;
  renderModelDrawer(name);
  openDrawer();
  renderContextBar();
  applyLinking();
}

function setFocusOrg(org, { syncSelect = true } = {}) {
  if (!org) return;
  clearInteractionTransient();
  if (state.focusOrg === org || state.organization === org) {
    state.focusOrg = null;
    state.brushOrgs = null;
    if (state.organization === org) {
      state.organization = "all";
      els.organizationSelect.value = "all";
    }
    closeDrawer();
    renderAll();
    return;
  }
  state.focusOrg = org;
  state.focusModel = null;
  state.brushOrgs = null;
  if (syncSelect) {
    const options = [...els.organizationSelect.options].map((o) => o.value);
    if (options.includes(org)) {
      state.organization = org;
      els.organizationSelect.value = org;
    }
  }
  renderOrgDrawer(org);
  openDrawer();
  renderAll();
}

function openDrawer() {
  els.detailDrawer.classList.add("open");
  els.detailDrawer.setAttribute("aria-hidden", "false");
  els.drawerOverlay.hidden = false;
}

function closeDrawer() {
  clearInteractionTransient();
  els.detailDrawer.classList.remove("open");
  els.detailDrawer.setAttribute("aria-hidden", "true");
  els.drawerOverlay.hidden = true;
  state.focusModel = null;
  state.focusOrg = null;
  renderContextBar();
  applyLinking();
}

/* ============================================================
 * Context bar (active cross-filter chips)
 * ============================================================ */

function renderContextBar() {
  const chips = [];
  chips.push(chip("Arena", state.arena, null));
  chips.push(chip("Category", state.category, null));
  if (state.focusArena) chips.push(chip("聚焦 Arena", state.focusArena, "focus-arena"));
  if (state.organization !== "all") {
    chips.push(chip("机构筛选", state.organization, "org-filter"));
  }
  if (state.focusModel) chips.push(chip("聚焦模型", state.focusModel, "focus-model"));
  if (state.focusOrg && state.focusOrg !== state.organization) {
    chips.push(chip("聚焦机构", state.focusOrg, "focus-org"));
  }
  if (state.brushOrgs && state.brushOrgs.size) {
    chips.push(chip("框选机构", `${state.brushOrgs.size} 家`, "brush-orgs"));
  }
  if (state.timeWindow) {
    chips.push(
      chip("时间窗", `${shortDate(state.timeWindow.start)} → ${shortDate(state.timeWindow.end)}`, "time-window"),
    );
  }
  if (state.search.trim()) chips.push(chip("搜索", state.search.trim(), "search"));

  const removable = chips.some((c) => c.action);
  els.contextBar.hidden = !removable && chips.length <= 2;
  els.contextBar.innerHTML =
    `<span class="context-label">联动状态</span>` +
    chips
      .map(
        (c) =>
          `<span class="chip${c.action ? " removable" : ""}"${c.action ? ` data-action="${c.action}"` : ""}>` +
          `<em>${escapeHtml(c.label)}</em>${escapeHtml(c.value)}${c.action ? '<button aria-label="清除">×</button>' : ""}</span>`,
      )
      .join("") +
    (removable ? `<button class="chip clear-all" data-action="clear-all">清除全部</button>` : "");

  els.contextBar.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", () => clearFilter(node.dataset.action));
  });
}

function chip(label, value, action) {
  return { label, value, action };
}

function clearFilter(action) {
  clearInteractionTransient();
  switch (action) {
    case "org-filter":
      state.organization = "all";
      els.organizationSelect.value = "all";
      state.focusOrg = null;
      break;
    case "focus-arena":
      state.focusArena = null;
      break;
    case "focus-model":
      state.focusModel = null;
      closeDrawer();
      break;
    case "focus-org":
      state.focusOrg = null;
      closeDrawer();
      break;
    case "brush-orgs":
      state.brushOrgs = null;
      break;
    case "time-window":
      state.timeWindow = null;
      break;
    case "search":
      state.search = "";
      els.modelSearch.value = "";
      els.searchResults.hidden = true;
      break;
    case "clear-all":
      state.organization = "all";
      els.organizationSelect.value = "all";
      state.search = "";
      els.modelSearch.value = "";
      resetSelections();
      els.detailDrawer.classList.remove("open");
      els.drawerOverlay.hidden = true;
      break;
    default:
      break;
  }
  renderAll();
}

/* ============================================================
 * Search
 * ============================================================ */

function renderSearchResults() {
  const q = state.search.trim().toLowerCase();
  if (!q) {
    els.searchResults.hidden = true;
    return;
  }
  const pool = data.latest.filter((d) => d.arena === state.arena && d.category === state.category);
  const seen = new Set();
  const matches = [];
  pool
    .sort((a, b) => a.rank - b.rank)
    .forEach((d) => {
      const hay = `${d.model_name} ${d.organization || ""}`.toLowerCase();
      if (hay.includes(q) && !seen.has(d.model_name)) {
        seen.add(d.model_name);
        matches.push(d);
      }
    });
  const top = matches.slice(0, 8);
  if (!top.length) {
    els.searchResults.hidden = false;
    els.searchResults.innerHTML = `<div class="search-empty">无匹配模型</div>`;
    return;
  }
  els.searchResults.hidden = false;
  els.searchResults.innerHTML = top
    .map(
      (d) =>
        `<button class="search-item" data-model="${escapeHtml(d.model_name)}">` +
        `<strong>${escapeHtml(truncate(d.model_name, 32))}</strong>` +
        `<span>#${formatRank(d.rank)} · ${escapeHtml(d.organization || "unknown")}</span></button>`,
    )
    .join("");
  els.searchResults.querySelectorAll(".search-item").forEach((node) => {
    node.addEventListener("click", () => {
      els.searchResults.hidden = true;
      setFocusModel(node.dataset.model);
    });
  });
}

/* ============================================================
 * KPIs
 * ============================================================ */

function renderKpis() {
  const m = data.manifest;
  const selectedRows = getFilteredLatestRows({ respectRank: false });
  const kpis = [
    { label: "Full Rows", raw: m.full_rows },
    { label: "Latest Rows", raw: m.latest_rows },
    { label: "Arenas", raw: m.arena_count },
    { label: "Models", raw: m.model_count_latest },
  ];

  if (state.timeWindow) {
    const rows = data.activity.filter(
      (d) =>
        d.arena === state.arena &&
        d.category === state.category &&
        inWindow(new Date(d.leaderboard_publish_date).getTime()),
    );
    const votes = rows.reduce((sum, d) => sum + (d.total_votes || 0), 0);
    kpis.push({ label: "窗口内 votes", text: compactNumber(votes) });
  } else {
    kpis.push({ label: "Selected Rows", raw: selectedRows.length });
  }

  els.kpiGrid.innerHTML = kpis
    .map(
      (k) =>
        `<article class="kpi"><strong${k.raw != null ? ` data-count="${k.raw}"` : ""}>` +
        `${k.raw != null ? "0" : escapeHtml(k.text)}</strong><span>${escapeHtml(k.label)}</span></article>`,
    )
    .join("");

  els.kpiGrid.querySelectorAll("[data-count]").forEach((node) => {
    animateNumber(node, Number(node.dataset.count));
  });
}

function inWindow(time) {
  if (!state.timeWindow) return true;
  return time >= state.timeWindow.start && time <= state.timeWindow.end;
}

/* ============================================================
 * Overview
 * ============================================================ */

function renderOverview() {
  els.arenaScaleNote.textContent = `${data.arenaSummary.length} arenas · 点击切换`;
  els.timelineNote.textContent = `${state.arena} / ${state.category} · ${data.manifest.date_start} ~ ${data.manifest.date_end}`;
  renderArenaBars();
  renderTimeline();
}

function renderArenaBars() {
  const svg = setupSvg(els.arenaBars);
  const rows = [...data.arenaSummary].sort((a, b) => b.model_count_latest - a.model_count_latest);
  const margin = { top: 16, right: 34, bottom: 26, left: 140 };
  const width = svg.clientWidth || 680;
  const height = Math.max(260, rows.length * 22 + margin.top + margin.bottom);
  setViewBox(svg, width, height);
  clear(svg);

  const innerW = width - margin.left - margin.right;
  const maxModels = max(rows, (d) => d.model_count_latest);
  const barH = 9;

  drawAxisLabel(svg, margin.left, height - 6, "latest model count", "axis");

  rows.forEach((d, i) => {
    const y = margin.top + i * 22;
    const modelW = scale(d.model_count_latest, 0, maxModels, 0, innerW);
    const isCurrent = d.arena === state.arena;
    const row = tagMark(svgEl("g", { class: "arena-scale-row" }), { arena: d.arena });
    svg.appendChild(row);

    row.appendChild(
      text(svg, margin.left - 10, y + 10, d.arena, isCurrent ? "chart-label selected-label" : "chart-label", "end"),
    );
    const aBar = rect(svg, margin.left, y + 3, modelW, barH, barGradient(svg, getColor(d.arena)), 4);
    aBar.classList.add("arena-scale-model-bar");
    row.appendChild(aBar);
    if (isCurrent) aBar.style.filter = `drop-shadow(0 0 6px ${getColor(d.arena)})`;
    row.appendChild(text(svg, margin.left + modelW + 8, y + 11, formatNumber(d.model_count_latest), "minor-label"));

    const hit = rect(svg, margin.left, y - 3, innerW, 20, "transparent", 0);
    row.appendChild(hit);
    hit.style.cursor = "pointer";
    hit.addEventListener("click", () => switchArena(d.arena, { focus: true }));
    hit.addEventListener("mouseenter", (event) =>
      showTooltip(
        event,
        `<strong>${d.arena}</strong>模型 ${formatNumber(d.model_count_latest)}<br>快照 ${formatNumber(
          d.snapshot_count,
        )}<br>类别 ${formatNumber(d.category_count_full)}<br><em>点击切换到该 arena</em>`,
      ),
    );
    hit.addEventListener("mouseleave", hideTooltip);
    linkHover(hit, { type: "arena", value: d.arena });
  });
}

function switchArena(arena, { focus = false } = {}) {
  clearInteractionTransient();
  if (arena === state.arena) {
    if (focus) {
      state.focusArena = state.focusArena === arena ? null : arena;
      applyLinking();
    }
    return;
  }
  state.arena = arena;
  els.arenaSelect.value = arena;
  const categories = getCategoriesForArena(arena);
  if (!categories.includes(state.category)) {
    state.category = categories.includes("overall") ? "overall" : categories[0];
  }
  clearArenaScopedState();
  if (focus) state.focusArena = arena;
  populateControls();
  renderAll();
}

// Timeline: all 14 arenas' vote activity as log-scaled lines on a shared time
// axis. Each line's start/end already encodes the arena's coverage span, so no
// separate coverage band is needed. Click a line (or its label) to focus the
// arena; brush the plot to set the shared time window.
function renderTimeline() {
  const svg = setupSvg(els.timelineChart);
  const arenas = [...data.arenaSummary].sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  const margin = { top: 24, right: 150, bottom: 32, left: 66 };
  const width = svg.clientWidth || 900;
  const height = 360;
  setViewBox(svg, width, height);
  clear(svg);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const plotTop = margin.top;
  const plotBottom = margin.top + innerH;

  text(svg, margin.left, plotTop - 9, "各 arena 投票活跃度（log 票数）· 点击折线聚焦", "tl-band-label");

  const catOf = (a) =>
    a.categories && a.categories.includes("overall") ? "overall" : (a.categories && a.categories[0]) || "overall";
  const series = arenas
    .map((a) => ({
      arena: a.arena,
      // drop snapshots with 0 votes (text's 2023 history has no recorded counts),
      // otherwise a log axis pins them to the floor and the line dives down
      rows: data.activity
        .filter((d) => d.arena === a.arena && d.category === catOf(a) && (d.total_votes || 0) > 0)
        .sort((x, y) => new Date(x.leaderboard_publish_date) - new Date(y.leaderboard_publish_date)),
    }))
    .filter((s) => s.rows.length);

  // time domain trimmed to where data actually begins — skip the empty 2023 span
  // left behind once text's zero-vote snapshots are dropped
  const allTimes = series.flatMap((s) => s.rows.map((r) => new Date(r.leaderboard_publish_date).getTime()));
  const start = Math.min(...allTimes);
  const end = Math.max(...allTimes);
  const xOf = (ms) => margin.left + scale(ms, start, end, 0, innerW);

  // shared year gridlines + start/end date anchors + brush window shading
  yearTicks(start, end).forEach((tick) => {
    if (tick.time <= start || tick.time >= end) return;
    const x = xOf(tick.time);
    line(svg, x, plotTop - 6, x, plotBottom, "grid-line");
    text(svg, x, plotBottom + 18, tick.label, "axis", "middle");
  });
  text(svg, margin.left, plotBottom + 18, shortDate(start), "axis", "middle");
  text(svg, margin.left + innerW, plotBottom + 18, shortDate(end), "axis", "middle");
  drawWindowBand(svg, { left: margin.left, top: plotTop }, innerW, innerH, start, end);

  // log domain starts at the real minimum vote count (not 1), compressing the
  // empty low region so the dense 100K–10M band gets the vertical space
  const allVotes = series.flatMap((s) => s.rows.map((r) => r.total_votes));
  const maxVotes = Math.max(...allVotes);
  const minVotes = Math.min(...allVotes);
  const loL = Math.log10(minVotes);
  const hiL = Math.log10(maxVotes);
  const yOf = (v) => plotBottom - scale(Math.log10(Math.max(v, minVotes)), loL, hiL, 0, innerH);

  // log-decade gridlines within the visible range
  for (let p = Math.ceil(loL); p <= Math.floor(hiL); p += 1) {
    const v = Math.pow(10, p);
    const y = yOf(v);
    line(svg, margin.left, y, margin.left + innerW, y, "grid-line");
    text(svg, margin.left - 8, y + 4, compactNumber(v), "axis", "end");
  }
  // label the axis floor (the real minimum) too
  text(svg, margin.left - 8, plotBottom + 4, compactNumber(minVotes), "axis", "end");

  // brush overlay BENEATH the lines: lines stay clickable, empty area brushes
  const overlay = rect(svg, margin.left, plotTop, innerW, innerH, "transparent", 0);
  overlay.classList.add("brush-overlay");
  addTimeBrush(svg, { left: margin.left, top: plotTop, innerW, innerH, x0: start, x1: end }, overlay);

  series.forEach((s) => {
    const isCurrent = s.arena === state.arena;
    // style-control variants largely duplicate their base arena → dim by default
    const isStyle = s.arena.endsWith("_style_control");
    const dim = isStyle && !isCurrent;
    const color = getColor(s.arena);
    const baseOpacity = isCurrent ? 1 : dim ? 0.16 : 0.55;
    const pts = s.rows.map((r) => [xOf(new Date(r.leaderboard_publish_date).getTime()), yOf(r.total_votes)]);
    // glowing gradient area beneath the currently-focused arena's line
    if (isCurrent && pts.length > 1) {
      const areaD = `${linePath(pts)} L${pts[pts.length - 1][0].toFixed(2)},${plotBottom} L${pts[0][0].toFixed(2)},${plotBottom} Z`;
      path(svg, areaD, areaGradient(svg, color), "none", 0).style.pointerEvents = "none";
    }
    // "hammer" stem: a dashed drop line from the arena's first snapshot down to
    // the baseline, so a line that debuts mid-chart still shows where it begins
    const [sx, sy] = pts[0];
    const stem = line(svg, sx, sy, sx, plotBottom, "", color, isCurrent ? 1.6 : 1);
    stem.setAttribute("stroke-opacity", isCurrent ? 0.7 : dim ? 0.12 : 0.3);
    stem.setAttribute("stroke-dasharray", "2 3");
    stem.style.pointerEvents = "none";
    const startDot = circle(svg, sx, sy, isCurrent ? 4 : dim ? 2 : 2.8, color, "#0a0b0e", 1.2);
    startDot.style.pointerEvents = "none";
    if (dim) startDot.setAttribute("opacity", 0.5);
    const p = tagMark(path(svg, linePath(pts), "", color, isCurrent ? 3 : dim ? 1.1 : 1.6), { arena: s.arena });
    p.setAttribute("stroke-opacity", baseOpacity);
    if (isCurrent) p.style.filter = `drop-shadow(0 0 6px ${color})`;
    p.style.cursor = "pointer";
    p.addEventListener("click", () => switchArena(s.arena));
    const last = s.rows[s.rows.length - 1];
    const prev = s.rows[s.rows.length - 2];
    const deltaLine = prev
      ? `<br>较上一快照 ${last.total_votes - prev.total_votes >= 0 ? "+" : ""}${formatNumber(
          last.total_votes - prev.total_votes,
        )} votes`
      : "";
    p.addEventListener("mouseenter", (event) => {
      p.setAttribute("stroke-opacity", 1); // hovering a dimmed line restores it
      showTooltip(
        event,
        `<strong>${s.arena}</strong>最新累计 votes ${formatNumber(last.total_votes)}${deltaLine}<br>模型 ${formatNumber(
          last.model_count,
        )} · ${s.rows.length} 个快照<br><em>点击聚焦该 arena</em>`,
      );
    });
    p.addEventListener("mouseleave", () => {
      p.setAttribute("stroke-opacity", baseOpacity);
      hideTooltip();
    });
    linkHover(p, { type: "arena", value: s.arena });
    s.endX = pts[pts.length - 1][0];
    s.endY = pts[pts.length - 1][1];
    s.color = color;
    s.isCurrent = isCurrent;
    s.dim = dim;
  });

  // right-side arena labels, nudged apart so 14 names don't overlap
  const labels = series.slice().sort((a, b) => a.endY - b.endY);
  let prevY = -Infinity;
  labels.forEach((s) => {
    const ly = Math.max(s.endY, prevY + 12);
    prevY = ly;
    const lx = margin.left + innerW + 8;
    circle(svg, s.endX, s.endY, s.isCurrent ? 3.5 : 2.5, s.color, "#0a0b0e", 1).setAttribute(
      "opacity",
      s.dim ? 0.5 : 1,
    );
    line(svg, s.endX, s.endY, lx - 4, ly, "", s.color, 1).setAttribute("stroke-opacity", s.dim ? 0.18 : 0.4);
    const t = tagMark(text(svg, lx, ly + 3.5, s.arena, s.isCurrent ? "tl-arena selected-label" : "tl-arena"), {
      arena: s.arena,
    });
    if (s.dim) t.setAttribute("opacity", 0.5);
    t.style.cursor = "pointer";
    t.addEventListener("click", () => switchArena(s.arena));
    linkHover(t, { type: "arena", value: s.arena });
  });
}



/* ============================================================
 * Leaderboard
 * ============================================================ */

function renderLeaderboard() {
  const rows = getFilteredLatestRows({ respectRank: true });
  els.leaderboardNote.textContent = `${state.arena} / ${state.category}`;
  els.tableNote.textContent = `${rows.length} rows`;

  renderLeaderboardChart(rows);
  renderLeaderboardTable(rows);
}

function renderLeaderboardChart(rows) {
  const svg = setupSvg(els.leaderboardChart);
  const margin = { top: 20, right: 48, bottom: 38, left: 252 };
  const width = svg.clientWidth || 920;
  const rowH = 26;
  const height = Math.max(340, rows.length * rowH + margin.top + margin.bottom);
  setViewBox(svg, width, height);
  clear(svg);

  if (!rows.length) {
    drawEmpty(svg, width, height, "当前筛选没有榜单数据");
    return;
  }

  const innerW = width - margin.left - margin.right;
  const minRating = min(rows, (d) => d.rating_lower ?? d.rating) - 8;
  const maxRating = max(rows, (d) => d.rating_upper ?? d.rating) + 8;
  const maxVotes = max(rows, (d) => d.vote_count || 0);

  drawXScale(svg, margin, width, height, minRating, maxRating, 5, (v) => Math.round(v));

  // left gutter: a fixed left-aligned rank column + an adaptive-width model
  // name (right-aligned against the bars). fitText guarantees the name never
  // collides with the rank column no matter how long the model name is.
  const RANK_X = 16;
  const NAME_RIGHT = margin.left - 14;
  const NAME_LEFT_BOUND = 66; // right edge of rank column + breathing gap
  const medalColors = ["#ffcf4a", "#d3dae6", "#e08a52"];

  rows.forEach((d, i) => {
    const y = margin.top + i * rowH + rowH / 2;
    const x = margin.left + scale(d.rating, minRating, maxRating, 0, innerW);
    const xLow = margin.left + scale(d.rating_lower ?? d.rating, minRating, maxRating, 0, innerW);
    const xHigh = margin.left + scale(d.rating_upper ?? d.rating, minRating, maxRating, 0, innerW);
    const color = getColor(d.organization || "unknown");
    const org = d.organization || "unknown";

    // leader row gets a faint neon band so the #1 reads as the headline
    if (i === 0) {
      const band = rect(svg, 6, y - rowH / 2 + 2, width - margin.right - 6, rowH - 4, "rgba(25,240,216,0.07)", 7);
      band.style.pointerEvents = "none";
    }

    const rk = text(svg, RANK_X, y + 4, `#${formatRank(d.rank)}`, "lb-rank", "start");
    if (medalColors[i]) rk.setAttribute("fill", medalColors[i]);
    fitText(
      tagMark(text(svg, NAME_RIGHT, y + 4, d.model_name, "chart-label", "end"), { model: d.model_name, org }),
      NAME_RIGHT - NAME_LEFT_BOUND,
    );
    tagMark(line(svg, xLow, y, xHigh, y, "", color, 2.4, "round"), { model: d.model_name, org });
    circle(svg, xLow, y, 3, "#fff", color);
    circle(svg, xHigh, y, 3, "#fff", color);
    const dot = tagMark(
      circle(svg, x, y, scale(Math.sqrt(d.vote_count || 0), 0, Math.sqrt(maxVotes || 1), 4, 11), color, "#fff", 1.3),
      { model: d.model_name, org },
    );
    dot.style.filter = `drop-shadow(0 0 5px ${color})`;
    dot.style.cursor = "pointer";
    dot.addEventListener("click", () => setFocusModel(d.model_name));
    dot.addEventListener("mouseenter", (event) =>
      showTooltip(
        event,
        `<strong>${d.model_name}</strong>${org}<br>Rank #${formatRank(d.rank)} · Rating ${formatDecimal(
          d.rating,
        )}<br>Interval ${formatDecimal(d.rating_lower)} - ${formatDecimal(d.rating_upper)}<br>Votes ${formatNumber(
          d.vote_count,
        )}`,
      ),
    );
    dot.addEventListener("mouseleave", hideTooltip);
    linkHover(dot, { type: "org", value: org });
  });
}

function renderLeaderboardTable(rows) {
  els.leaderboardTable.innerHTML = rows
    .map(
      (d) => `<tr data-mark="1" data-model="${escapeHtml(d.model_name)}" data-org="${escapeHtml(
        d.organization || "unknown",
      )}">
        <td>#${formatRank(d.rank)}</td>
        <td>${escapeHtml(d.model_name)}</td>
        <td>${escapeHtml(d.organization || "unknown")}</td>
        <td>${formatDecimal(d.rating)}</td>
        <td>${formatDecimal(d.rating_lower)} - ${formatDecimal(d.rating_upper)}</td>
        <td>${formatNumber(d.vote_count)}</td>
      </tr>`,
    )
    .join("");

  els.leaderboardTable.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", () => setFocusModel(row.dataset.model));
    linkHover(row, { type: "org", value: row.dataset.org });
  });
}

/* ============================================================
 * Hero band (headline champion + podium)
 * ============================================================ */

function renderHero() {
  if (!data.manifest) return;
  const rows = data.latest
    .filter((d) => d.arena === state.arena && d.category === state.category)
    .sort((a, b) => a.rank - b.rank);
  if (!rows.length) {
    els.hero.hidden = true;
    return;
  }
  els.hero.hidden = false;
  const champ = rows[0];
  const runnerUp = rows[1];
  const org = champ.organization || "unknown";
  const lead = runnerUp ? champ.rating - runnerUp.rating : 0;

  // rating move vs the previous snapshot (the top-N rank series always carries #1)
  const champSeries = data.rankSeries
    .filter((d) => d.arena === state.arena && d.category === state.category && d.model_name === champ.model_name)
    .sort((a, b) => new Date(a.leaderboard_publish_date) - new Date(b.leaderboard_publish_date));
  let deltaBadge = "";
  if (champSeries.length >= 2) {
    const dr = champSeries[champSeries.length - 1].rating - champSeries[champSeries.length - 2].rating;
    if (Math.abs(dr) >= 0.05) {
      const up = dr >= 0;
      deltaBadge = `<span class="champ-delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${formatDecimal(Math.abs(dr))}</span>`;
    }
  }

  els.heroKicker.textContent = `当前榜首 · ${state.arena} / ${state.category}`;
  els.heroChampion.innerHTML = `
    <span class="crown">👑</span>
    <span class="champ-name">${escapeHtml(champ.model_name)}</span>
    <span class="champ-org">${escapeHtml(org)} · ${escapeHtml(champ.license || "unknown")}</span>
    <span class="champ-rating"><b data-count="${champ.rating}" data-decimals="0">0</b>
      ${deltaBadge}
      <em>Rating${runnerUp ? ` · 领先第二名 +${formatDecimal(lead)}` : ""}</em></span>
  `;
  els.heroChampion.style.cursor = "pointer";
  els.heroChampion.onclick = () => setFocusModel(champ.model_name);

  els.heroMeta.innerHTML = [
    `${formatNumber(champ.vote_count)} votes`,
    `区间 ${formatDecimal(champ.rating_lower)}–${formatDecimal(champ.rating_upper)}`,
    `${rows.length} 个上榜模型`,
    `${unique(rows.map((d) => d.organization || "unknown")).length} 家机构同场`,
  ]
    .map((t) => `<span class="pill">${escapeHtml(t)}</span>`)
    .join("");

  els.podiumNote.textContent = `${state.arena} / ${state.category}`;
  const top3 = rows.slice(0, 3);
  // visual podium order: 2nd (left) · 1st (center) · 3rd (right)
  const layout = [
    { d: top3[1], cls: "silver", medal: "🥈" },
    { d: top3[0], cls: "gold", medal: "🥇" },
    { d: top3[2], cls: "bronze", medal: "🥉" },
  ].filter((x) => x.d);

  els.podiumStage.innerHTML = layout
    .map(
      ({ d, cls, medal }) => `
      <div class="podium-col" data-model="${escapeHtml(d.model_name)}">
        <span class="pc-name">${escapeHtml(truncate(d.model_name, 28))}</span>
        <span class="pc-org">${escapeHtml(d.organization || "unknown")}</span>
        <div class="podium-bar ${cls}">
          <span class="pb-rank">${medal}</span>
          <span class="pb-rating">${formatDecimal(d.rating)}</span>
        </div>
      </div>`,
    )
    .join("");
  els.podiumStage.querySelectorAll(".podium-col").forEach((node) => {
    node.addEventListener("click", () => setFocusModel(node.dataset.model));
  });

  // animate the headline rating count-up
  els.heroChampion.querySelectorAll("[data-count]").forEach((node) => {
    animateNumber(node, Number(node.dataset.count), { decimals: Number(node.dataset.decimals) || 0 });
  });
}

// Lightweight count-up animation for headline numbers.
function animateNumber(node, target, { decimals = 0, duration = 700 } = {}) {
  if (!Number.isFinite(target)) {
    node.textContent = "-";
    return;
  }
  const startTime = performance.now();
  const fmt = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  const token = (node._countToken = (node._countToken || 0) + 1);
  const step = (now) => {
    if (node._countToken !== token) return; // superseded by a newer render
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = fmt(target);
  };
  requestAnimationFrame(step);
}

/* ============================================================
 * Bar-chart race (signature interaction)
 * ============================================================ */

const RACE_MAX = 20; // legibility cap for the race's fixed height

function renderRace() {
  // The race depends only on arena / category / rankLimit — NOT on the org
  // filter, focus, brush, or search. Rebuilding it on those interactions
  // cleared the drop-shadow-filtered SVG nodes mid-interaction (which left a
  // compositor ghost) and also restarted playback. Skip the rebuild when the
  // inputs are unchanged; applyLinking() still updates focus/dim on the
  // existing rows, so linked highlighting keeps working without a rebuild.
  const key = `${state.arena}|${state.category}|${state.rankLimit}`;
  if (race.key === key && race.rowEls && race.rowEls.size) return;
  race.key = key;

  stopRace();
  const svg = els.raceChart;
  clear(svg);
  race.rowEls = new Map();
  race.n = clamp(state.rankLimit, 5, RACE_MAX); // follow the "Rank Top" control

  const rows = data.rankSeries.filter((d) => d.arena === state.arena && d.category === state.category);
  if (!rows.length) {
    const width = svg.clientWidth || 1000;
    setViewBox(svg, width, 430);
    clear(svg);
    drawEmpty(svg, width, 430, "当前筛选没有时间序列数据");
    els.raceDate.textContent = "—";
    els.raceScrub.max = 0;
    return;
  }

  const dates = unique(rows.map((d) => d.leaderboard_publish_date)).sort();
  const byDate = new Map();
  dates.forEach((dt) => byDate.set(dt, []));
  rows.forEach((d) => {
    byDate.get(d.leaderboard_publish_date).push({
      model: d.model_name,
      org: d.organization || "unknown",
      rating: d.rating,
      rank: d.rank,
    });
  });
  byDate.forEach((arr, dt) => {
    arr.sort((a, b) => b.rating - a.rating);
    byDate.set(dt, arr.slice(0, race.n));
  });

  race.dates = dates;
  race.byDate = byDate;
  race.frame = dates.length - 1; // start parked at the latest snapshot

  // each frame only carries as many models as the precomputed top series holds
  // (10) — shrink race.n to the real count so the chart has no empty rows
  let maxLen = 0;
  byDate.forEach((arr) => {
    if (arr.length > maxLen) maxLen = arr.length;
  });
  if (maxLen) race.n = Math.min(race.n, maxLen);

  els.raceScrub.max = dates.length - 1;
  els.raceScrub.value = race.frame;
  drawRaceFrame();
}

function raceGeom() {
  const svg = els.raceChart;
  const width = svg.clientWidth || 1000;
  const height = 430;
  setViewBox(svg, width, height);
  const margin = { top: 18, right: 70, bottom: 16, left: 176 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const rowH = innerH / Math.max(1, race.n || 12);
  return { svg, width, height, margin, innerW, innerH, rowH };
}

function drawRaceFrame() {
  if (!race.dates.length) return;
  const date = race.dates[race.frame];
  const frameRows = race.byDate.get(date) || [];
  const { svg, margin, innerW, rowH } = raceGeom();
  const barH = Math.max(12, rowH * 0.62);

  // Per-frame domain: every frame fills the width so length differences stay
  // legible (a single stable scale squashes the dense modern frames into a wall
  // of near-equal bars). Smooth width transitions + value labels + the big date
  // watermark carry the absolute progression as the race plays.
  const ratings = frameRows.map((d) => d.rating);
  const dMax = ratings.length ? Math.max(...ratings) : 1;
  const dMin = ratings.length ? Math.min(...ratings) : 0;
  const pad = Math.max(8, (dMax - dMin) * 0.28);
  const domLo = dMin - pad;
  const domHi = dMax + pad * 0.45;

  els.raceDate.textContent = shortDate(date);
  els.raceScrub.value = race.frame;

  // giant translucent date behind the bars — an HTML layer (see styles.css) so
  // it can't leave an SVG repaint ghost when the scatter brush rect is removed
  if (els.raceWatermark) els.raceWatermark.textContent = shortDate(date);

  const present = new Set();
  frameRows.forEach((d, i) => {
    present.add(d.model);
    const y = margin.top + i * rowH;
    const barW = Math.max(6, scale(d.rating, domLo, domHi, 10, innerW));
    const color = getColor(d.org);
    const fill = barGradient(svg, color);
    let row = race.rowEls.get(d.model);
    if (!row) {
      // build a persistent row group so the next frame can transition it
      const g = svgEl("g", { class: "race-row" });
      g.style.transition = "transform 0.55s cubic-bezier(0.22,1,0.36,1), opacity 0.35s ease";
      tagMark(g, { model: d.model, org: d.org });
      g.style.cursor = "pointer";
      const bar = svgEl("rect", { x: margin.left, y: 0, height: barH, rx: 7, fill });
      bar.style.transition = "width 0.55s cubic-bezier(0.22,1,0.36,1)";
      const badge = svgEl("text", { x: margin.left + 12, y: barH / 2 + 4, class: "race-rank-badge" });
      const label = svgEl("text", { x: margin.left - 12, y: barH / 2 + 4, class: "race-row-label", "text-anchor": "end" });
      const value = svgEl("text", { x: margin.left + barW + 10, y: barH / 2 + 4, class: "race-row-value" });
      g.appendChild(bar);
      g.appendChild(badge);
      g.appendChild(label);
      g.appendChild(value);
      g.addEventListener("click", () => setFocusModel(d.model));
      linkHover(g, { type: "model", value: d.model });
      svg.appendChild(g);
      row = { g, bar, badge, label, value };
      race.rowEls.set(d.model, row);
      // start collapsed so the first appearance grows in
      bar.setAttribute("width", 0);
      g.style.transform = `translateY(${y}px)`;
    }
    const lead = i === 0;
    row.g.classList.remove("race-gone");
    row.g.style.transform = `translateY(${y}px)`;
    row.bar.setAttribute("width", barW);
    row.bar.setAttribute("fill", fill);
    row.bar.setAttribute("height", barH);
    row.bar.style.filter = `drop-shadow(0 0 ${lead ? 13 : 6}px ${color})`; // leader glows hardest
    row.badge.textContent = `#${i + 1}`;
    row.badge.setAttribute("y", barH / 2 + 4);
    row.label.textContent = truncate(d.model, 24);
    row.label.setAttribute("y", barH / 2 + 4);
    row.value.textContent = formatDecimal(d.rating);
    row.value.setAttribute("x", margin.left + barW + 10);
    row.value.setAttribute("y", barH / 2 + 4);
  });

  // models that dropped out of the top N fade away. Use a class (not inline
  // opacity) so the `.race-row.race-gone` rule can override `.race-row.is-dim`
  // — otherwise hovering/dimming (which sets opacity:1 to avoid ghosting) would
  // un-hide every dropped-out row and they would pile up at their old positions.
  race.rowEls.forEach((row, model) => {
    if (!present.has(model)) row.g.classList.add("race-gone");
  });

  applyLinking();
}

function startRace() {
  if (!race.dates.length) return;
  if (race.frame >= race.dates.length - 1) race.frame = 0; // replay from start
  race.playing = true;
  els.racePlay.textContent = "⏸ 暂停";
  const speed = Number(els.raceSpeed.value) || 2;
  const interval = Math.round(820 / speed);
  race.timer = setInterval(() => {
    if (race.frame >= race.dates.length - 1) {
      drawRaceFrame();
      stopRace();
      return;
    }
    race.frame += 1;
    drawRaceFrame();
  }, interval);
}

function stopRace() {
  if (race.timer) clearInterval(race.timer);
  race.timer = null;
  race.playing = false;
  if (els.racePlay) els.racePlay.textContent = "▶ 播放";
}

function toggleRacePlay() {
  if (race.playing) stopRace();
  else startRace();
}

/* ============================================================
 * Detail drawer (details-on-demand)
 * ============================================================ */

function rankColor(rank) {
  // 1 (strong, neon cyan) -> 60+ (weak, hot red)
  const t = clamp((rank - 1) / 59, 0, 1);
  const a = [25, 240, 216]; // #19f0d8
  const b = [255, 84, 112]; // #ff5470
  const mid = [255, 207, 74]; // #ffcf4a
  const lerp = (x, y, k) => Math.round(x + (y - x) * k);
  let c;
  if (t < 0.5) {
    const k = t / 0.5;
    c = [lerp(a[0], mid[0], k), lerp(a[1], mid[1], k), lerp(a[2], mid[2], k)];
  } else {
    const k = (t - 0.5) / 0.5;
    c = [lerp(mid[0], b[0], k), lerp(mid[1], b[1], k), lerp(mid[2], b[2], k)];
  }
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function renderModelDrawer(name) {
  els.drawerKicker.textContent = "模型详情";
  const profile = profileByModel.get(name);
  const latestRecords = data.latest.filter((d) => d.model_name === name).sort((a, b) => a.rank - b.rank);
  const head = profile || latestRecords[0];
  if (!head) {
    els.drawerBody.innerHTML = '<div class="empty">无该模型数据</div>';
    return;
  }

  const org = profile?.organization || latestRecords[0]?.organization || "unknown";
  const license = profile?.license || latestRecords[0]?.license || "unknown";
  const bestRank = profile?.best_rank ?? min(latestRecords, (d) => d.rank);
  const bestRating = profile?.max_rating ?? max(latestRecords, (d) => d.rating);
  const arenaCount = profile?.arena_count ?? unique(latestRecords.map((d) => d.arena)).length;
  const categoryCount = profile?.category_count ?? unique(latestRecords.map((d) => d.category)).length;
  const totalVotes = profile?.total_votes ?? latestRecords.reduce((s, d) => s + (d.vote_count || 0), 0);

  const records = (profile?.records || latestRecords).slice().sort((a, b) => a.rank - b.rank);
  const maxBarVotes = max(records, (d) => d.vote_count || 0) || 1;

  els.drawerBody.innerHTML = `
    <div class="model-title">
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(org || "unknown")} · ${escapeHtml(license || "unknown")}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-metric"><strong>#${formatRank(bestRank)}</strong><span>Best Rank</span></div>
      <div class="detail-metric"><strong>${formatDecimal(bestRating)}</strong><span>Best Rating</span></div>
      <div class="detail-metric"><strong>${formatNumber(arenaCount)}</strong><span>Arenas</span></div>
      <div class="detail-metric"><strong>${formatNumber(categoryCount)}</strong><span>Categories</span></div>
      <div class="detail-metric wide"><strong>${formatNumber(totalVotes)}</strong><span>Total Votes</span></div>
    </div>
    <div class="drawer-section-title">类别强弱热力 <span>（按排名着色 · ${records.length} 条记录）</span></div>
    <div class="heatlist">
      ${records
        .map((d) => {
          const votesW = Math.round(scale(Math.sqrt(d.vote_count || 0), 0, Math.sqrt(maxBarVotes), 8, 100));
          return `<div class="heatrow">
            <span class="heatrow-label" title="${escapeHtml(d.arena)} / ${escapeHtml(d.category)}">
              <em>${escapeHtml(d.arena)}</em>${escapeHtml(d.category)}
            </span>
            <span class="heatrow-rank" style="background:${rankColor(d.rank)}">#${formatRank(d.rank)}</span>
            <span class="heatrow-rating">${formatDecimal(d.rating)}</span>
            <span class="heatrow-votes"><i style="width:${votesW}%"></i></span>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

function renderOrgDrawer(org) {
  els.drawerKicker.textContent = "机构详情";
  const orgRows = data.organizations
    .filter((d) => (d.organization || "unknown") === org)
    .sort((a, b) => a.best_rank - b.best_rank);
  if (!orgRows.length) {
    els.drawerBody.innerHTML = '<div class="empty">无该机构数据</div>';
    return;
  }
  const uniqueModels = max(orgRows, (d) => d.unique_models);
  const bestRank = min(orgRows, (d) => d.best_rank);
  const totalVotes = orgRows.reduce((s, d) => s + (d.total_votes || 0), 0);
  const avgRating = orgRows.reduce((s, d) => s + (d.avg_rating || 0), 0) / orgRows.length;

  const topModels = data.latest
    .filter((d) => d.arena === state.arena && d.category === state.category && (d.organization || "unknown") === org)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8);

  els.drawerBody.innerHTML = `
    <div class="model-title">
      <strong>${escapeHtml(org)}</strong>
      <span>覆盖 ${orgRows.length} 个 arena</span>
    </div>
    <div class="detail-grid">
      <div class="detail-metric"><strong>#${formatRank(bestRank)}</strong><span>Best Rank</span></div>
      <div class="detail-metric"><strong>${formatNumber(uniqueModels)}</strong><span>Unique Models</span></div>
      <div class="detail-metric"><strong>${formatDecimal(avgRating)}</strong><span>Avg Rating</span></div>
      <div class="detail-metric"><strong>${formatNumber(totalVotes)}</strong><span>Total Votes</span></div>
    </div>
    <div class="drawer-section-title">各 Arena 表现</div>
    <div class="mini-list">
      ${orgRows
        .map(
          (d) => `<div class="mini-row">
            <div><strong>${escapeHtml(d.arena)}</strong><span>${formatNumber(d.unique_models)} models</span></div>
            <span>#${formatRank(d.best_rank)} · ${formatDecimal(d.avg_rating)}</span>
          </div>`,
        )
        .join("")}
    </div>
    <div class="drawer-section-title">当前 arena 上榜模型 <span>（点击下钻）</span></div>
    <div class="mini-list">
      ${
        topModels.length
          ? topModels
              .map(
                (d) => `<button class="mini-row drill" data-model="${escapeHtml(d.model_name)}">
            <div><strong>${escapeHtml(truncate(d.model_name, 26))}</strong><span>${escapeHtml(d.category)}</span></div>
            <span>#${formatRank(d.rank)} · ${formatDecimal(d.rating)}</span>
          </button>`,
              )
              .join("")
          : '<div class="empty">该机构在当前 arena/category 无上榜模型</div>'
      }
    </div>
  `;

  els.drawerBody.querySelectorAll(".drill").forEach((node) => {
    node.addEventListener("click", () => setFocusModel(node.dataset.model));
  });
}

/* ============================================================
 * Evolution (bump chart)
 * ============================================================ */

function renderEvolution() {
  const svg = setupSvg(els.evolutionChart);
  const allRows = data.rankSeries
    .filter((d) => d.arena === state.arena && d.category === state.category)
    .sort((a, b) => new Date(a.leaderboard_publish_date) - new Date(b.leaderboard_publish_date));

  els.evolutionNote.textContent = `${state.arena} / ${state.category}`;

  const margin = { top: 24, right: 184, bottom: 40, left: 48 };
  const width = svg.clientWidth || 1100;
  const height = 400;
  setViewBox(svg, width, height);
  clear(svg);

  if (!allRows.length) {
    drawEmpty(svg, width, height, "当前筛选没有排名演化数据");
    return;
  }

  const allDates = unique(allRows.map((d) => d.leaderboard_publish_date)).sort();

  const selectedNames = latestNamesForEvolution(allRows).slice(0, Math.min(10, state.rankLimit));
  const visibleNames = selectedNames.filter((n) => !state.hiddenSeries.has(n));

  // trim the x-domain to where the selected (current Top) models actually have
  // data — otherwise their long pre-debut absence shows as empty space on the left
  const selRows = allRows.filter((d) => selectedNames.includes(d.model_name));
  const selTimes = selRows.map((d) => new Date(d.leaderboard_publish_date).getTime());
  const dataMin = selTimes.length ? Math.min(...selTimes) : new Date(allDates[0]).getTime();
  const dataMax = selTimes.length ? Math.max(...selTimes) : new Date(allDates[allDates.length - 1]).getTime();
  const minDate = state.timeWindow ? Math.max(dataMin, state.timeWindow.start) : dataMin;
  const maxDate = state.timeWindow ? Math.min(dataMax, state.timeWindow.end) : dataMax;

  const rows = allRows.filter((d) => {
    const t = new Date(d.leaderboard_publish_date).getTime();
    return t >= minDate && t <= maxDate;
  });
  const filtered = rows.filter((d) => selectedNames.includes(d.model_name));
  const byModel = groupBy(filtered, (d) => d.model_name);
  const dates = unique(rows.map((d) => d.leaderboard_publish_date)).sort();
  const maxRank = Math.min(15, Math.max(10, max(filtered, (d) => d.rank)));
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  for (let rank = 1; rank <= maxRank; rank += 1) {
    const y = margin.top + scale(rank, 1, maxRank, 0, innerH);
    line(svg, margin.left, y, width - margin.right, y, "grid-line");
    text(svg, margin.left - 10, y + 4, `#${rank}`, "axis", "end");
  }

  drawXAxisDateTicks(svg, dates.length ? dates : allDates, margin, innerW, innerH);

  const xOf = (d) =>
    margin.left + scale(new Date(d.leaderboard_publish_date).getTime(), minDate, maxDate, 0, innerW);
  const yOf = (d) => margin.top + scale(d.rank, 1, maxRank, 0, innerH);

  // Overlay sits BENEATH the data marks so lines/dots remain clickable; it
  // captures crosshair hover + time brushing on the empty plot area.
  const overlay = rect(svg, margin.left, margin.top, innerW, innerH, "transparent", 0);
  overlay.classList.add("brush-overlay");
  addEvolutionCrosshair(
    svg,
    { left: margin.left, top: margin.top, innerW, innerH, minDate, maxDate, dates, visibleNames, byModel },
    overlay,
  );
  addTimeBrush(svg, { left: margin.left, top: margin.top, innerW, innerH, x0: minDate, x1: maxDate }, overlay);

  selectedNames.forEach((name) => {
    const hidden = state.hiddenSeries.has(name);
    const series = (byModel.get(name) || []).slice().sort(
      (a, b) => new Date(a.leaderboard_publish_date) - new Date(b.leaderboard_publish_date),
    );
    const color = getColor(series[0]?.organization || name);
    const org = series[0]?.organization || "unknown";
    if (!hidden && series.length) {
      const points = series.map((d) => [xOf(d), yOf(d), d]);
      tagMark(path(svg, linePath(points), "", color, 2.4), { model: name, org });
      points.forEach(([x, y, d]) => {
        const dot = tagMark(circle(svg, x, y, 4, color, "#fff", 1.1), { model: name, org });
        dot.style.cursor = "pointer";
        dot.addEventListener("click", () => setFocusModel(name));
        linkHover(dot, { type: "model", value: name });
      });
    }
  });

  // interactive legend (right column)
  selectedNames.forEach((name, index) => {
    const series = byModel.get(name) || allRows.filter((d) => d.model_name === name);
    const color = getColor(series[0]?.organization || name);
    const ly = margin.top + index * 22;
    const hidden = state.hiddenSeries.has(name);
    const g = svgEl("g", { class: `legend-item${hidden ? " legend-hidden" : ""}`, transform: `translate(${width - margin.right + 12}, ${ly})` });
    tagMark(g, { model: name, org: series[0]?.organization || "unknown" });
    g.style.cursor = "pointer";
    const sw = svgEl("rect", { x: 0, y: -8, width: 12, height: 12, rx: 3, fill: color });
    const tx = svgEl("text", { x: 18, y: 2, class: "legend-text" });
    tx.textContent = truncate(name, 20);
    g.appendChild(sw);
    g.appendChild(tx);
    svg.appendChild(g);
    g.addEventListener("click", (event) => {
      if (event.shiftKey) {
        setFocusModel(name);
        return;
      }
      if (hidden) state.hiddenSeries.delete(name);
      else state.hiddenSeries.add(name);
      renderEvolution();
      applyLinking();
    });
    linkHover(g, { type: "model", value: name });
  });

  drawAxisLabel(svg, margin.left, 18, "rank（越上越好）", "axis");
  text(svg, width - margin.right + 12, margin.top - 14, "图例：点击隐藏 / Shift+点击聚焦", "minor-label");
}

function addEvolutionCrosshair(svg, geom, overlay) {
  const { left, top, innerW, innerH, minDate, maxDate, dates, visibleNames, byModel } = geom;
  if (!dates.length) return;
  const guide = svgEl("line", { class: "crosshair", x1: left, y1: top, x2: left, y2: top + innerH });
  guide.style.display = "none";
  svg.appendChild(guide);

  overlay.addEventListener("mousemove", (event) => {
    const px = pointerX(svg, event);
    const t = scale(px, left, left + innerW, minDate, maxDate);
    // nearest date
    let nearest = dates[0];
    let best = Infinity;
    dates.forEach((dt) => {
      const diff = Math.abs(new Date(dt).getTime() - t);
      if (diff < best) {
        best = diff;
        nearest = dt;
      }
    });
    const gx = left + scale(new Date(nearest).getTime(), minDate, maxDate, 0, innerW);
    guide.setAttribute("x1", gx);
    guide.setAttribute("x2", gx);
    guide.style.display = "block";

    const ranked = visibleNames
      .map((name) => {
        const rec = (byModel.get(name) || []).find((d) => d.leaderboard_publish_date === nearest);
        return rec ? { name, rank: rec.rank, rating: rec.rating } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8);
    if (!ranked.length) {
      hideTooltip();
      return;
    }
    showTooltip(
      event,
      `<strong>${nearest}</strong>` +
        ranked
          .map((r) => `#${formatRank(r.rank)} ${escapeHtml(truncate(r.name, 22))} · ${formatDecimal(r.rating)}`)
          .join("<br>"),
    );
  });
  overlay.addEventListener("mouseleave", () => {
    guide.style.display = "none";
    hideTooltip();
  });
}

/* ============================================================
 * Organizations
 * ============================================================ */

function renderOrganizations() {
  const rows = data.organizations
    .filter((d) => d.arena === state.arena)
    .sort((a, b) => a.best_rank - b.best_rank || b.unique_models - a.unique_models)
    .slice(0, 18);

  els.orgScatterNote.textContent = `${rows.length} 家 · ${state.arena}`;
  els.orgBarsNote.textContent = `Top ${Math.min(12, rows.length)} / ${rows.length} 家`;
  renderOrgScatter(rows);
  renderOrgBars(rows);
}

function renderOrgScatter(rows) {
  const svg = setupSvg(els.orgScatter);
  const margin = { top: 24, right: 78, bottom: 44, left: 52 };
  const width = svg.clientWidth || 680;
  const height = 360;
  setViewBox(svg, width, height);
  clear(svg);

  if (!rows.length) {
    drawEmpty(svg, width, height, "当前 arena 没有机构数据");
    return;
  }

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxModels = max(rows, (d) => d.unique_models);
  const maxRank = Math.max(10, max(rows, (d) => d.best_rank));
  const maxVotes = max(rows, (d) => d.total_votes);

  drawGrid(svg, margin, width, height, 5);
  // y-axis: best rank #1 at the TOP so labels match the bubble positions
  for (let i = 0; i <= 5; i += 1) {
    const value = 1 + ((maxRank - 1) / 5) * i;
    const yTick = margin.top + scale(value, 1, maxRank, 0, innerH);
    text(svg, margin.left - 10, yTick + 4, `#${Math.round(value)}`, "axis", "end");
  }
  drawXAxis(svg, margin, innerW, innerH, 0, maxModels, 5, (v) => Math.round(v));

  // brush overlay spans the WHOLE chart (not just the inner plot) so a drag can
  // start from the margins and lasso bubbles sitting right at the edges
  const overlay = rect(svg, 0, 0, width, height, "transparent", 0);
  overlay.classList.add("brush-overlay");

  // pass 1: draw bubbles, collect positions for label placement
  const marks = rows.map((d) => {
    const org = d.organization || "unknown";
    const x = margin.left + scale(d.unique_models, 0, maxModels, 0, innerW);
    const y = margin.top + scale(d.best_rank, 1, maxRank, 0, innerH);
    const r = scale(Math.sqrt(d.total_votes || 0), 0, Math.sqrt(maxVotes || 1), 7, 22);
    const color = getColor(org);
    const dot = tagMark(circle(svg, x, y, r, color, "#fff", 1.5, 0.82), { org });
    dot.style.filter = `drop-shadow(0 0 4px ${color})`;
    dot.style.cursor = "pointer";
    dot.addEventListener("click", () => setFocusOrg(org));
    dot.addEventListener("mouseenter", (event) =>
      showTooltip(
        event,
        `<strong>${org}</strong>模型 ${formatNumber(d.unique_models)}<br>最好名次 #${formatRank(
          d.best_rank,
        )}<br>平均 rating ${formatDecimal(d.avg_rating)}<br>Votes ${formatNumber(d.total_votes)}<br><em>点击聚焦 · 框选多家对比</em>`,
      ),
    );
    dot.addEventListener("mouseleave", hideTooltip);
    linkHover(dot, { type: "org", value: org });
    return { org, x, y, r };
  });

  // brushing uses the real bubble positions/radii from above; a box only has to
  // TOUCH a bubble (center ± radius) to grab it, and may be dragged anywhere in
  // the chart — both make edge bubbles easy to lasso
  addScatterBrush(svg, { bounds: { x0: 0, y0: 0, x1: width, y1: height }, marks, rows }, overlay);

  // pass 2: labels. Each carries a dark halo (paint-order stroke) so it stays
  // legible even over a bubble. We measure the real label width and push a label
  // down only when it actually overlaps an already-placed one (both axes) — this
  // untangles the dense rank-#1 cluster without over-separating distant labels.
  const placed = [];
  const topEdge = margin.top + 4;
  const bottomEdge = margin.top + innerH + 4;
  marks
    .map((m) => {
      const onLeft = m.x > margin.left + innerW * 0.5;
      return { m, anchor: onLeft ? "end" : "start", tx: onLeft ? m.x - m.r - 7 : m.x + m.r + 7, ty: m.y + 4 };
    })
    .sort((a, b) => a.ty - b.ty)
    .forEach((l) => {
      const t = fitText(tagMark(text(svg, l.tx, l.ty, l.m.org, "scatter-label", l.anchor), { org: l.m.org }), 104);
      const w = t.getComputedTextLength();
      const x0 = l.anchor === "end" ? l.tx - w : l.tx;
      const x1 = x0 + w;
      const overlaps = () =>
        placed.some((p) => x0 < p.x1 + 5 && x1 > p.x0 - 5 && Math.abs(l.ty - p.ty) < 13);
      let guard = 0;
      while (overlaps() && l.ty < bottomEdge && guard < 60) {
        l.ty += 4;
        guard += 1;
      }
      l.ty = clamp(l.ty, topEdge, bottomEdge);
      t.setAttribute("y", l.ty);
      // leader line back to the bubble when the label was nudged away
      if (Math.abs(l.ty - 4 - l.m.y) > 7) {
        const edgeX = l.anchor === "end" ? l.m.x - l.m.r : l.m.x + l.m.r;
        line(svg, edgeX, l.m.y, l.tx, l.ty - 4, "", "rgba(150,170,205,0.42)", 1).style.pointerEvents = "none";
      }
      placed.push({ x0, x1, ty: l.ty });
    });

  drawAxisLabel(svg, margin.left + innerW / 2, height - 9, "unique models", "axis", "middle");
  drawAxisLabel(svg, margin.left, 18, "best rank", "axis");
}

function renderOrgBars(rows) {
  const svg = setupSvg(els.orgBars);
  const margin = { top: 16, right: 38, bottom: 28, left: 124 };
  const width = svg.clientWidth || 680;
  const height = 348;
  setViewBox(svg, width, height);
  clear(svg);

  if (!rows.length) {
    drawEmpty(svg, width, height, "当前 arena 没有机构数据");
    return;
  }

  const sorted = [...rows].sort((a, b) => b.unique_models - a.unique_models).slice(0, 12);
  const innerW = width - margin.left - margin.right;
  const rowH = (height - margin.top - margin.bottom) / sorted.length;
  const maxModels = max(sorted, (d) => d.unique_models);

  sorted.forEach((d, i) => {
    const org = d.organization || "unknown";
    const color = getColor(org);
    const y = margin.top + i * rowH;
    const barW = scale(d.unique_models, 0, maxModels, 0, innerW);
    tagMark(text(svg, margin.left - 10, y + rowH / 2 + 4, truncate(org, 16), "chart-label", "end"), { org });
    const bar = tagMark(
      rect(svg, margin.left, y + rowH * 0.23, barW, Math.max(8, rowH * 0.54), barGradient(svg, color), 4),
      { org },
    );
    bar.style.filter = `drop-shadow(0 0 5px ${color})`;
    bar.style.cursor = "pointer";
    bar.addEventListener("click", () => setFocusOrg(org));
    bar.addEventListener("mouseenter", (event) =>
      showTooltip(
        event,
        `<strong>${org}</strong>模型 ${formatNumber(d.unique_models)}<br>最好名次 #${formatRank(
          d.best_rank,
        )}<br><em>点击聚焦机构</em>`,
      ),
    );
    bar.addEventListener("mouseleave", hideTooltip);
    linkHover(bar, { type: "org", value: org });
    text(svg, margin.left + barW + 8, y + rowH / 2 + 4, formatNumber(d.unique_models), "minor-label");
  });

  line(svg, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "axis-line");
}

/* ============================================================
 * Brushing primitives
 * ============================================================ */

function pointerX(svg, event) {
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return ((event.clientX - box.left) / box.width) * vb.width;
}
function pointerY(svg, event) {
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return ((event.clientY - box.top) / box.height) * vb.height;
}

function drawWindowBand(svg, margin, innerW, innerH, x0, x1) {
  if (!state.timeWindow) return;
  const s = clamp(state.timeWindow.start, x0, x1);
  const e = clamp(state.timeWindow.end, x0, x1);
  const xs = margin.left + scale(s, x0, x1, 0, innerW);
  const xe = margin.left + scale(e, x0, x1, 0, innerW);
  rect(svg, xs, margin.top, Math.max(1, xe - xs), innerH, "rgba(22,105,122,0.10)", 0).classList.add("brush-band");
}

function addTimeBrush(svg, geom, sharedOverlay) {
  const { left, top, innerW, innerH, x0, x1 } = geom;
  const overlay = sharedOverlay || rect(svg, left, top, innerW, innerH, "transparent", 0);
  if (!sharedOverlay) overlay.classList.add("brush-overlay");
  let startX = null;
  let band = null;

  const onMove = (event) => {
    if (startX == null || !band) return;
    const cur = clamp(pointerX(svg, event), left, left + innerW);
    band.setAttribute("x", Math.min(startX, cur));
    band.setAttribute("width", Math.abs(cur - startX));
  };
  const onUp = (event) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (startX == null) return;
    const cur = clamp(pointerX(svg, event), left, left + innerW);
    const lo = Math.min(startX, cur);
    const hi = Math.max(startX, cur);
    startX = null;
    band = null;
    if (hi - lo < 6) return; // treat as click, ignore
    const tStart = scale(lo, left, left + innerW, x0, x1);
    const tEnd = scale(hi, left, left + innerW, x0, x1);
    state.timeWindow = { start: Math.round(tStart), end: Math.round(tEnd) };
    renderAll();
  };

  overlay.addEventListener("mousedown", (event) => {
    startX = clamp(pointerX(svg, event), left, left + innerW);
    band = rect(svg, startX, top, 0, innerH, "rgba(22,105,122,0.16)", 0);
    band.classList.add("brush-live");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    event.preventDefault();
  });
  overlay.addEventListener("dblclick", () => {
    if (state.timeWindow) {
      state.timeWindow = null;
      renderAll();
    }
  });
}

function addScatterBrush(svg, geom, sharedOverlay) {
  const { bounds, marks, rows } = geom;
  const overlay = sharedOverlay || rect(svg, bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0, "transparent", 0);
  if (!sharedOverlay) overlay.classList.add("brush-overlay");
  let start = null;
  let box = null;

  const cx = (event) => clamp(pointerX(svg, event), bounds.x0, bounds.x1);
  const cy = (event) => clamp(pointerY(svg, event), bounds.y0, bounds.y1);

  const onMove = (event) => {
    if (!start || !box) return;
    const x = cx(event);
    const y = cy(event);
    box.setAttribute("x", Math.min(start.x, x));
    box.setAttribute("y", Math.min(start.y, y));
    box.setAttribute("width", Math.abs(x - start.x));
    box.setAttribute("height", Math.abs(y - start.y));
  };
  const onUp = (event) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (!start) return;
    const x = cx(event);
    const y = cy(event);
    const x1 = Math.min(start.x, x);
    const x2 = Math.max(start.x, x);
    const y1 = Math.min(start.y, y);
    const y2 = Math.max(start.y, y);
    start = null;
    if (box) box.remove();
    box = null;
    if (x2 - x1 < 6 && y2 - y1 < 6) return; // click, not brush
    // select a bubble when the box merely TOUCHES it (center ± radius + slack),
    // not only when it covers the exact center — makes edge bubbles easy to grab
    const selected = new Set();
    marks.forEach((m) => {
      const pad = m.r + 5;
      if (m.x + pad >= x1 && m.x - pad <= x2 && m.y + pad >= y1 && m.y - pad <= y2) {
        selected.add(m.org);
      }
    });
    if (!selected.size) return;
    state.brushOrgs = selected;
    state.focusOrg = null;
    state.focusModel = null;
    renderBrushOrgsDrawer(selected, rows);
    openDrawer();
    renderAll();
  };

  overlay.addEventListener("mousedown", (event) => {
    start = { x: cx(event), y: cy(event) };
    box = rect(svg, start.x, start.y, 0, 0, "rgba(22,105,122,0.14)", 0);
    box.classList.add("brush-live");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    event.preventDefault();
  });
  overlay.addEventListener("dblclick", () => {
    if (state.brushOrgs) {
      state.brushOrgs = null;
      renderAll();
    }
  });
}

function renderBrushOrgsDrawer(orgs, rows) {
  els.drawerKicker.textContent = "机构对比";
  const picked = rows.filter((d) => orgs.has(d.organization || "unknown")).sort((a, b) => a.best_rank - b.best_rank);
  const totalVotes = picked.reduce((s, d) => s + (d.total_votes || 0), 0);
  const avgBest = picked.reduce((s, d) => s + d.best_rank, 0) / picked.length;
  const totalModels = picked.reduce((s, d) => s + (d.unique_models || 0), 0);

  els.drawerBody.innerHTML = `
    <div class="model-title">
      <strong>${picked.length} 家机构（框选）</strong>
      <span>${state.arena}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-metric"><strong>#${formatDecimal(avgBest)}</strong><span>平均最好名次</span></div>
      <div class="detail-metric"><strong>${formatNumber(totalModels)}</strong><span>合计模型</span></div>
      <div class="detail-metric wide"><strong>${formatNumber(totalVotes)}</strong><span>合计 Votes</span></div>
    </div>
    <div class="drawer-section-title">明细 <span>（点击聚焦单个机构）</span></div>
    <div class="mini-list">
      ${picked
        .map(
          (d) => `<button class="mini-row drill-org" data-org="${escapeHtml(d.organization || "unknown")}">
            <div><strong>${escapeHtml(d.organization || "unknown")}</strong><span>${formatNumber(
              d.unique_models,
            )} models</span></div>
            <span>#${formatRank(d.best_rank)} · ${formatDecimal(d.avg_rating)}</span>
          </button>`,
        )
        .join("")}
    </div>
  `;
  els.drawerBody.querySelectorAll(".drill-org").forEach((node) => {
    node.addEventListener("click", () => setFocusOrg(node.dataset.org));
  });
}

/* ============================================================
 * Shared helpers (unchanged from original demo)
 * ============================================================ */

function getFilteredLatestRows({ respectRank }) {
  let rows = data.latest.filter((d) => d.arena === state.arena && d.category === state.category);
  if (state.organization !== "all") {
    rows = rows.filter((d) => (d.organization || "unknown") === state.organization);
  }
  rows = rows.sort((a, b) => a.rank - b.rank);
  return respectRank ? rows.slice(0, state.rankLimit) : rows;
}

function latestNamesForEvolution(rows) {
  const latestDate = max(rows, (d) => new Date(d.leaderboard_publish_date).getTime());
  return rows
    .filter((d) => new Date(d.leaderboard_publish_date).getTime() === latestDate)
    .sort((a, b) => a.rank - b.rank)
    .map((d) => d.model_name);
}

function getCategoriesForArena(arena) {
  const summary = data.arenaSummary.find((d) => d.arena === arena);
  return summary?.categories?.length ? summary.categories : ["overall"];
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function fillSelect(select, values, current, labeler = (value) => value) {
  select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labeler(value))}</option>`).join("");
  select.value = current;
}

function setupSvg(svg) {
  return svg;
}

function setViewBox(svg, width, height) {
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // top-align content so a chart shorter than its (row-stretched) tile leaves
  // the slack at the bottom instead of letterboxing a gap above the title row
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  svg.style.minHeight = `${height}px`;
}

function clear(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function rect(svg, x, y, width, height, fill, radius = 0, opacity = 1) {
  const el = svgEl("rect", {
    x,
    y,
    width: Math.max(0, width),
    height: Math.max(0, height),
    rx: radius,
    ry: radius,
    fill,
    opacity,
  });
  svg.appendChild(el);
  return el;
}

function circle(svg, cx, cy, r, fill, stroke = "none", strokeWidth = 0, opacity = 1) {
  const el = svgEl("circle", { cx, cy, r, fill, stroke, "stroke-width": strokeWidth, opacity });
  svg.appendChild(el);
  return el;
}

function line(svg, x1, y1, x2, y2, className = "", stroke = null, strokeWidth = 1, linecap = "butt") {
  const el = svgEl("line", {
    x1,
    y1,
    x2,
    y2,
    class: className,
    stroke: stroke || undefined,
    "stroke-width": stroke ? strokeWidth : undefined,
    "stroke-linecap": linecap,
  });
  svg.appendChild(el);
  return el;
}

function path(svg, d, fill = "none", stroke = "currentColor", strokeWidth = 2) {
  const el = svgEl("path", {
    d,
    fill: fill || "none",
    stroke,
    "stroke-width": strokeWidth,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  });
  svg.appendChild(el);
  return el;
}

function text(svg, x, y, content, className = "", anchor = "start") {
  const el = svgEl("text", { x, y, class: className, "text-anchor": anchor });
  el.textContent = content;
  svg.appendChild(el);
  return el;
}

// Trim an already-rendered SVG <text> with an ellipsis until it fits maxWidth
// (px). Measures the real glyph width via getComputedTextLength, so it adapts
// to any font / zoom / name length instead of guessing a character count.
function fitText(el, maxWidth) {
  if (!el || maxWidth <= 0) return el;
  const full = el.textContent;
  if (el.getComputedTextLength() <= maxWidth) return el;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = `${full.slice(0, mid)}…`;
    if (el.getComputedTextLength() <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  el.textContent = lo > 0 ? `${full.slice(0, lo)}…` : "…";
  return el;
}

function svgEl(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) el.setAttribute(key, value);
  });
  return el;
}

function drawGrid(svg, margin, width, height, ticks) {
  const innerH = height - margin.top - margin.bottom;
  for (let i = 0; i <= ticks; i += 1) {
    const y = margin.top + (innerH / ticks) * i;
    line(svg, margin.left, y, width - margin.right, y, "grid-line");
  }
}

function drawYAxis(svg, margin, innerH, minValue, maxValue, ticks, formatter) {
  for (let i = 0; i <= ticks; i += 1) {
    const value = minValue + ((maxValue - minValue) / ticks) * i;
    const y = margin.top + innerH - (innerH / ticks) * i;
    text(svg, margin.left - 10, y + 4, formatter(value), "axis", "end");
  }
}

function drawXAxis(svg, margin, innerW, innerH, minValue, maxValue, ticks, formatter) {
  for (let i = 0; i <= ticks; i += 1) {
    const value = minValue + ((maxValue - minValue) / ticks) * i;
    const x = margin.left + (innerW / ticks) * i;
    line(svg, x, margin.top, x, margin.top + innerH, "grid-line");
    text(svg, x, margin.top + innerH + 23, formatter(value), "axis", "middle");
  }
}

function drawXScale(svg, margin, width, height, minValue, maxValue, ticks, formatter) {
  const innerW = width - margin.left - margin.right;
  const y1 = margin.top;
  const y2 = height - margin.bottom;
  for (let i = 0; i <= ticks; i += 1) {
    const value = minValue + ((maxValue - minValue) / ticks) * i;
    const x = margin.left + (innerW / ticks) * i;
    line(svg, x, y1, x, y2, "grid-line");
    text(svg, x, height - 14, formatter(value), "axis", "middle");
  }
}

function drawXAxisDates(svg, rows, margin, innerW, innerH, dateKey) {
  const dates = rows.map((d) => d[dateKey]);
  drawXAxisDateTicks(svg, dates, margin, innerW, innerH);
}

function drawXAxisDateTicks(svg, dates, margin, innerW, innerH) {
  const uniqueDates = unique(dates).sort();
  if (!uniqueDates.length) return;
  const minTime = new Date(uniqueDates[0]).getTime();
  const maxTime = new Date(uniqueDates[uniqueDates.length - 1]).getTime();
  const span = Math.max(1, maxTime - minTime);
  // Place ticks evenly in TIME (not by row index) so their x positions never
  // bunch up, then snap each target to the nearest real snapshot date.
  const target = clamp(Math.round(innerW / 110), 3, 6);
  const picks = [];
  for (let i = 0; i < target; i += 1) {
    const t = minTime + (span * i) / (target - 1);
    let nearest = uniqueDates[0];
    let best = Infinity;
    uniqueDates.forEach((dt) => {
      const diff = Math.abs(new Date(dt).getTime() - t);
      if (diff < best) {
        best = diff;
        nearest = dt;
      }
    });
    picks.push(nearest);
  }
  let lastX = -Infinity;
  unique(picks).forEach((date) => {
    const x = margin.left + scale(new Date(date).getTime(), minTime, maxTime, 0, innerW);
    if (x - lastX < 56) return; // drop a label that would collide with the previous
    lastX = x;
    line(svg, x, margin.top, x, margin.top + innerH, "grid-line");
    text(svg, x, margin.top + innerH + 26, shortDate(date), "axis", "middle");
  });
}

function drawAxisLabel(svg, x, y, content, className = "axis", anchor = "start") {
  text(svg, x, y, content, className, anchor);
}

function drawEmpty(svg, width, height, message) {
  text(svg, width / 2, height / 2, message, "axis", "middle");
}

function linePath(points) {
  return points
    .map((point, index) => {
      const [x, y] = point;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function showTooltip(event, html) {
  els.tooltip.innerHTML = html;
  els.tooltip.style.display = "block";
  const padding = 14;
  const rect = els.tooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - padding, event.clientX + 14);
  const top = Math.min(window.innerHeight - rect.height - padding, event.clientY + 14);
  els.tooltip.style.left = `${Math.max(padding, left)}px`;
  els.tooltip.style.top = `${Math.max(padding, top)}px`;
}

function hideTooltip() {
  els.tooltip.style.display = "none";
}

function getColor(key) {
  const normalized = key || "unknown";
  if (!colorCache.has(normalized)) {
    colorCache.set(normalized, palette[colorCache.size % palette.length]);
  }
  return colorCache.get(normalized);
}

function varColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Mix a hex color toward white by amt (0..1) -> "rgb(...)" string.
function lighten(hex, amt = 0.4) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// One reusable horizontal gradient def per color (org color -> lighter tip),
// created lazily inside the given svg's <defs>. Returns url(#id) for use as fill.
function barGradient(svg, color) {
  const id = `grad-${String(color).replace(/[^a-z0-9]/gi, "")}`;
  if (svg.querySelector(`#${id}`)) return `url(#${id})`;
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = svgEl("defs", {});
    svg.insertBefore(defs, svg.firstChild);
  }
  const grad = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0" });
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": color }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": lighten(color, 0.5) }));
  defs.appendChild(grad);
  return `url(#${id})`;
}

// Vertical gradient (color -> transparent) for area fills under a line.
function areaGradient(svg, color) {
  const id = `area-${String(color).replace(/[^a-z0-9]/gi, "")}`;
  if (svg.querySelector(`#${id}`)) return `url(#${id})`;
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = svgEl("defs", {});
    svg.insertBefore(defs, svg.firstChild);
  }
  const grad = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.32" }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }));
  defs.appendChild(grad);
  return `url(#${id})`;
}

function groupBy(rows, getter) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = getter(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function min(rows, getter) {
  return Math.min(...rows.map(getter).filter(Number.isFinite));
}

function max(rows, getter) {
  return Math.max(...rows.map(getter).filter(Number.isFinite));
}

function scale(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return (outMin + outMax) / 2;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function debounce(fn, delay) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

function yearTicks(startDate, endDate) {
  const start = new Date(startDate).getFullYear();
  const end = new Date(endDate).getFullYear();
  const ticks = [];
  for (let year = start; year <= end; year += 1) {
    ticks.push({ label: String(year), time: new Date(`${year}-01-01`).getTime() });
  }
  const endTime = new Date(endDate).getTime();
  if (!ticks.some((tick) => tick.time === endTime)) {
    ticks.push({ label: shortDate(endDate), time: endTime });
  }
  return ticks;
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return Math.round(Number(value)).toLocaleString("en-US");
}

function compactNumber(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
}

function formatDecimal(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatRank(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return Math.round(Number(value)).toLocaleString("en-US");
}

function shortDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function truncate(value, maxLength) {
  const textValue = String(value);
  if (textValue.length <= maxLength) return textValue;
  return `${textValue.slice(0, Math.max(1, maxLength - 1))}...`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
