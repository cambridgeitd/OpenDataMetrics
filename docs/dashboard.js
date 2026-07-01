const state = {
  data: null,
  metricId: "public_dataset_page_views",
  overviewMetricId: "public_dataset_page_views",
  assetsByUid: new Map(),
  snapshotWindowDays: 365,
  snapshotSortKey: "views",
  snapshotSortDir: "desc",
  snapshotDatasetPage: 1,
  snapshotDatasetFilter: "",
  snapshotCategoryFilter: "",
};

const SNAPSHOT_DATASET_PAGE_SIZE = 50;
const DEFAULT_TAB_ID = "snapshot";
const TIMELINE_TAB_ID = "timeline";
const TAB_QUERY_PARAM = "tab";
const TAB_ID_ALIASES = {
  overview: "snapshot",
  usage: "timeline",
  portfolio: "coverage",
};
const TIMELINE_QUERY_PARAMS = ["metric", "period", "range", "asset", "asset_uid", "dataset", "category", "keyword"];

const colors = ["#2274a5", "#2f8f5b", "#b7791f", "#7156a5", "#217c7e", "#b64040"];
// Strategic plan priority -> accent color. Mirrored in styles.css (--priority-N)
// and used for KPI card borders, timeline dropdown labels, and the About list.
const PRIORITY_COLORS = {
  1: "#2274a5",
  2: "#2f8f5b",
  3: "#b7791f",
  4: "#7156a5",
  5: "#217c7e",
  6: "#b64040",
};
const viewAccessTypes = new Set([
  "grid view",
  "measure page view",
  "primer page view",
  "story view",
  "visualization canvas view",
  "visualization page view",
]);
const accessMetricConfig = {
  public_dataset_page_views: { scope: "datasets", access: "views" },
  public_dataset_downloads: { scope: "datasets", access: "download" },
  public_dataset_api_reads: { scope: "datasets", access: "API read" },
  public_asset_views: { scope: "assets", access: "views" },
  public_asset_downloads: { scope: "assets", access: "download" },
  public_asset_api_reads: { scope: "assets", access: "API read" },
};
const hiddenTimelineMetricIds = new Set([
  "public_asset_views",
  "public_asset_downloads",
  "public_asset_api_reads",
  "catalog_searches",
  "distinct_catalog_search_terms",
  "referrer_visits",
]);

