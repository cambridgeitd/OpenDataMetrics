const state = {
  data: null,
  metricId: "public_dataset_page_views",
  overviewMetricId: "public_dataset_page_views",
  assetsByUid: new Map(),
  snapshotWindowDays: 365,
  snapshotSortKey: "views",
  snapshotSortDir: "desc",
};

const colors = ["#2274a5", "#2f8f5b", "#b7791f", "#7156a5", "#217c7e", "#b64040"];
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

const numericRows = (rows) => rows
  .filter((row) => row.value !== "" && row.dimension === "" && row.dimension_value === "")
  .map((row) => ({ ...row, value: Number(row.value) }))
  .sort((a, b) => a.period_start.localeCompare(b.period_start));

const movingAverage = (rows, windowSize = 3) => {
  if (rows.length < windowSize) return [];
  return rows
    .map((row, index) => {
      if (index < windowSize - 1) return null;
      const windowRows = rows.slice(index - windowSize + 1, index + 1);
      const value = windowRows.reduce((sum, item) => sum + item.value, 0) / windowSize;
      return { ...row, index, value };
    })
    .filter(Boolean);
};

const latestMetricValue = (metricId, rows = state.data.metrics) => {
  const values = numericRows(rows.filter((row) => row.metric_id === metricId));
  return values.length ? values[values.length - 1].value : null;
};

const recentSum = (metricId, months = 12) => {
  const values = numericRows(state.data.monthly.filter((row) => row.metric_id === metricId));
  return values.slice(-months).reduce((sum, row) => sum + row.value, 0);
};

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

function rollingChange(metricId) {
  const values = numericRows(state.data.monthly.filter((row) => row.metric_id === metricId));
  const windows = [
    { size: 12, label: "vs prior 12 mo" },
    { size: 3, label: "vs prior 3 mo" },
    { size: 1, label: "vs prior month" },
  ];
  for (const window of windows) {
    if (values.length >= window.size * 2) {
      const current = values.slice(-window.size).reduce((sum, row) => sum + row.value, 0);
      const previous = values.slice(-window.size * 2, -window.size).reduce((sum, row) => sum + row.value, 0);
      return formatChange(current, previous, window.label);
    }
  }
  return changeUnavailable("No baseline");
}