const formatNumber = (value, unit = "") => {
  if (value === "" || value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  const number = Number(value);
  const formatted = unit === "percent"
    ? `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
    : number.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return formatted;
};

const formatPeriod = (period, periodType = "month") => {
  if (!period) return "";
  const date = new Date(`${period}T00:00:00`);
  if (periodType === "year") return String(date.getUTCFullYear());
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
};

const formatPreciseNumber = (value, unit = "") => {
  if (value === "" || value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  const number = Number(value);
  const options = unit === "percent"
    ? { minimumFractionDigits: 0, maximumFractionDigits: 2 }
    : { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 2 };
  const suffix = unit === "percent" ? "%" : "";
  return `${number.toLocaleString(undefined, options)}${suffix}`;
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const definition = (metricId) => state.data.definitions.find((item) => item.metric_id === metricId) || {};

const priorityNumber = (priorityText) => {
  const match = /(\d+)/.exec(String(priorityText ?? ""));
  return match ? Number(match[1]) : null;
};
const priorityColor = (priorityText) => PRIORITY_COLORS[priorityNumber(priorityText)] || "";
const metricPriorityColor = (metricId) => priorityColor(definition(metricId).priority);
const topMetricIds = new Set(["public_datasets_cumulative"]);
const metricOrderKey = (metric, fallbackName = "") => {
  const topMetricKey = topMetricIds.has(metric.metric_id) ? "00" : "01";
  const priority = priorityNumber(metric.priority);
  const priorityKey = Number.isFinite(priority) ? String(priority).padStart(2, "0") : "99";
  return `${topMetricKey} ${priorityKey} ${metric.metric_name || fallbackName}`;
};
const compareMetricDefinitions = (a, b) => metricOrderKey(a).localeCompare(metricOrderKey(b));

const tabIds = () => new Set(Array.from(document.querySelectorAll(".tab-panel")).map((panel) => panel.id));

const canonicalTabId = (tabId) => {
  const candidate = String(tabId || "").trim().toLowerCase();
  const canonical = TAB_ID_ALIASES[candidate] || candidate;
  return tabIds().has(canonical) ? canonical : null;
};

const validTabId = (tabId) => canonicalTabId(tabId) || DEFAULT_TAB_ID;

const hasTimelineUrlState = (params) => TIMELINE_QUERY_PARAMS.some((param) => params.has(param));

function tabIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get(TAB_QUERY_PARAM);
  if (tabParam) return tabParam;
  const hashParam = window.location.hash.replace(/^#/, "");
  if (hashParam) return hashParam;
  return hasTimelineUrlState(params) ? TIMELINE_TAB_ID : "";
}

function updateTabUrl(tabId, replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set(TAB_QUERY_PARAM, tabId);
  if (canonicalTabId(url.hash.replace(/^#/, "")) === tabId) url.hash = "";
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ tab: tabId }, "", url);
}

function syncInitialTabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedTabId = tabIdFromUrl();
  const activeTabId = validTabId(requestedTabId);
  activateTab(activeTabId);
  if (requestedTabId && (requestedTabId.trim().toLowerCase() !== activeTabId || !params.has(TAB_QUERY_PARAM))) {
    updateTabUrl(activeTabId, true);
  }
}

function activateTab(tabId, options = {}) {
  const activeTabId = validTabId(tabId);
  document.querySelectorAll(".tab").forEach((button) => {
    const isActive = button.dataset.tab === activeTabId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const isActive = panel.id === activeTabId;
    panel.classList.toggle("is-active", isActive);
    panel.setAttribute("aria-hidden", String(!isActive));
  });
  if (options.updateUrl) updateTabUrl(activeTabId, options.replaceUrl);
}

const optionValueExists = (select, value) => Boolean(select && value && Array.from(select.options).some((option) => option.value === value && !option.disabled));

const urlParam = (params, name) => String(params.get(name) || "").trim();

function setOptionalParam(params, name, value) {
  const cleaned = String(value || "").trim();
  if (cleaned) {
    params.set(name, cleaned);
  } else {
    params.delete(name);
  }
}

function applyTimelineStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const metricSelect = document.querySelector("#metricSelect");
  const periodSelect = document.querySelector("#periodSelect");
  const rangeSelect = document.querySelector("#rangeSelect");
  if (!metricSelect || !periodSelect || !rangeSelect) return;

  const metricId = urlParam(params, "metric");
  if (optionValueExists(metricSelect, metricId)) metricSelect.value = metricId;

  const periodType = urlParam(params, "period").toLowerCase();
  if (optionValueExists(periodSelect, periodType)) periodSelect.value = periodType;

  const range = urlParam(params, "range").toLowerCase();
  if (optionValueExists(rangeSelect, range)) rangeSelect.value = range;

  const assetUid = urlParam(params, "asset_uid");
  const assetFromUid = assetUid ? state.assetsByUid.get(assetUid)?.name : "";
  document.querySelector("#assetFilter").value = assetFromUid || urlParam(params, "asset") || urlParam(params, "dataset");
  document.querySelector("#categoryFilter").value = urlParam(params, "category");
  document.querySelector("#keywordFilter").value = urlParam(params, "keyword");
}

function updateTimelineUrl(replace = true) {
  const metricSelect = document.querySelector("#metricSelect");
  const periodSelect = document.querySelector("#periodSelect");
  const rangeSelect = document.querySelector("#rangeSelect");
  if (!metricSelect || !periodSelect || !rangeSelect) return;

  const url = new URL(window.location.href);
  const params = url.searchParams;
  params.set(TAB_QUERY_PARAM, TIMELINE_TAB_ID);
  setOptionalParam(params, "metric", metricSelect.value);
  setOptionalParam(params, "period", periodSelect.value);
  setOptionalParam(params, "range", periodSelect.value === "year" ? "all" : rangeSelect.value);
  setOptionalParam(params, "asset", document.querySelector("#assetFilter").value);
  setOptionalParam(params, "category", document.querySelector("#categoryFilter").value);
  setOptionalParam(params, "keyword", document.querySelector("#keywordFilter").value);
  params.delete("asset_uid");
  params.delete("dataset");
  if (canonicalTabId(url.hash.replace(/^#/, "")) === TIMELINE_TAB_ID) url.hash = "";
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ tab: TIMELINE_TAB_ID }, "", url);
}

function normalizeTimelineUrlFromControls() {
  const params = new URLSearchParams(window.location.search);
  if (canonicalTabId(tabIdFromUrl()) === TIMELINE_TAB_ID && hasTimelineUrlState(params)) {
    updateTimelineUrl(true);
  }
}

function timelineHref(metricId, period = "month", range = "all") {
  const params = new URLSearchParams();
  params.set(TAB_QUERY_PARAM, TIMELINE_TAB_ID);
  params.set("metric", metricId);
  params.set("period", period);
  params.set("range", range);
  return `?${params.toString()}`;
}

const numericValue = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const numericRows = (rows) => rows
  .filter((row) => numericValue(row.value) !== null && row.dimension === "" && row.dimension_value === "")
  .map((row) => ({ ...row, value: numericValue(row.value) }))
  .sort((a, b) => a.period_start.localeCompare(b.period_start));

const movingAverage = (rows, windowSize = 3, periodType = "month") => {
  if (rows.length < windowSize) return [];
  return rows
    .map((row, index) => {
      if (index < windowSize - 1) return null;
      const windowRows = rows.slice(index - windowSize + 1, index + 1);
      const indexes = windowRows.map((item) => periodAxisIndex(item.period_start, periodType));
      const isConsecutive = indexes.every((item) => item !== null)
        && indexes.every((item, itemIndex) => itemIndex === 0 || item - indexes[itemIndex - 1] === 1);
      if (!isConsecutive) return null;
      const value = windowRows.reduce((sum, item) => sum + item.value, 0) / windowSize;
      return { ...row, value };
    })
    .filter(Boolean);
};

const latestMetricRow = (metricId, rows = state.data.metrics) => {
  const values = numericRows(rows.filter((row) => row.metric_id === metricId));
  return values.length ? values[values.length - 1] : null;
};

const latestMetricValue = (metricId, rows = state.data.metrics) => latestMetricRow(metricId, rows)?.value ?? null;

const metricHasData = (metricId) => numericRows([
  ...(state.data.monthly || []),
  ...(state.data.yearly || []),
  ...(state.data.snapshot || []),
].filter((row) => row.metric_id === metricId)).length > 0;

const isAccessMetric = (metricId) => Boolean(accessMetricConfig[metricId]);
const normalizeQuery = (value) => String(value || "").trim().toLowerCase();

const changeUnavailable = (text = "Snapshot only") => ({
  className: "is-neutral",
  percent: null,
  text,
});

function formatChange(current, previous, label) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return changeUnavailable("No baseline");
  if (previous === 0) {
    if (current === 0) return { className: "is-neutral", percent: 0, text: `0.0% ${label}` };
    return { className: "is-positive", percent: 100, text: `From 0 ${label}` };
  }
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const sign = percent > 0 ? "+" : "";
  const className = percent > 0 ? "is-positive" : percent < 0 ? "is-negative" : "is-neutral";
  return {
    className,
    percent,
    text: `${sign}${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% ${label}`,
  };
}

function colorForPercent(percent) {
  if (!Number.isFinite(percent)) return "";
  const clamped = Math.max(-100, Math.min(100, percent));
  const start = [255, 255, 255];
  const end = clamped < 0 ? [248, 218, 218] : [214, 239, 223];
  const magnitude = Math.abs(clamped);
  const t = magnitude === 0 ? 0 : Math.max(0.18, magnitude / 100);
  const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * t));
  return `rgb(${rgb.join(", ")})`;
}

function colorForScore(score) {
  if (!Number.isFinite(score)) return "";
  return colorForPercent((Math.max(0, Math.min(100, score)) - 50) * 2);
}

function pointChange(metricId, offsets = [
  { size: 12, label: "vs 12 mo ago" },
  { size: 3, label: "vs 3 mo ago" },
  { size: 1, label: "vs last month" },
]) {
  const values = numericRows(state.data.monthly.filter((row) => row.metric_id === metricId));
  const current = values[values.length - 1];
  const currentIndex = periodMonthIndex(current?.period_start);
  if (!current || currentIndex === null) return changeUnavailable("No baseline");
  for (const offset of offsets) {
    const previous = values.find((row) => periodMonthIndex(row.period_start) === currentIndex - offset.size);
    if (previous) return formatChange(current.value, previous.value, offset.label);
  }
  return changeUnavailable("No baseline");
}

function snapshotPointChange(metricId, days) {
  const defaults = [
    { size: 12, label: "vs 12 mo ago" },
    { size: 3, label: "vs 3 mo ago" },
    { size: 1, label: "vs last month" },
  ];
  const preferred = {
    365: defaults[0],
    90: defaults[1],
    30: defaults[2],
  }[days];
  if (!preferred) return pointChange(metricId, defaults);
  return pointChange(metricId, [
    preferred,
    ...defaults.filter((offset) => offset.size !== preferred.size),
  ]);
}

function monthWindowSize(days) {
  if (days === 365) return 12;
  if (days === 90) return 3;
  if (days === 30) return 1;
  return Math.max(1, Math.round(days / 30));
}

function periodMonthIndex(period) {
  const [year, month] = String(period || "").slice(0, 7).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return year * 12 + month - 1;
}

function periodAxisIndex(period, periodType = "month") {
  if (periodType === "year") {
    const year = Number(String(period || "").slice(0, 4));
    return Number.isFinite(year) ? year : null;
  }
  return periodMonthIndex(period);
}

function latestMonthlyIndex() {
  let latest = -Infinity;
  for (const row of state.data.monthly) {
    if (numericValue(row.value) === null) continue;
    const index = periodMonthIndex(row.period_start);
    if (index !== null && index > latest) latest = index;
  }
  return Number.isFinite(latest) ? latest : null;
}

function metricWindowTotals(metricId, days) {
  const windowSize = monthWindowSize(days);
  const latest = latestMonthlyIndex();
  const totals = { current: 0, previous: 0 };
  if (latest === null) return totals;
  const currentStart = latest - windowSize + 1;
  const previousStart = currentStart - windowSize;
  const values = state.data.monthly
    .filter((row) => row.metric_id === metricId && row.dimension === "" && row.dimension_value === "");
  for (const row of values) {
    const value = numericValue(row.value);
    const index = periodMonthIndex(row.period_start);
    if (value === null || index === null) continue;
    if (index >= currentStart && index <= latest) {
      totals.current += value;
    } else if (index >= previousStart && index < currentStart) {
      totals.previous += value;
    }
  }
  return totals;
}

function metricWindowLatestChange(metricId, days, label) {
  const windowSize = monthWindowSize(days);
  const latest = latestMonthlyIndex();
  if (latest === null) return changeUnavailable(`No prior ${windowLabel(days)}`);
  const currentStart = latest - windowSize + 1;
  const previousStart = currentStart - windowSize;
  const values = numericRows(state.data.monthly.filter((row) => row.metric_id === metricId));
  const current = values
    .filter((row) => {
      const index = periodMonthIndex(row.period_start);
      return index !== null && index >= currentStart && index <= latest;
    })
    .at(-1);
  const previous = values
    .filter((row) => {
      const index = periodMonthIndex(row.period_start);
      return index !== null && index >= previousStart && index < currentStart;
    })
    .at(-1);
  if (!current || !previous) return changeUnavailable(`No prior ${windowLabel(days)}`);
  return formatChange(current.value, previous.value, label);
}

function ensureTooltip() {
  let tooltip = document.querySelector("#chartTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "chartTooltip";
    tooltip.className = "chart-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function moveTooltip(event, anchor = null) {
  const tooltip = ensureTooltip();
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  const anchorRect = anchor ? anchor.getBoundingClientRect() : null;
  const clientX = Number.isFinite(event.clientX) ? event.clientX : (anchorRect ? anchorRect.left + anchorRect.width / 2 : 20);
  const clientY = Number.isFinite(event.clientY) ? event.clientY : (anchorRect ? anchorRect.top + anchorRect.height / 2 : 20);
  let left = clientX + offset;
  let top = clientY + offset;
  if (left + rect.width > window.innerWidth - 12) left = clientX - rect.width - offset;
  if (top + rect.height > window.innerHeight - 12) top = clientY - rect.height - offset;
  tooltip.style.left = `${Math.max(12, left)}px`;
  tooltip.style.top = `${Math.max(12, top)}px`;
}

function showTooltip(event, target) {
  const tooltip = ensureTooltip();
  tooltip.innerHTML = `
    <div class="tooltip-kicker">${escapeHtml(target.dataset.period)}</div>
    <div class="tooltip-title">${escapeHtml(target.dataset.metric)}</div>
    <div class="tooltip-row">
      <span>${escapeHtml(target.dataset.series)}</span>
      <strong>${escapeHtml(target.dataset.value)}</strong>
    </div>
  `;
  tooltip.classList.add("is-visible");
  moveTooltip(event, target);
}

function hideTooltip() {
  const tooltip = ensureTooltip();
  tooltip.classList.remove("is-visible");
}

function bindChartTooltips(container) {
  container.querySelectorAll(".tooltip-target").forEach((target) => {
    target.addEventListener("mouseenter", (event) => showTooltip(event, target));
    target.addEventListener("mousemove", moveTooltip);
    target.addEventListener("mouseleave", hideTooltip);
    target.addEventListener("focus", (event) => showTooltip(event, target));
    target.addEventListener("blur", hideTooltip);
  });
}

function setGeneratedAt() {
  const generated = new Date(state.data.generatedAt);
  document.querySelector("#generatedAt").textContent = `Updated ${generated.toLocaleString()}`;
}

function buildKpis() {
  const summary = state.data.summary;
  const activityTotals = buildSnapshotActivityTotals(state.snapshotWindowDays);
  const activityWindowText = windowLabel(state.snapshotWindowDays);
  const activityNote = `Latest ${activityWindowText}`;
  const activityChangeLabel = `vs prior ${activityWindowText}`;
  const createdDatasets = metricWindowTotals("public_datasets_created", state.snapshotWindowDays);
  const programEvents = metricWindowTotals("program_events", state.snapshotWindowDays);
  const eventAttendance = metricWindowTotals("program_event_attendance", state.snapshotWindowDays);
  const newsletterSubscriberRow = latestMetricRow("newsletter_subscribers", state.data.monthly);
  const cards = [
    {
      label: "Total Public Catalog Datasets",
      value: summary.totalPublicDatasets,
      note: `${summary.hiddenPublicDatasets} public-readable hidden tables excluded`,
      change: snapshotPointChange("public_datasets_cumulative", state.snapshotWindowDays),
      timelineMetric: "public_datasets_cumulative",
    },
    {
      label: "New Public Catalog Datasets",
      value: createdDatasets.current,
      note: activityNote,
      change: formatChange(createdDatasets.current, createdDatasets.previous, activityChangeLabel),
      timelineMetric: "public_datasets_created",
    },
    {
      label: "Program Events",
      value: programEvents.current,
      note: "Workshops, outreach, and staff trainings",
      change: formatChange(programEvents.current, programEvents.previous, activityChangeLabel),
      timelineMetric: "program_events",
    },
    {
      label: "Event Attendance",
      value: eventAttendance.current,
      note: "Actual attendees captured in event tracker",
      change: formatChange(eventAttendance.current, eventAttendance.previous, activityChangeLabel),
      timelineMetric: "program_event_attendance",
    },
    {
      label: "Newsletter Subscribers",
      value: newsletterSubscriberRow?.value,
      note: newsletterSubscriberRow ? `Latest count, ${formatPeriod(newsletterSubscriberRow.period_start)}` : "Manual newsletter platform count",
      change: metricWindowLatestChange("newsletter_subscribers", state.snapshotWindowDays, activityChangeLabel),
      timelineMetric: "newsletter_subscribers",
    },
    {
      label: "Dataset Views",
      value: activityTotals.views,
      note: activityNote,
      change: formatChange(activityTotals.views, activityTotals.previousViews, activityChangeLabel),
      timelineMetric: "public_dataset_page_views",
    },
    {
      label: "Dataset Downloads",
      value: activityTotals.downloads,
      note: activityNote,
      change: formatChange(activityTotals.downloads, activityTotals.previousDownloads, activityChangeLabel),
      timelineMetric: "public_dataset_downloads",
    },
    {
      label: "Dataset API Reads",
      value: activityTotals.api_reads,
      note: activityNote,
      change: formatChange(activityTotals.api_reads, activityTotals.previousApiReads, activityChangeLabel),
      timelineMetric: "public_dataset_api_reads",
    },
    {
      label: "Fresh On Schedule",
      value: summary.freshnessPercent,
      unit: "percent",
      note: `${summary.freshScheduledDatasets} of ${summary.scheduledDatasets} scheduled datasets`,
      change: changeUnavailable(),
      score: summary.freshnessPercent,
      priorityMetric: "dataset_freshness_pct",
    },
    {
      label: "PDDL Licensed",
      value: summary.pddlPercent,
      unit: "percent",
      note: `${summary.pddlDatasets} datasets`,
      change: changeUnavailable(),
      score: summary.pddlPercent,
      priorityMetric: "datasets_with_pddl_license_pct",
    },
  ];
  const orderedCards = cards.sort((a, b) => {
    const aMetric = definition(a.timelineMetric || a.priorityMetric);
    const bMetric = definition(b.timelineMetric || b.priorityMetric);
    return metricOrderKey(aMetric, a.label).localeCompare(metricOrderKey(bMetric, b.label));
  });

  document.querySelector("#kpiGrid").innerHTML = orderedCards.map((card) => {
    const background = card.score === undefined
      ? colorForPercent(card.change.percent)
      : colorForScore(card.score);
    const accent = metricPriorityColor(card.timelineMetric || card.priorityMetric);
    const styleParts = [];
    if (accent) styleParts.push(`--kpi-accent: ${accent}`);
    if (background) styleParts.push(`--kpi-bg: ${background}`);
    const style = styleParts.length ? ` style="${styleParts.join("; ")};"` : "";
    const tagName = card.timelineMetric ? "a" : "article";
    const href = card.timelineMetric ? ` href="${escapeHtml(timelineHref(card.timelineMetric))}" aria-label="Open ${escapeHtml(card.label)} in the timeline"` : "";
    return `
      <${tagName} class="kpi${card.timelineMetric ? " kpi-link" : ""}"${href}${style}>
        <div class="label">${card.label}</div>
        <div class="value">${formatNumber(card.value, card.unit)}</div>
        <div class="change ${card.change.className}">${card.change.text}</div>
        <div class="note">${card.note}</div>
      </${tagName}>
    `;
  }).join("");
}

function formatActivityChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { text: "n/a", percent: null };
  if (previous === 0) {
    if (current === 0) return { text: "0.0%", percent: 0 };
    return { text: "from 0", percent: 100 };
  }
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const sign = percent > 0 ? "+" : "";
  return {
    text: `${sign}${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
    percent,
  };
}

function windowLabel(days) {
  if (days === 365) return "12 months";
  if (days === 90) return "90 days";
  if (days === 30) return "30 days";
  return `${days} days`;
}

function snapshotWindowBounds(days) {
  let latestTime = -Infinity;
  for (const row of state.data.datasetDailyActivity) {
    const time = Date.parse(`${row.day}T00:00:00Z`);
    if (time > latestTime) latestTime = time;
  }
  if (!Number.isFinite(latestTime)) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = latestTime - (days - 1) * dayMs;
  const previousStart = currentStart - days * dayMs;
  return { currentStart, latestTime, previousStart };
}

function publicDatasetUidSet() {
  return new Set(
    state.data.assets
      .filter((asset) => asset.is_public_discoverable_dataset)
      .map((asset) => asset.uid)
  );
}

function buildSnapshotActivityTotals(days) {
  const bounds = snapshotWindowBounds(days);
  const datasetUids = publicDatasetUidSet();
  const totals = {
    views: 0,
    previousViews: 0,
    downloads: 0,
    previousDownloads: 0,
    api_reads: 0,
    previousApiReads: 0,
  };
  if (!bounds) return totals;

  for (const activity of state.data.datasetDailyActivity) {
    if (!datasetUids.has(activity.asset_uid)) continue;
    const time = Date.parse(`${activity.day}T00:00:00Z`);
    const isCurrent = time >= bounds.currentStart && time <= bounds.latestTime;
    const isPrevious = time >= bounds.previousStart && time < bounds.currentStart;
    if (!isCurrent && !isPrevious) continue;
    if (isCurrent) {
      totals.views += Number(activity.views || 0);
      totals.downloads += Number(activity.downloads || 0);
      totals.api_reads += Number(activity.api_reads || 0);
    } else {
      totals.previousViews += Number(activity.views || 0);
      totals.previousDownloads += Number(activity.downloads || 0);
      totals.previousApiReads += Number(activity.api_reads || 0);
    }
  }

  return totals;
}

function addDatasetActivityChanges(row) {
  const viewsChange = formatActivityChange(row.views, row.previousViews);
  const downloadsChange = formatActivityChange(row.downloads, row.previousDownloads);
  const apiChange = formatActivityChange(row.api_reads, row.previousApiReads);
  return {
    ...row,
    viewsChange,
    downloadsChange,
    apiChange,
    total: row.views + row.downloads + row.api_reads,
  };
}

function buildDatasetActivityRows(days) {
  const datasetAssets = state.data.assets
    .filter((asset) => asset.is_public_discoverable_dataset)
    .sort((a, b) => a.name.localeCompare(b.name));
  const bounds = snapshotWindowBounds(days);
  const rowsByUid = new Map(datasetAssets.map((asset) => [asset.uid, {
    uid: asset.uid,
    name: asset.name,
    category: asset.category,
    url: asset.url,
    views: 0,
    previousViews: 0,
    downloads: 0,
    previousDownloads: 0,
    api_reads: 0,
    previousApiReads: 0,
  }]));
  if (!bounds) return [...rowsByUid.values()].map(addDatasetActivityChanges);

  for (const activity of state.data.datasetDailyActivity) {
    const row = rowsByUid.get(activity.asset_uid);
    if (!row) continue;
    const time = Date.parse(`${activity.day}T00:00:00Z`);
    const isCurrent = time >= bounds.currentStart && time <= bounds.latestTime;
    const isPrevious = time >= bounds.previousStart && time < bounds.currentStart;
    if (!isCurrent && !isPrevious) continue;
    const targetPrefix = isCurrent ? "" : "previous";
    if (targetPrefix) {
      row.previousViews += Number(activity.views || 0);
      row.previousDownloads += Number(activity.downloads || 0);
      row.previousApiReads += Number(activity.api_reads || 0);
    } else {
      row.views += Number(activity.views || 0);
      row.downloads += Number(activity.downloads || 0);
      row.api_reads += Number(activity.api_reads || 0);
    }
  }

  return [...rowsByUid.values()].map(addDatasetActivityChanges);
}

function sortDatasetActivityRows(rows) {
  const key = state.snapshotSortKey;
  const direction = state.snapshotSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let left;
    let right;
    if (key === "name" || key === "category") {
      left = a[key] || "";
      right = b[key] || "";
      return left.localeCompare(right) * direction;
    }
    if (key === "viewsChange") {
      left = a.viewsChange.percent ?? -Infinity;
      right = b.viewsChange.percent ?? -Infinity;
    } else if (key === "downloadsChange") {
      left = a.downloadsChange.percent ?? -Infinity;
      right = b.downloadsChange.percent ?? -Infinity;
    } else if (key === "apiChange") {
      left = a.apiChange.percent ?? -Infinity;
      right = b.apiChange.percent ?? -Infinity;
    } else {
      left = a[key] || 0;
      right = b[key] || 0;
    }
    return (left - right) * direction;
  });
}

function sortIndicator(key) {
  if (state.snapshotSortKey !== key) return "";
  return state.snapshotSortDir === "asc" ? " ↑" : " ↓";
}

function changeCell(change) {
  const background = colorForPercent(change.percent);
  return `<td class="change-cell" style="${background ? `background:${background};` : ""}">${escapeHtml(change.text)}</td>`;
}

function filterDatasetActivityRows(rows) {
  const datasetQuery = state.snapshotDatasetFilter.trim().toLowerCase();
  const categoryQuery = state.snapshotCategoryFilter;
  if (!datasetQuery && !categoryQuery) return rows;
  return rows.filter((row) => {
    const matchesName = !datasetQuery || row.name.toLowerCase().includes(datasetQuery);
    const matchesCategory = !categoryQuery || (row.category || "Uncategorized") === categoryQuery;
    return matchesName && matchesCategory;
  });
}

function renderSnapshotDatasetTable() {
  const table = document.querySelector("#snapshotDatasetTable");
  if (!table) return;
  const allRows = sortDatasetActivityRows(buildDatasetActivityRows(state.snapshotWindowDays));
  const rows = filterDatasetActivityRows(allRows);
  const hasFilter = Boolean(state.snapshotDatasetFilter.trim() || state.snapshotCategoryFilter);
  const pageCount = Math.max(1, Math.ceil(rows.length / SNAPSHOT_DATASET_PAGE_SIZE));
  state.snapshotDatasetPage = Math.min(Math.max(1, state.snapshotDatasetPage), pageCount);
  const startIndex = (state.snapshotDatasetPage - 1) * SNAPSHOT_DATASET_PAGE_SIZE;
  const shownRows = rows.slice(startIndex, startIndex + SNAPSHOT_DATASET_PAGE_SIZE);
  const note = document.querySelector("#datasetActivityNote");
  const rangeStart = rows.length ? startIndex + 1 : 0;
  const rangeEnd = startIndex + shownRows.length;
  note.textContent = rows.length
    ? `Showing ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} of ${rows.length.toLocaleString()}${hasFilter ? " matching" : ""} public catalog datasets${hasFilter ? ` (of ${allRows.length.toLocaleString()} total)` : ""} for the latest ${windowLabel(state.snapshotWindowDays)}, compared with the immediately preceding ${windowLabel(state.snapshotWindowDays)}. Click a column header to sort.`
    : (hasFilter ? "No public catalog datasets match the current filters." : "No public catalog datasets are available in the current snapshot.");
  table.innerHTML = `
    <thead>
      <tr>
        <th class="sortable" data-sort="name">Dataset${sortIndicator("name")}</th>
        <th class="sortable" data-sort="category">Category${sortIndicator("category")}</th>
        <th class="sortable" data-sort="views">Views${sortIndicator("views")}</th>
        <th class="sortable" data-sort="viewsChange">Views Δ${sortIndicator("viewsChange")}</th>
        <th class="sortable" data-sort="downloads">Downloads${sortIndicator("downloads")}</th>
        <th class="sortable" data-sort="downloadsChange">Downloads Δ${sortIndicator("downloadsChange")}</th>
        <th class="sortable" data-sort="api_reads">API Reads${sortIndicator("api_reads")}</th>
        <th class="sortable" data-sort="apiChange">API Δ${sortIndicator("apiChange")}</th>
      </tr>
    </thead>
    <tbody>
      ${shownRows.length ? shownRows.map((row) => `
        <tr>
          <td class="dataset-name"><a href="${row.url}" target="_blank" rel="noreferrer">${escapeHtml(row.name)}</a></td>
          <td class="dataset-category">${escapeHtml(row.category || "Uncategorized")}</td>
          <td class="metric-cell">${formatNumber(row.views)}</td>
          ${changeCell(row.viewsChange)}
          <td class="metric-cell">${formatNumber(row.downloads)}</td>
          ${changeCell(row.downloadsChange)}
          <td class="metric-cell">${formatNumber(row.api_reads)}</td>
          ${changeCell(row.apiChange)}
        </tr>
      `).join("") : `<tr><td colspan="8">${hasFilter ? "No public catalog datasets match the current filters." : "No public catalog datasets are available."}</td></tr>`}
    </tbody>
  `;
  renderSnapshotDatasetPagination(rows.length, pageCount);
}