function pointChange(metricId) {
  const values = numericRows(state.data.monthly.filter((row) => row.metric_id === metricId));
  const offsets = [
    { size: 12, label: "vs 12 mo ago" },
    { size: 3, label: "vs 3 mo ago" },
    { size: 1, label: "vs last month" },
  ];
  for (const offset of offsets) {
    if (values.length > offset.size) {
      const current = values[values.length - 1].value;
      const previous = values[values.length - 1 - offset.size].value;
      return formatChange(current, previous, offset.label);
    }
  }
  return changeUnavailable("No baseline");
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
  const cards = [
    {
      label: "Public Catalog Datasets",
      value: summary.totalPublicDatasets,
      note: `${summary.hiddenPublicDatasets} public-readable hidden tables excluded`,
      change: pointChange("public_datasets_cumulative"),
    },
    {
      label: "Dataset Views",
      value: recentSum("public_dataset_page_views"),
      note: "Last 12 months",
      change: rollingChange("public_dataset_page_views"),
    },
    {
      label: "Dataset Downloads",
      value: recentSum("public_dataset_downloads"),
      note: "Last 12 months",
      change: rollingChange("public_dataset_downloads"),
    },
    {
      label: "Dataset API Reads",
      value: recentSum("public_dataset_api_reads"),
      note: "Last 12 months",
      change: rollingChange("public_dataset_api_reads"),
    },
    {
      label: "Fresh On Schedule",
      value: summary.freshnessPercent,
      unit: "percent",
      note: `${summary.freshScheduledDatasets} of ${summary.scheduledDatasets} scheduled datasets`,
      change: changeUnavailable(),
    },
    {
      label: "PDDL Licensed",
      value: summary.pddlPercent,
      unit: "percent",
      note: `${summary.pddlDatasets} datasets`,
      change: changeUnavailable(),
    },
  ];

  document.querySelector("#kpiGrid").innerHTML = cards.map((card) => `
    <article class="kpi" style="${card.change.percent === null ? "" : `--kpi-bg: ${colorForPercent(card.change.percent)};`}">
      <div class="label">${card.label}</div>
      <div class="value">${formatNumber(card.value, card.unit)}</div>
      <div class="change ${card.change.className}">${card.change.text}</div>
      <div class="note">${card.note}</div>
    </article>
  `).join("");
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

function buildDatasetActivityRows(days) {
  const datasetAssets = state.data.assets
    .filter((asset) => asset.is_public_discoverable_dataset)
    .sort((a, b) => a.name.localeCompare(b.name));
  let latestTime = -Infinity;
  for (const row of state.data.datasetDailyActivity) {
    const time = Date.parse(`${row.day}T00:00:00Z`);
    if (time > latestTime) latestTime = time;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = latestTime - (days - 1) * dayMs;
  const previousStart = currentStart - days * dayMs;
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

  for (const activity of state.data.datasetDailyActivity) {
    const row = rowsByUid.get(activity.asset_uid);
    if (!row) continue;
    const time = Date.parse(`${activity.day}T00:00:00Z`);
    const isCurrent = time >= currentStart && time <= latestTime;
    const isPrevious = time >= previousStart && time < currentStart;
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

  return [...rowsByUid.values()].map((row) => {
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
  });
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

function renderSnapshotDatasetTable() {
  const table = document.querySelector("#snapshotDatasetTable");
  if (!table) return;
  const rows = sortDatasetActivityRows(buildDatasetActivityRows(state.snapshotWindowDays));
  const shownRows = rows.filter((row) => row.total > 0).slice(0, 75);
  const note = document.querySelector("#datasetActivityNote");
  note.textContent = `Showing ${shownRows.length.toLocaleString()} active public catalog datasets for the latest ${windowLabel(state.snapshotWindowDays)}, compared with the immediately preceding ${windowLabel(state.snapshotWindowDays)}. Click a column header to sort.`;
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
      ${shownRows.map((row) => `
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
      `).join("")}
    </tbody>
  `;
}

function populateMetricSelects() {
  const monthlyDefs = state.data.definitions
    .filter((item) => item.period_type === "month")
    .filter((item) => !hiddenTimelineMetricIds.has(item.metric_id))
    .sort((a, b) => `${a.priority} ${a.metric_name}`.localeCompare(`${b.priority} ${b.metric_name}`));

  const optionHtml = monthlyDefs.map((item) => `
    <option value="${item.metric_id}">${item.priority}: ${item.metric_name}</option>
  `).join("");

  for (const selector of ["#metricSelect", "#overviewMetric"]) {
    const select = document.querySelector(selector);
    if (!select) continue;
    select.innerHTML = optionHtml;
    select.value = selector === "#metricSelect" ? state.metricId : state.overviewMetricId;
  }
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

function renderLineChart(target, rows, metricId, periodType = "month") {
  const container = document.querySelector(target);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">No captured values for this metric.</div>`;
    return;
  }

  const movingRows = movingAverage(rows);
  const movingLabel = periodType === "year" ? "3-year moving avg" : "3-month moving avg";
  const width = 980;
  const height = container.classList.contains("tall") ? 390 : 300;
  const margin = { top: 18, right: 24, bottom: 44, left: 72 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const minValue = Math.min(...rows.map((row) => row.value), 0);
  const span = maxValue - minValue || 1;
  const x = (index) => margin.left + (rows.length === 1 ? innerWidth / 2 : (index / (rows.length - 1)) * innerWidth);
  const y = (value) => margin.top + innerHeight - ((value - minValue) / span) * innerHeight;
  const path = rows.map((row, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(row.value).toFixed(1)}`).join(" ");
  const movingPath = movingRows.map((row, index) => `${index === 0 ? "M" : "L"} ${x(row.index).toFixed(1)} ${y(row.value).toFixed(1)}`).join(" ");
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
        <circle class="point" cx="${x(index)}" cy="${y(row.value)}" r="3.2">
        </circle>
        <circle class="tooltip-target" cx="${x(index)}" cy="${y(row.value)}" r="9"
          tabindex="0"
          data-period="${escapeHtml(formatPeriod(row.period_start, periodType))}"
          data-metric="${metricName}"
          data-series="Actual"
          data-value="${escapeHtml(formatPreciseNumber(row.value, def.unit))}">
        </circle>
      `).join("")}
      ${movingRows.map((row) => `
        <circle class="moving-average-point" cx="${x(row.index)}" cy="${y(row.value)}" r="2.5">
        </circle>
        <circle class="tooltip-target" cx="${x(row.index)}" cy="${y(row.value)}" r="9"
          tabindex="0"
          data-period="${escapeHtml(formatPeriod(row.period_start, periodType))}"
          data-metric="${metricName}"
          data-series="${escapeHtml(movingLabel)}"
          data-value="${escapeHtml(formatPreciseNumber(row.value, def.unit))}">
        </circle>
      `).join("")}
      ${rows.map((row, index) => index % labelStep === 0 || index === rows.length - 1 ? `
        <text class="chart-label" x="${x(index)}" y="${height - 15}" text-anchor="middle">${formatPeriod(row.period_start, periodType)}</text>
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

function updateExplorer() {
  const metricId = document.querySelector("#metricSelect").value;
  const periodType = document.querySelector("#periodSelect").value;
  const range = periodType === "year" ? "all" : document.querySelector("#rangeSelect").value;
  buildUsageFilterOptions(metricId);
  const rows = filteredSeries(metricId, periodType, range, getUsageFilters());
  renderLineChart("#metricChart", rows, metricId, periodType);
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
      body: `${summary.departmentMetadataDatasets} of ${summary.totalPublicDatasets} public-discoverable datasets has the structured Maintenance Plan department field populated.`,
    },
    {
      title: "Classes and trainings were not loaded",
      body: "No non-template files were found under input/manual. The dashboard has templates for workshop, training, CDAG, and manual metrics.",
    },
    {
      title: "Privacy documentation is sparse",
      body: `${summary.privacyNotesDatasets} public-discoverable datasets have explicit privacy or geomasking notes in the structured metadata field.`,
    },
  ];
  document.querySelector("#watchlist").innerHTML = items.map((item) => `
    <div class="watch-item">
      <strong>${item.title}</strong>
      <span>${item.body}</span>
    </div>
  `).join("");
}

function renderBars(target, rows, labelKey, valueKey, limit = 18) {
  const container = document.querySelector(target);
  const visible = rows.slice(0, limit);
  const maxValue = Math.max(...visible.map((row) => Number(row[valueKey]) || 0), 1);
  container.innerHTML = visible.map((row) => {
    const value = Number(row[valueKey]) || 0;
    const width = Math.max(2, (value / maxValue) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label" title="${row[labelKey]}">${row[labelKey]}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${formatNumber(value)}</div>
      </div>
    `;
  }).join("");
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
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("is-active"));
      button.classList.add("is-active");
      document.querySelector(`#${button.dataset.tab}`).classList.add("is-active");
    });
  });

  ["#metricSelect", "#periodSelect", "#rangeSelect"].forEach((selector) => {
    document.querySelector(selector).addEventListener("change", updateExplorer);
  });
  ["#assetFilter", "#categoryFilter", "#keywordFilter"].forEach((selector) => {
    document.querySelector(selector).addEventListener("input", updateExplorer);
  });
  document.querySelector("#clearUsageFilters").addEventListener("click", () => {
    document.querySelector("#assetFilter").value = "";
    document.querySelector("#categoryFilter").value = "";
    document.querySelector("#keywordFilter").value = "";
    updateExplorer();
  });
  document.querySelectorAll("#snapshotWindowControl .segment").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#snapshotWindowControl .segment").forEach((segment) => segment.classList.remove("is-active"));
      button.classList.add("is-active");
      state.snapshotWindowDays = Number(button.dataset.days);
      renderSnapshotDatasetTable();
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
    renderSnapshotDatasetTable();
  });
  ["#overviewMetric", "#overviewRange"].forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) element.addEventListener("change", updateOverviewTrend);
  });
}

async function init() {
  const response = await fetch("data/dashboard_data.json");
  state.data = await response.json();
  state.assetsByUid = new Map(state.data.assets.map((asset) => [asset.uid, asset]));
  setGeneratedAt();
  populateMetricSelects();
  buildKpis();
  renderSnapshotDatasetTable();
  updateExplorer();
  renderBars("#categoryChart", state.data.categories, "category", "public_dataset_count");
  renderBars("#keywordChart", state.data.keywords, "keyword", "public_dataset_count");
  renderTables();
  bindEvents();
}

init().catch((error) => {
  document.body.innerHTML = `<main><div class="panel"><h1>Dashboard failed to load</h1><p>${error.message}</p></div></main>`;
});