function renderSnapshotDatasetPagination(totalRows, pageCount) {
  const pagination = document.querySelector("#snapshotDatasetPagination");
  if (!pagination) return;
  if (totalRows <= SNAPSHOT_DATASET_PAGE_SIZE) {
    pagination.innerHTML = "";
    return;
  }
  const page = state.snapshotDatasetPage;
  pagination.innerHTML = `
    <button class="pagination-button" type="button" data-page="${page - 1}"${page === 1 ? " disabled" : ""}>Previous</button>
    <span class="pagination-status">Page ${page.toLocaleString()} of ${pageCount.toLocaleString()}</span>
    <button class="pagination-button" type="button" data-page="${page + 1}"${page === pageCount ? " disabled" : ""}>Next</button>
  `;
}

function populateSnapshotFilters() {
  const datasets = state.data.assets
    .filter((asset) => asset.is_public_discoverable_dataset)
    .sort((a, b) => a.name.localeCompare(b.name));
  const datalist = document.querySelector("#snapshotDatasetOptions");
  if (datalist) {
    datalist.innerHTML = datasets
      .map((asset) => `<option value="${escapeHtml(asset.name)}"></option>`)
      .join("");
  }
  const categories = [...new Set(datasets.map((asset) => asset.category || "Uncategorized"))]
    .sort((a, b) => a.localeCompare(b));
  const select = document.querySelector("#snapshotCategoryFilter");
  if (select) {
    select.innerHTML = `<option value="">All categories</option>`
      + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  }
}

function renderSnapshot() {
  buildKpis();
  renderSnapshotDatasetTable();
}

function populateMetricSelects() {
  const monthlyDefs = state.data.definitions
    .filter((item) => item.period_type === "month")
    .filter((item) => !hiddenTimelineMetricIds.has(item.metric_id))
    .sort(compareMetricDefinitions);

  const optionHtml = monthlyDefs.map((item) => {
    const hasData = metricHasData(item.metric_id);
    const unavailableLabel = hasData ? "" : " (No data yet)";
    const disabled = hasData ? "" : " disabled";
    const accent = priorityColor(item.priority);
    const colorStyle = hasData && accent ? ` style="color: ${accent};"` : "";
    return `
      <option value="${item.metric_id}"${disabled}${colorStyle}>${item.priority}: ${item.metric_name}${unavailableLabel}</option>
    `;
  }).join("");

  for (const selector of ["#metricSelect", "#overviewMetric"]) {
    const select = document.querySelector(selector);
    if (!select) continue;
    select.innerHTML = optionHtml;
    const selectedMetricId = selector === "#metricSelect" ? state.metricId : state.overviewMetricId;
    const selectedOption = Array.from(select.options).find((option) => option.value === selectedMetricId && !option.disabled);
    const fallbackOption = Array.from(select.options).find((option) => !option.disabled);
    select.value = selectedOption?.value || fallbackOption?.value || "";
  }
  state.metricId = document.querySelector("#metricSelect")?.value || state.metricId;
  state.overviewMetricId = document.querySelector("#overviewMetric")?.value || state.overviewMetricId;
}

function getUsageFilters() {
  return {
    asset: normalizeQuery(document.querySelector("#assetFilter")?.value),
    category: normalizeQuery(document.querySelector("#categoryFilter")?.value),
    keyword: normalizeQuery(document.querySelector("#keywordFilter")?.value),
  };
}

function assetInMetricScope(asset, metricId) {
  const config = accessMetricConfig[metricId];
  return config?.scope === "datasets" ? asset?.is_public_discoverable_dataset : Boolean(asset);
}

function assetMatchesFilters(asset, metricId, filters) {
  if (!assetInMetricScope(asset, metricId)) return false;
  if (filters.asset) {
    const assetText = `${asset.name || ""} ${asset.uid || ""}`.toLowerCase();
    if (!assetText.includes(filters.asset)) return false;
  }
  if (filters.category && !normalizeQuery(asset.category).includes(filters.category)) return false;
  if (filters.keyword && !(asset.keywords || []).some((keyword) => normalizeQuery(keyword).includes(filters.keyword))) return false;
  return true;
}

function accessTypeMatches(row, metricId) {
  const config = accessMetricConfig[metricId];
  if (!config) return false;
  if (config.access === "views") return viewAccessTypes.has(row.access_type);
  return row.access_type === config.access;
}

function aggregateAccessSeries(metricId, periodType, filters) {
  const grouped = new Map();
  for (const row of state.data.accessByType) {
    if (!accessTypeMatches(row, metricId)) continue;
    const asset = state.assetsByUid.get(row.asset_uid);
    if (!assetMatchesFilters(asset, metricId, filters)) continue;
    const period = periodType === "year" ? `${row.period_start.slice(0, 4)}-01-01` : row.period_start;
    grouped.set(period, (grouped.get(period) || 0) + Number(row.value || 0));
  }
  return [...grouped.entries()]
    .map(([period_start, value]) => ({ metric_id: metricId, period_type: periodType, period_start, value }))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
}

function buildUsageFilterOptions(metricId) {
  const filters = getUsageFilters();
  const filterable = isAccessMetric(metricId);
  const controls = document.querySelector("#usageFilters");
  const note = document.querySelector("#usageFilterNote");
  const filterControls = ["#assetFilter", "#categoryFilter", "#keywordFilter", "#clearUsageFilters"].map((selector) => document.querySelector(selector));

  if (!filterable) {
    controls.classList.add("is-disabled");
    filterControls.forEach((control) => { control.disabled = true; });
    note.textContent = "Asset filters apply to Socrata Asset Access metrics such as views, downloads, and API reads.";
    return;
  }

  controls.classList.remove("is-disabled");
  filterControls.forEach((control) => { control.disabled = false; });

  const scopedAssets = state.data.assets
    .filter((asset) => assetInMetricScope(asset, metricId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const categoryOptions = [...new Set(scopedAssets.map((asset) => asset.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const keywordOptions = [...new Set(scopedAssets.flatMap((asset) => asset.keywords || []))].sort((a, b) => a.localeCompare(b));

  document.querySelector("#assetOptions").innerHTML = scopedAssets
    .map((asset) => `<option value="${escapeHtml(asset.name)}"></option>`)
    .join("");
  document.querySelector("#categoryOptions").innerHTML = categoryOptions
    .map((category) => `<option value="${escapeHtml(category)}"></option>`)
    .join("");
  document.querySelector("#keywordOptions").innerHTML = keywordOptions
    .map((keyword) => `<option value="${escapeHtml(keyword)}"></option>`)
    .join("");

  const filteredCount = scopedAssets.filter((asset) => assetMatchesFilters(asset, metricId, filters)).length;
  const scopeLabel = accessMetricConfig[metricId].scope === "datasets" ? "datasets" : "assets";
  const activeFilters = [filters.asset, filters.category, filters.keyword].filter(Boolean).length;
  note.textContent = activeFilters
    ? `${filteredCount.toLocaleString()} ${scopeLabel} match the current text filters.`
    : `${filteredCount.toLocaleString()} ${scopeLabel} included. Type in any filter box to narrow the chart.`;
}

function filteredSeries(metricId, periodType, range, filters = null) {
  if (filters && isAccessMetric(metricId)) {
    let values = aggregateAccessSeries(metricId, periodType, filters);
    if (range !== "all") values = values.slice(-Number(range));
    return values;
  }
  const rows = periodType === "year" ? state.data.yearly : state.data.monthly;
  let values = numericRows(rows.filter((row) => row.metric_id === metricId && row.period_type === periodType));
  if (range !== "all") values = values.slice(-Number(range));
  return values;
}

function renderLineChart(target, rows, metricId, periodType = "month", options = {}) {
  const container = document.querySelector(target);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">No captured values for this metric.</div>`;
    return;
  }

  const showMovingAverage = options.showMovingAverage ?? true;
  const movingRows = showMovingAverage ? movingAverage(rows, 3, periodType) : [];
  const movingLabel = periodType === "year" ? "3-year moving avg" : "3-month moving avg";
  const width = 980;
  const height = container.classList.contains("tall") ? 390 : 300;
  const margin = { top: 18, right: 24, bottom: 44, left: 72 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const minValue = Math.min(...rows.map((row) => row.value), 0);
  const span = maxValue - minValue || 1;
  const axisIndexes = rows
    .map((row) => periodAxisIndex(row.period_start, periodType))
    .filter((index) => index !== null);
  const minAxis = axisIndexes.length ? Math.min(...axisIndexes) : 0;
  const maxAxis = axisIndexes.length ? Math.max(...axisIndexes) : 0;
  const x = (row) => {
    const axisIndex = periodAxisIndex(row.period_start, periodType);
    if (axisIndex === null || minAxis === maxAxis) return margin.left + innerWidth / 2;
    return margin.left + ((axisIndex - minAxis) / (maxAxis - minAxis)) * innerWidth;
  };
  const y = (value) => margin.top + innerHeight - ((value - minValue) / span) * innerHeight;
  const linePath = (lineRows) => lineRows.map((row, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command} ${x(row).toFixed(1)} ${y(row.value).toFixed(1)}`;
  }).join(" ");
  const path = linePath(rows);
  const movingPath = linePath(movingRows);
  const ticks = Array.from({ length: 5 }, (_, index) => minValue + (span * index) / 4);
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));
  const def = definition(metricId);
  const metricName = escapeHtml(def.metric_name || metricId);

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${def.metric_name || metricId}">
      ${ticks.map((tick) => {
        const yy = y(tick);
        return `
          <line class="grid-line" x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}"></line>
          <text class="chart-label" x="${margin.left - 10}" y="${yy + 4}" text-anchor="end">${formatNumber(tick, def.unit)}</text>
        `;
      }).join("")}
      <path class="line-path" d="${path}" stroke="${colors[0]}"></path>
      ${movingRows.length ? `<path class="moving-average-path" d="${movingPath}"></path>` : ""}
      ${rows.map((row, index) => `
        <circle class="point" cx="${x(row)}" cy="${y(row.value)}" r="3.2">
        </circle>
        <circle class="tooltip-target" cx="${x(row)}" cy="${y(row.value)}" r="9"
          tabindex="0"
          data-period="${escapeHtml(formatPeriod(row.period_start, periodType))}"
          data-metric="${metricName}"
          data-series="Actual"
          data-value="${escapeHtml(formatPreciseNumber(row.value, def.unit))}">
        </circle>
      `).join("")}
      ${movingRows.map((row) => `
        <circle class="moving-average-point" cx="${x(row)}" cy="${y(row.value)}" r="2.5">
        </circle>
        <circle class="tooltip-target" cx="${x(row)}" cy="${y(row.value)}" r="9"
          tabindex="0"
          data-period="${escapeHtml(formatPeriod(row.period_start, periodType))}"
          data-metric="${metricName}"
          data-series="${escapeHtml(movingLabel)}"
          data-value="${escapeHtml(formatPreciseNumber(row.value, def.unit))}">
        </circle>
      `).join("")}
      ${rows.map((row, index) => index % labelStep === 0 || index === rows.length - 1 ? `
        <text class="chart-label" x="${x(row)}" y="${height - 15}" text-anchor="middle">${formatPeriod(row.period_start, periodType)}</text>
      ` : "").join("")}
      <text class="chart-label" x="${margin.left}" y="14">${def.unit || ""}</text>
      <g class="chart-legend" transform="translate(${width - margin.right - 250}, 9)">
        <line x1="0" y1="0" x2="22" y2="0" class="legend-line-actual"></line>
        <text x="28" y="4">Actual</text>
        ${movingRows.length ? `
          <line x1="92" y1="0" x2="114" y2="0" class="legend-line-average"></line>
          <text x="120" y="4">${movingLabel}</text>
        ` : ""}
      </g>
    </svg>
  `;
  bindChartTooltips(container);
}

function updateExplorer(options = {}) {
  const metricId = document.querySelector("#metricSelect").value;
  const periodType = document.querySelector("#periodSelect").value;
  const rangeSelect = document.querySelector("#rangeSelect");
  if (periodType === "year") rangeSelect.value = "all";
  const range = periodType === "year" ? "all" : rangeSelect.value;
  state.metricId = metricId;
  buildUsageFilterOptions(metricId);
  const rows = filteredSeries(metricId, periodType, range, getUsageFilters());
  renderLineChart("#metricChart", rows, metricId, periodType, {
    showMovingAverage: document.querySelector("#movingAverageToggle")?.checked ?? true,
  });
  if (options.updateUrl) updateTimelineUrl(options.replaceUrl ?? true);
}

function updateOverviewTrend() {
  const metricId = document.querySelector("#overviewMetric").value;
  const range = document.querySelector("#overviewRange").value;
  const rows = filteredSeries(metricId, "month", range);
  renderLineChart("#overviewChart", rows, metricId, "month");
}

function renderWatchlist() {
  const summary = state.data.summary;
  const items = [
    {
      title: "Usage history starts in February 2020",
      body: "Current Socrata system analytics are available through the API from 2020-02 onward. Earlier traffic appears to require the legacy admin export path.",
    },
    {
      title: "Department metadata is mostly missing",
      body: `${summary.departmentMetadataDatasets} of ${summary.totalPublicDatasets} Public Catalog Datasets have the structured Maintenance Plan department field populated.`,
    },
    {
      title: "Classes and trainings were not loaded",
      body: "No non-template files were found under input/manual. The dashboard has templates for workshop, training, CDAG, and manual metrics.",
    },
    {
      title: "Privacy documentation is sparse",
      body: `${summary.privacyNotesDatasets} Public Catalog Datasets have explicit privacy or geomasking notes in the structured metadata field.`,
    },
  ];
  document.querySelector("#watchlist").innerHTML = items.map((item) => `
    <div class="watch-item">
      <strong>${item.title}</strong>
      <span>${item.body}</span>
    </div>
  `).join("");
}

function buildUpdateFrequencyRows() {
  if (Array.isArray(state.data.updateFrequencies) && state.data.updateFrequencies.length) {
    return state.data.updateFrequencies;
  }

  const counts = new Map();
  for (const asset of state.data.assets || []) {
    if (!asset.is_public_discoverable_dataset) continue;
    const frequency = String(asset.estimated_update_frequency || "").trim() || "Not specified";
    counts.set(frequency, (counts.get(frequency) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([estimated_update_frequency, public_dataset_count]) => ({ estimated_update_frequency, public_dataset_count }))
    .sort((a, b) => b.public_dataset_count - a.public_dataset_count || a.estimated_update_frequency.localeCompare(b.estimated_update_frequency));
}

function renderBars(target, rows, labelKey, valueKey, limit = 18) {
  const container = document.querySelector(target);
  const visible = rows.slice(0, limit);
  const maxValue = Math.max(...visible.map((row) => Number(row[valueKey]) || 0), 1);
  container.innerHTML = visible.map((row) => {
    const value = Number(row[valueKey]) || 0;
    const width = Math.max(2, (value / maxValue) * 100);
    const label = escapeHtml(row[labelKey]);
    return `
      <div class="bar-row">
        <div class="bar-label" title="${label}">${label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${formatNumber(value)}</div>
      </div>
    `;
  }).join("");
}

function renderCoverage() {
  renderBars("#categoryChart", state.data.categories, "category", "public_dataset_count");
  renderBars("#keywordChart", state.data.keywords, "keyword", "public_dataset_count");
  const updateFrequencyRows = buildUpdateFrequencyRows();
  renderBars("#updateFrequencyChart", updateFrequencyRows, "estimated_update_frequency", "public_dataset_count");
  const total = updateFrequencyRows.reduce((sum, row) => sum + Number(row.public_dataset_count || 0), 0);
  const note = document.querySelector("#updateFrequencyNote");
  if (note) note.textContent = `Counts ${formatNumber(total)} Public Catalog Datasets by the Maintenance Plan estimated update frequency field.`;
}

function renderTables() {
  const topDatasetsTable = document.querySelector("#topDatasets");
  if (topDatasetsTable) {
    const topRows = state.data.topDatasets.slice(0, 15).map((row) => `
      <tr>
        <td><a href="${row.url}" target="_blank" rel="noreferrer">${row.name}</a></td>
        <td>${row.category}</td>
        <td>${row.department_inferred}</td>
        <td>${formatNumber(row.visits)}</td>
        <td>${formatNumber(row.downloads)}</td>
      </tr>
    `).join("");
    topDatasetsTable.innerHTML = `
      <thead><tr><th>Dataset</th><th>Category</th><th>Department</th><th>Visits</th><th>Downloads</th></tr></thead>
      <tbody>${topRows}</tbody>
    `;
  }

  const staleTable = document.querySelector("#staleDatasets");
  if (staleTable) {
    const staleRows = state.data.staleDatasets.length
      ? state.data.staleDatasets.map((row) => `
        <tr>
          <td><a href="${row.url}" target="_blank" rel="noreferrer">${row.name}</a></td>
          <td>${row.estimated_update_frequency || "n/a"}</td>
          <td>${formatNumber(row.last_data_updated_age_days)}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="3">No stale scheduled public datasets in the current snapshot.</td></tr>`;
    staleTable.innerHTML = `
      <thead><tr><th>Dataset</th><th>Schedule</th><th>Age Days</th></tr></thead>
      <tbody>${staleRows}</tbody>
    `;
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-active")) return;
      activateTab(button.dataset.tab, { updateUrl: true });
    });
  });
  window.addEventListener("popstate", () => {
    syncInitialTabFromUrl();
    applyTimelineStateFromUrl();
    updateExplorer();
  });

  ["#metricSelect", "#periodSelect", "#rangeSelect"].forEach((selector) => {
    document.querySelector(selector).addEventListener("change", () => updateExplorer({ updateUrl: true }));
  });
  document.querySelector("#movingAverageToggle").addEventListener("change", () => updateExplorer());
  ["#assetFilter", "#categoryFilter", "#keywordFilter"].forEach((selector) => {
    document.querySelector(selector).addEventListener("input", () => updateExplorer({ updateUrl: true }));
  });
  document.querySelector("#clearUsageFilters").addEventListener("click", () => {
    document.querySelector("#assetFilter").value = "";
    document.querySelector("#categoryFilter").value = "";
    document.querySelector("#keywordFilter").value = "";
    updateExplorer({ updateUrl: true });
  });
  document.querySelectorAll("#snapshotWindowControl .segment").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#snapshotWindowControl .segment").forEach((segment) => segment.classList.remove("is-active"));
      button.classList.add("is-active");
      state.snapshotWindowDays = Number(button.dataset.days);
      state.snapshotDatasetPage = 1;
      renderSnapshot();
    });
  });
  document.querySelector("#snapshotDatasetTable").addEventListener("click", (event) => {
    const header = event.target.closest("th.sortable");
    if (!header) return;
    const sortKey = header.dataset.sort;
    if (state.snapshotSortKey === sortKey) {
      state.snapshotSortDir = state.snapshotSortDir === "asc" ? "desc" : "asc";
    } else {
      state.snapshotSortKey = sortKey;
      state.snapshotSortDir = sortKey === "name" || sortKey === "category" ? "asc" : "desc";
    }
    state.snapshotDatasetPage = 1;
    renderSnapshotDatasetTable();
  });
  document.querySelector("#snapshotDatasetPagination").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button) return;
    const page = Number(button.dataset.page);
    if (!Number.isFinite(page)) return;
    state.snapshotDatasetPage = page;
    renderSnapshotDatasetTable();
  });
  const snapshotDatasetFilterEl = document.querySelector("#snapshotDatasetFilter");
  if (snapshotDatasetFilterEl) {
    snapshotDatasetFilterEl.addEventListener("input", () => {
      state.snapshotDatasetFilter = snapshotDatasetFilterEl.value;
      state.snapshotDatasetPage = 1;
      renderSnapshotDatasetTable();
    });
  }
  const snapshotCategoryFilterEl = document.querySelector("#snapshotCategoryFilter");
  if (snapshotCategoryFilterEl) {
    snapshotCategoryFilterEl.addEventListener("change", () => {
      state.snapshotCategoryFilter = snapshotCategoryFilterEl.value;
      state.snapshotDatasetPage = 1;
      renderSnapshotDatasetTable();
    });
  }
  ["#overviewMetric", "#overviewRange"].forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) element.addEventListener("change", updateOverviewTrend);
  });
}

async function init() {
  syncInitialTabFromUrl();
  const response = await fetch("data/dashboard_data.json");
  state.data = await response.json();
  state.assetsByUid = new Map(state.data.assets.map((asset) => [asset.uid, asset]));
  setGeneratedAt();
  populateMetricSelects();
  applyTimelineStateFromUrl();
  normalizeTimelineUrlFromControls();
  populateSnapshotFilters();
  renderSnapshot();
  updateExplorer();
  renderCoverage();
  renderTables();
  bindEvents();
}

init().catch((error) => {
  document.body.innerHTML = `<main><div class="panel"><h1>Dashboard failed to load</h1><p>${error.message}</p></div></main>`;
});
