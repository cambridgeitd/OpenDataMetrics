#!/usr/bin/env python3
"""Build Socrata-ready Open Data Program metrics and dashboard data.

The script reads Cambridge Socrata system datasets with credentials from:
  SOCRATA_USERNAME
  SOCRATA_PASSWORD

Optional:
  SOCRATA_DOMAIN, defaults to data.cambridgema.gov
  SOCRATA_APP_TOKEN

Outputs are written under data/processed and docs/data.
"""

from __future__ import annotations

import base64
import csv
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "input"
MANUAL_DIR = INPUT_DIR / "manual"
PROCESSED_DIR = ROOT / "data" / "processed"
DOCS_DATA_DIR = ROOT / "docs" / "data"
CONFIG_DIR = ROOT / "config"

DOMAIN = os.environ.get("SOCRATA_DOMAIN", "data.cambridgema.gov")
ANALYTICS_STORY_ID = os.environ.get("SOCRATA_ANALYTICS_STORY_ID", "r6yq-fzqd")

FALLBACK_SYSTEM_IDS = {
    "asset_access": "te8d-2w5t",
    "asset_inventory": "rkcc-jee9",
    "catalog_search_terms": "bhi2-xwsy",
    "user_authentications": "hbqn-78w5",
    "referrers": "yu3j-w3ic",
}

PUBLIC_DOMAIN_LICENSE = "Open Data Commons Public Domain Dedication and License"
VIEW_ACCESS_TYPES = {
    "grid view",
    "measure page view",
    "primer page view",
    "story view",
    "visualization canvas view",
    "visualization page view",
}

FRESHNESS_DAYS = {
    "daily": 2,
    "weekly": 10,
    "monthly": 45,
    "quarterly": 110,
    "semiannually": 220,
    "semi-annually": 220,
    "annually": 400,
    "yearly": 400,
}


METRIC_DEFINITIONS = [
    {
        "metric_id": "public_datasets_cumulative",
        "metric_name": "Public-discoverable datasets, current inventory backcast by creation date",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "datasets",
        "aggregation": "last",
        "status": "populated_partial_history",
        "source": "Socrata Asset Inventory system dataset",
        "notes": "Backcast from creation dates for datasets visible in the unauthenticated Socrata Discovery API now; hidden, deleted, or formerly private assets are not reconstructed.",
    },
    {
        "metric_id": "public_datasets_created",
        "metric_name": "Public-discoverable datasets created",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "datasets",
        "aggregation": "sum",
        "status": "populated_partial_history",
        "source": "Socrata Asset Inventory system dataset",
        "notes": "Counts creation month for datasets visible in the unauthenticated Socrata Discovery API now.",
    },
    {
        "metric_id": "discovery_api_public_datasets",
        "metric_name": "Public-discoverable datasets visible in Socrata Discovery API",
        "priority": "Priority 1",
        "period_type": "snapshot",
        "unit": "datasets",
        "aggregation": "last",
        "status": "populated_current",
        "source": "Socrata Discovery API",
        "notes": "Public catalog count from api.us.socrata.com. Useful as a check against Asset Inventory.",
    },
    {
        "metric_id": "public_dataset_page_views",
        "metric_name": "Public-discoverable dataset page views",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "views",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Asset Access system dataset",
        "notes": "Includes primer/grid/visualization-style views for current public-discoverable base datasets.",
    },
    {
        "metric_id": "public_dataset_downloads",
        "metric_name": "Public-discoverable dataset downloads",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "downloads",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Asset Access system dataset",
        "notes": "Download/export actions for current public-discoverable base datasets.",
    },
    {
        "metric_id": "public_dataset_api_reads",
        "metric_name": "Public-discoverable dataset API reads",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "api reads",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Asset Access system dataset",
        "notes": "SODA/resource endpoint accesses for current public-discoverable base datasets.",
    },
    {
        "metric_id": "public_asset_views",
        "metric_name": "Public asset views",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "views",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Asset Access system dataset",
        "notes": "Views across public assets in the current inventory, excluding downloads and API reads.",
    },
    {
        "metric_id": "public_asset_downloads",
        "metric_name": "Public asset downloads",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "downloads",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Asset Access system dataset",
        "notes": "Downloads across public assets in the current inventory.",
    },
    {
        "metric_id": "public_asset_api_reads",
        "metric_name": "Public asset API reads",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "api reads",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Asset Access system dataset",
        "notes": "API reads across public assets in the current inventory.",
    },
    {
        "metric_id": "catalog_searches",
        "metric_name": "Catalog searches",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "searches",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata Catalog Search Terms system dataset",
        "notes": "Counts terms entered into Socrata catalog search bars; Discovery API searches are not included.",
    },
    {
        "metric_id": "distinct_catalog_search_terms",
        "metric_name": "Distinct catalog search terms",
        "priority": "Priority 1",
        "period_type": "month",
        "unit": "terms",
        "aggregation": "max",
        "status": "populated_since_2020_02",
        "source": "Socrata Catalog Search Terms system dataset",
        "notes": "Monthly distinct search terms; yearly value is the max monthly value, not yearly distinct terms.",
    },
    {
        "metric_id": "referrer_visits",
        "metric_name": "Referrer visits",
        "priority": "Priority 3",
        "period_type": "month",
        "unit": "visits",
        "aggregation": "sum",
        "status": "populated_since_2021_05",
        "source": "Socrata Referrers system dataset",
        "notes": "Visits from recorded referrer domains to portal assets.",
    },
    {
        "metric_id": "distinct_referrers",
        "metric_name": "Distinct referrer domains",
        "priority": "Priority 3",
        "period_type": "month",
        "unit": "domains",
        "aggregation": "max",
        "status": "populated_since_2021_05",
        "source": "Socrata Referrers system dataset",
        "notes": "Monthly distinct referrer domains; yearly value is the max monthly value.",
    },
    {
        "metric_id": "active_internal_portal_accounts",
        "metric_name": "Active internal portal accounts",
        "priority": "Priority 4",
        "period_type": "month",
        "unit": "accounts",
        "aggregation": "max",
        "status": "populated_since_2020_02",
        "source": "Socrata User Authentications system dataset",
        "notes": "Distinct monthly site_member user accounts with login activity; yearly value is the max monthly value.",
    },
    {
        "metric_id": "portal_logins",
        "metric_name": "Portal logins",
        "priority": "Priority 4",
        "period_type": "month",
        "unit": "logins",
        "aggregation": "sum",
        "status": "populated_since_2020_02",
        "source": "Socrata User Authentications system dataset",
        "notes": "All recorded username/password and SSO authentications.",
    },
    {
        "metric_id": "datasets_with_pddl_license",
        "metric_name": "Public-discoverable datasets with PDDL license",
        "priority": "Priority 1",
        "period_type": "snapshot",
        "unit": "datasets",
        "aggregation": "last",
        "status": "populated_current",
        "source": "Socrata Asset Inventory system dataset",
        "notes": "Current snapshot only; license history is not in the asset inventory.",
    },
    {
        "metric_id": "datasets_with_pddl_license_pct",
        "metric_name": "Public-discoverable datasets with PDDL license percentage",
        "priority": "Priority 1",
        "period_type": "snapshot",
        "unit": "percent",
        "aggregation": "average",
        "status": "populated_current",
        "source": "Socrata Asset Inventory system dataset",
        "notes": "Current snapshot only.",
    },
    {
        "metric_id": "datasets_with_automated_refresh",
        "metric_name": "Public-discoverable datasets with automated refresh process",
        "priority": "Priority 1",
        "period_type": "snapshot",
        "unit": "datasets",
        "aggregation": "last",
        "status": "populated_current_estimate",
        "source": "Socrata Asset Inventory custom metadata",
        "notes": "Estimated from Internal: Update Process and maintenance/data provenance text containing automation signals.",
    },
    {
        "metric_id": "dataset_freshness_pct",
        "metric_name": "Scheduled public-discoverable datasets fresh",
        "priority": "Priority 1",
        "period_type": "snapshot",
        "unit": "percent",
        "aggregation": "average",
        "status": "populated_current_estimate",
        "source": "Socrata Asset Inventory update frequency and last data updated date",
        "notes": "Current snapshot; excludes Historical Data, As Needed, blank, and unknown frequencies. Thresholds are in scripts/fetch_metrics.py.",
    },
    {
        "metric_id": "datasets_with_privacy_geomasking_notes",
        "metric_name": "Public-discoverable datasets with privacy or geomasking notes",
        "priority": "Priority 2",
        "period_type": "snapshot",
        "unit": "datasets",
        "aggregation": "last",
        "status": "populated_current",
        "source": "Socrata Asset Inventory custom metadata",
        "notes": "Counts non-empty Specific Limitations: Geomasking and Privacy Notes on current public datasets.",
    },
    {
        "metric_id": "datasets_with_department_metadata",
        "metric_name": "Public-discoverable datasets with Maintenance Plan department metadata",
        "priority": "Priority 4",
        "period_type": "snapshot",
        "unit": "datasets",
        "aggregation": "last",
        "status": "populated_current",
        "source": "Socrata Asset Inventory custom metadata",
        "notes": "Measures whether a structured department field is populated, not inferred ownership.",
    },
]

MANUAL_METRICS = [
    ("privacy_inquiries_requests", "Privacy inquiries and requests received", "Priority 2", "month", "requests"),
    ("published_governance_updates", "Published governance updates or guidance pieces", "Priority 2", "month", "updates"),
    ("odrb_public_attendance", "Public attendance at Open Data Review Board meetings", "Priority 2", "month", "attendees"),
    ("newsletter_issues_sent", "Newsletter issues sent", "Priority 3", "month", "issues"),
    ("newsletter_subscribers", "Newsletter subscribers", "Priority 3", "month", "subscribers"),
    ("public_workshops", "Public workshops", "Priority 3", "month", "events"),
    ("public_workshop_attendance", "Public workshop attendance", "Priority 3", "month", "attendees"),
    ("targeted_outreach_events", "Targeted outreach events", "Priority 3", "month", "events"),
    ("targeted_outreach_attendance", "Targeted outreach attendance", "Priority 3", "month", "attendees"),
    ("big_issues_talks", "Big Issues talks", "Priority 3", "month", "events"),
    ("big_issues_attendance", "Big Issues attendance", "Priority 3", "month", "attendees"),
    ("cdag_meetings", "CDAG meetings", "Priority 4", "month", "meetings"),
    ("cdag_attendance", "CDAG attendance", "Priority 4", "month", "attendees"),
    ("departments_represented_in_cdag", "Departments represented in CDAG", "Priority 4", "month", "departments"),
    ("staff_trainings", "Staff trainings", "Priority 4", "month", "events"),
    ("staff_training_attendance", "Staff training attendance", "Priority 4", "month", "attendees"),
    ("emerging_tool_evaluations", "Evaluations of emerging tools or methods", "Priority 5", "year", "evaluations"),
    ("documented_pilots", "Documented pilots or experiments conducted", "Priority 5", "year", "pilots"),
    ("tools_methods_adopted", "New tools or methods adopted/deployed", "Priority 5", "year", "tools"),
    ("academic_collaborations", "Academic data collaborations", "Priority 6", "year", "collaborations"),
    ("civic_tech_collaborations", "Civic tech collaborations", "Priority 6", "year", "collaborations"),
    ("regional_national_convenings", "Participation in regional or national convenings", "Priority 6", "year", "convenings"),
    ("shared_outputs_with_partners", "Shared outputs with regional partners", "Priority 6", "year", "outputs"),
    ("external_references", "External references to Cambridge's work", "Priority 6", "year", "references"),
]

for metric_id, metric_name, priority, period_type, unit in MANUAL_METRICS:
    METRIC_DEFINITIONS.append(
        {
            "metric_id": metric_id,
            "metric_name": metric_name,
            "priority": priority,
            "period_type": period_type,
            "unit": unit,
            "aggregation": "sum" if period_type == "month" else "last",
            "status": "manual_required",
            "source": "Manual input template or future non-Socrata source",
            "notes": "Not found in Socrata system datasets. Fill input/manual/manual_metrics.csv or structured event files.",
        }
    )


def auth_headers(accept: str = "application/json") -> dict[str, str]:
    user = os.environ.get("SOCRATA_USERNAME")
    password = os.environ.get("SOCRATA_PASSWORD")
    if not user or not password:
        raise SystemExit("SOCRATA_USERNAME and SOCRATA_PASSWORD must be set.")
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    headers = {"Authorization": f"Basic {token}", "Accept": accept}
    app_token = os.environ.get("SOCRATA_APP_TOKEN")
    if app_token:
        headers["X-App-Token"] = app_token
    return headers


def get_json(url: str, timeout: int = 60) -> Any:
    req = urllib.request.Request(url, headers=auth_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        body = exc.read(1000).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc


def get_text(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(url, headers=auth_headers("text/html,application/json"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read(1000).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc


def soda_query(view_id: str, soql: str, timeout: int = 120) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"$query": soql})
    url = f"https://{DOMAIN}/resource/{view_id}.json?{query}"
    data = get_json(url, timeout=timeout)
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected response from {view_id}: {data!r}")
    return data


def discover_system_ids() -> dict[str, str]:
    ids = dict(FALLBACK_SYSTEM_IDS)
    try:
        story_url = f"https://{DOMAIN}/stories/s/Site-Analytics-Dashboard-Beta-/{ANALYTICS_STORY_ID}"
        story = get_text(story_url)
        dataset_ids = sorted(set(re.findall(r'"datasetUid":"([a-z0-9]{4}-[a-z0-9]{4})"', story)))
        for dataset_id in dataset_ids:
            view = get_json(f"https://{DOMAIN}/api/views/{dataset_id}.json")
            name = (view.get("name") or "").lower()
            if "asset access" in name:
                ids["asset_access"] = dataset_id
            elif "asset inventory" == name:
                ids["asset_inventory"] = dataset_id
            elif "catalog search" in name:
                ids["catalog_search_terms"] = dataset_id
            elif "user authentication" in name:
                ids["user_authentications"] = dataset_id
            elif "referrer" in name:
                ids["referrers"] = dataset_id
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: using fallback system dataset IDs because discovery failed: {exc}", file=sys.stderr)
    return ids


def parse_ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    if text.endswith(".000"):
        text = text[:-4]
    try:
        return dt.datetime.fromisoformat(text)
    except ValueError:
        try:
            return dt.datetime.strptime(value[:10], "%Y-%m-%d")
        except ValueError:
            return None


def month_start(value: dt.datetime | dt.date) -> str:
    return f"{value.year:04d}-{value.month:02d}-01"


def year_start(value: dt.datetime | dt.date | str) -> str:
    if isinstance(value, str):
        return f"{value[:4]}-01-01"
    return f"{value.year:04d}-01-01"


def iter_months(start: str, end: str) -> list[str]:
    y, m = [int(part) for part in start[:7].split("-")]
    end_y, end_m = [int(part) for part in end[:7].split("-")]
    months: list[str] = []
    while (y, m) <= (end_y, end_m):
        months.append(f"{y:04d}-{m:02d}-01")
        m += 1
        if m == 13:
            y += 1
            m = 1
    return months


def to_int(value: Any) -> int:
    if value in (None, ""):
        return 0
    return int(float(value))


def to_int_or_none(value: Any) -> int | None:
    text = clean_text(value)
    if not text:
        return None
    return int(float(text))


def to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def pct(part: int, total: int) -> float | None:
    if total == 0:
        return None
    return round(100.0 * part / total, 2)


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return html.unescape(str(value)).strip()


def has_text(value: Any) -> bool:
    return bool(clean_text(value))


def parse_keywords(value: Any) -> list[str]:
    text = clean_text(value)
    if not text:
        return []
    keywords = []
    for part in re.split(r"[,;|]", text):
        keyword = " ".join(part.strip().split())
        if keyword:
            keywords.append(keyword)
    return keywords


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def infer_department(asset: dict[str, Any], official_departments: set[str]) -> tuple[str, str]:
    structured = clean_text(asset.get("maintenanceplan_department"))
    if structured:
        return structured, "maintenanceplan_department"

    haystack = " | ".join(
        clean_text(asset.get(field))
        for field in (
            "category",
            "attribution",
            "contact_email",
            "description",
            "tags",
            "dataprovenance_dataorigins",
        )
    ).lower()

    aliases = [
        ("public works", "Public Works (DPW)"),
        ("dpw", "Public Works (DPW)"),
        ("traffic", "Transportation"),
        ("parking", "Transportation"),
        ("transportation", "Transportation"),
        ("community development", "Community Development"),
        ("cdd", "Community Development"),
        ("inspectional", "Inspectional Services"),
        ("isd", "Inspectional Services"),
        ("public health", "Public Health"),
        ("health department", "Public Health"),
        ("police", "Police Department"),
        ("public safety", "Police Department"),
        ("fire", "Fire Department"),
        ("assessing", "Assessing"),
        ("assessor", "Assessing"),
        ("budget", "Budget"),
        ("finance", "Finance"),
        ("budget/finance", "Finance"),
        ("purchasing", "Purchasing"),
        ("procurement", "Purchasing"),
        ("water", "Water Department"),
        ("human service", "Human Service Programs"),
        ("dhsp", "Human Service Programs"),
        ("library", "Library"),
        ("cambridge arts", "Cambridge Arts"),
        ("arts council", "Cambridge Arts"),
        ("election", "Election Commission"),
        ("city clerk", "City Clerk's Office"),
        ("license", "License Commission"),
        ("emergency communications", "Emergency Communications"),
        ("historical", "Historical Commission"),
        ("sustainability", "Office of Sustainability"),
        ("energy and the environment", "Office of Sustainability"),
        ("information technology", "Information Technology"),
        ("cambridge gis", "Information Technology"),
        ("gis", "Information Technology"),
        ("school", "School Department"),
        ("cps", "School Department"),
        ("community safety", "Community Safety"),
        ("equity", "Department of Equity & Inclusion"),
        ("human resources", "Human Resources"),
        ("human rights", "Human Rights Commission"),
        ("law", "Law"),
        ("weights", "Weights & Measures"),
        ("veterans", "Veterans' Services"),
    ]
    for needle, department in aliases:
        if needle in haystack and department in official_departments:
            return department, "inferred_from_metadata"
    return "Unassigned/Unknown", "missing"


def is_public_base_dataset(asset: dict[str, Any]) -> bool:
    return (
        clean_text(asset.get("audience")).lower() == "public"
        and clean_text(asset.get("type")).lower() == "dataset"
        and not truthy(asset.get("derived_view"))
    )


def is_public_asset(asset: dict[str, Any]) -> bool:
    return clean_text(asset.get("audience")).lower() == "public"


def is_automated(asset: dict[str, Any]) -> bool:
    update_process = clean_text(asset.get("internal_updateprocess")).lower()
    if update_process.startswith("auto"):
        return True
    text = " | ".join(
        clean_text(asset.get(field)).lower()
        for field in (
            "maintenanceplan_maintenanceplandetails",
            "dataprovenance_dataflowsandtransformations",
            "internal_updateprocessnotes",
        )
    )
    return any(token in text for token in ("automated", "auto ", "datasync", "python", "r script", "api", "scheduled"))


def freshness(asset: dict[str, Any], generated_at: dt.datetime) -> tuple[bool | None, int | None]:
    frequency = clean_text(asset.get("maintenanceplan_estimatedupdatefrequency")).lower()
    if frequency not in FRESHNESS_DAYS:
        return None, None
    last_update = parse_ts(asset.get("last_data_updated_date"))
    if last_update is None:
        return False, None
    if last_update.tzinfo is None:
        last_update = last_update.replace(tzinfo=dt.timezone.utc)
    age_days = (generated_at - last_update.astimezone(dt.timezone.utc)).days
    return age_days <= FRESHNESS_DAYS[frequency], age_days


def add_observation(
    observations: list[dict[str, Any]],
    generated_at: str,
    metric_id: str,
    period_type: str,
    period_start: str,
    value: float | int | None,
    dimension: str = "",
    dimension_value: str = "",
    source_detail: str = "",
    notes: str = "",
) -> None:
    observations.append(
        {
            "metric_id": metric_id,
            "period_type": period_type,
            "period_start": period_start,
            "value": "" if value is None else value,
            "dimension": dimension,
            "dimension_value": dimension_value,
            "source_detail": source_detail,
            "notes": notes,
            "generated_at": generated_at,
        }
    )


def aggregate_yearly(monthly_rows: list[dict[str, Any]], definition_by_id: dict[str, dict[str, Any]], generated_at: str) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    for row in monthly_rows:
        if row.get("period_type") != "month" or row.get("value") == "":
            continue
        key = (row["metric_id"], year_start(row["period_start"]), row.get("dimension", ""), row.get("dimension_value", ""))
        grouped[key].append(float(row["value"]))

    yearly: list[dict[str, Any]] = []
    for (metric_id, period_start, dimension, dimension_value), values in sorted(grouped.items()):
        aggregation = definition_by_id.get(metric_id, {}).get("aggregation", "sum")
        if aggregation == "last":
            value: float = values[-1]
        elif aggregation == "max":
            value = max(values)
        elif aggregation == "average":
            value = round(sum(values) / len(values), 2)
        else:
            value = sum(values)
        if value.is_integer():
            value = int(value)
        add_observation(
            yearly,
            generated_at,
            metric_id,
            "year",
            period_start,
            value,
            dimension=dimension,
            dimension_value=dimension_value,
            notes=f"Aggregated from monthly values using {aggregation}.",
        )
    return yearly


def load_manual_observations(generated_at: str) -> tuple[list[dict[str, Any]], list[str]]:
    observations: list[dict[str, Any]] = []
    loaded_files: list[str] = []
    if not MANUAL_DIR.exists():
        return observations, loaded_files

    for path in sorted(MANUAL_DIR.glob("manual_metrics*.csv")):
        if "template" in path.name.lower():
            continue
        for row in read_csv(path):
            value = to_float(row.get("value"))
            add_observation(
                observations,
                generated_at,
                clean_text(row.get("metric_id")),
                clean_text(row.get("period_type") or "month"),
                clean_text(row.get("period_start")),
                value,
                dimension=clean_text(row.get("dimension")),
                dimension_value=clean_text(row.get("dimension_value")),
                source_detail=path.name,
                notes=clean_text(row.get("notes")),
            )
        loaded_files.append(path.name)

    for path in sorted(MANUAL_DIR.glob("training_events*.csv")):
        if "template" in path.name.lower():
            continue
        events_by_month: dict[str, Counter[str]] = defaultdict(Counter)
        departments_by_month: dict[str, set[str]] = defaultdict(set)
        for row in read_csv(path):
            status = clean_text(row.get("event_status") or "completed").lower()
            if status in {"planned", "scheduled", "tentative", "cancelled", "canceled"}:
                continue
            date = parse_ts(row.get("event_date") or row.get("event_month"))
            if date is None:
                continue
            period = month_start(date)
            event_type = clean_text(row.get("event_type")).lower()
            attendance = to_int_or_none(row.get("attendance"))
            dept_text = clean_text(row.get("departments_represented"))
            if event_type in {"public_workshop", "workshop"}:
                events_by_month[period]["public_workshops"] += 1
                if attendance is not None:
                    events_by_month[period]["public_workshop_attendance"] += attendance
            elif event_type in {"staff_training", "training"}:
                events_by_month[period]["staff_trainings"] += 1
                if attendance is not None:
                    events_by_month[period]["staff_training_attendance"] += attendance
            elif event_type in {"targeted_outreach", "outreach"}:
                events_by_month[period]["targeted_outreach_events"] += 1
                if attendance is not None:
                    events_by_month[period]["targeted_outreach_attendance"] += attendance
            elif event_type in {"big_issues", "big_issues_talk"}:
                events_by_month[period]["big_issues_talks"] += 1
                if attendance is not None:
                    events_by_month[period]["big_issues_attendance"] += attendance
            elif event_type == "cdag":
                events_by_month[period]["cdag_meetings"] += 1
                if attendance is not None:
                    events_by_month[period]["cdag_attendance"] += attendance
                for dept in re.split(r"[;|,]", dept_text):
                    if dept.strip():
                        departments_by_month[period].add(dept.strip())
        for period, counts in events_by_month.items():
            if departments_by_month[period]:
                counts["departments_represented_in_cdag"] = len(departments_by_month[period])
            for metric_id, value in counts.items():
                add_observation(observations, generated_at, metric_id, "month", period, value, source_detail=path.name)
        loaded_files.append(path.name)

    return observations, loaded_files


def get_discovery_public_dataset_ids() -> tuple[set[str], int | None]:
    """Return unauthenticated public catalog dataset IDs and reported count.

    This intentionally avoids administrator credentials. Authenticated Discovery
    API calls can include assets that the public cannot discover.
    """
    ids: set[str] = set()
    reported_count: int | None = None
    offset = 0
    limit = 100
    try:
        while True:
            params = urllib.parse.urlencode(
                {
                    "domains": DOMAIN,
                    "search_context": DOMAIN,
                    "only": "datasets",
                    "limit": limit,
                    "offset": offset,
                }
            )
            url = f"https://api.us.socrata.com/api/catalog/v1?{params}"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as response:
                data = json.load(response)
            if reported_count is None:
                reported_count = to_int(data.get("resultSetSize"))
            results = data.get("results", [])
            for item in results:
                uid = clean_text((item.get("resource") or {}).get("id"))
                if uid:
                    ids.add(uid)
            if len(results) < limit:
                break
            offset += limit
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: Discovery API IDs failed: {exc}", file=sys.stderr)
    return ids, reported_count


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)

    generated_dt = dt.datetime.now(dt.timezone.utc)
    generated_at = generated_dt.isoformat(timespec="seconds")
    snapshot_date = generated_dt.date().isoformat()
    print(f"Fetching Socrata system datasets from {DOMAIN}...")

    system_ids = discover_system_ids()
    print(json.dumps(system_ids, indent=2))

    official_departments = {
        row["department"]
        for row in read_csv(CONFIG_DIR / "cambridge_departments.csv")
        if row.get("department")
    }

    inventory_rows = soda_query(system_ids["asset_inventory"], "SELECT * LIMIT 50000")
    discovery_public_dataset_uids, discovery_count = get_discovery_public_dataset_ids()
    if not discovery_public_dataset_uids:
        raise SystemExit("Could not load public-discoverable dataset IDs from Socrata Discovery API.")
    public_assets = [row for row in inventory_rows if is_public_asset(row)]
    public_asset_uids = {clean_text(row.get("uid")) for row in public_assets}
    public_readable_base_datasets = [row for row in inventory_rows if is_public_base_dataset(row)]
    public_readable_base_dataset_uids = {clean_text(row.get("uid")) for row in public_readable_base_datasets}
    hidden_public_datasets = [
        row
        for row in public_readable_base_datasets
        if clean_text(row.get("uid")) not in discovery_public_dataset_uids
    ]
    public_datasets = [
        row
        for row in public_readable_base_datasets
        if clean_text(row.get("uid")) in discovery_public_dataset_uids
    ]
    public_dataset_uids = {clean_text(row.get("uid")) for row in public_datasets}

    for asset in public_datasets:
        dept, method = infer_department(asset, official_departments)
        asset["department_inferred"] = dept
        asset["department_inference_method"] = method
        fresh, age_days = freshness(asset, generated_dt)
        asset["fresh_on_schedule"] = fresh
        asset["last_data_updated_age_days"] = age_days
        asset["automated_refresh"] = is_automated(asset)
        asset["privacy_notes_present"] = has_text(asset.get("specificlimitations_geomaskingandprivacynotes"))

    observations: list[dict[str, Any]] = []
    source_notes: list[str] = []
    definition_by_id = {row["metric_id"]: row for row in METRIC_DEFINITIONS}

    creation_dates = [
        parse_ts(asset.get("creation_date"))
        for asset in public_datasets
        if parse_ts(asset.get("creation_date")) is not None
    ]
    current_month = month_start(generated_dt)
    if creation_dates:
        first_inventory_month = month_start(min(creation_dates))
        months = iter_months(first_inventory_month, current_month)
        created_counts = Counter(month_start(date) for date in creation_dates if date is not None)
        cumulative = 0
        for period in months:
            created = created_counts[period]
            cumulative += created
            add_observation(
                observations,
                generated_at,
                "public_datasets_created",
                "month",
                period,
                created,
                source_detail=system_ids["asset_inventory"],
            )
            add_observation(
                observations,
                generated_at,
                "public_datasets_cumulative",
                "month",
                period,
                cumulative,
                source_detail=system_ids["asset_inventory"],
                notes="Backcast from current public inventory creation dates.",
            )

    access_rows = soda_query(
        system_ids["asset_access"],
        "SELECT date_trunc_ym(timestamp) as period_start, asset_uid, asset_type, "
        "access_type, sum(value) as access_count "
        "GROUP BY period_start, asset_uid, asset_type, access_type "
        "ORDER BY period_start LIMIT 200000",
        timeout=180,
    )
    access_by_month: dict[str, Counter[str]] = defaultdict(Counter)
    access_by_type_rows: list[dict[str, Any]] = []
    for row in access_rows:
        asset_uid = clean_text(row.get("asset_uid"))
        if asset_uid not in public_asset_uids:
            continue
        period = clean_text(row.get("period_start"))[:10]
        period = period[:7] + "-01"
        access_type = clean_text(row.get("access_type"))
        asset_type = clean_text(row.get("asset_type"))
        count = to_int(row.get("access_count"))
        access_by_type_rows.append(
            {
                "period_start": period,
                "asset_uid": asset_uid,
                "asset_type": asset_type,
                "access_type": access_type,
                "value": count,
            }
        )

        if access_type == "API read":
            access_by_month[period]["public_asset_api_reads"] += count
        elif access_type == "download":
            access_by_month[period]["public_asset_downloads"] += count
        elif access_type in VIEW_ACCESS_TYPES:
            access_by_month[period]["public_asset_views"] += count

        if asset_uid in public_dataset_uids:
            if access_type == "API read":
                access_by_month[period]["public_dataset_api_reads"] += count
            elif access_type == "download":
                access_by_month[period]["public_dataset_downloads"] += count
            elif access_type in VIEW_ACCESS_TYPES:
                access_by_month[period]["public_dataset_page_views"] += count

    daily_start = (generated_dt - dt.timedelta(days=760)).strftime("%Y-%m-%dT00:00:00")
    daily_access_rows = soda_query(
        system_ids["asset_access"],
        "SELECT date_trunc_ymd(timestamp) as day, asset_uid, access_type, sum(value) as access_count "
        f"WHERE timestamp >= '{daily_start}' AND asset_type='dataset' "
        "GROUP BY day, asset_uid, access_type ORDER BY day LIMIT 400000",
        timeout=240,
    )
    if len(daily_access_rows) >= 400000:
        print("Warning: daily dataset activity query hit the row limit.", file=sys.stderr)
    dataset_daily_activity_by_key: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for row in daily_access_rows:
        asset_uid = clean_text(row.get("asset_uid"))
        if asset_uid not in public_dataset_uids:
            continue
        access_type = clean_text(row.get("access_type"))
        count = to_int(row.get("access_count"))
        day = clean_text(row.get("day"))[:10]
        if access_type == "API read":
            dataset_daily_activity_by_key[(day, asset_uid)]["api_reads"] += count
        elif access_type == "download":
            dataset_daily_activity_by_key[(day, asset_uid)]["downloads"] += count
        elif access_type in VIEW_ACCESS_TYPES:
            dataset_daily_activity_by_key[(day, asset_uid)]["views"] += count
    dataset_daily_activity_rows = [
        {
            "day": day,
            "asset_uid": asset_uid,
            "views": counts.get("views", 0),
            "downloads": counts.get("downloads", 0),
            "api_reads": counts.get("api_reads", 0),
        }
        for (day, asset_uid), counts in sorted(dataset_daily_activity_by_key.items())
    ]

    for period, counts in sorted(access_by_month.items()):
        for metric_id, value in counts.items():
            add_observation(observations, generated_at, metric_id, "month", period, value, source_detail=system_ids["asset_access"])

    catalog_rows = soda_query(
        system_ids["catalog_search_terms"],
        "SELECT date_trunc_ym(timestamp) as period_start, sum(value) as searches, "
        "count(distinct search_term) as distinct_terms "
        "GROUP BY period_start ORDER BY period_start LIMIT 10000",
    )
    for row in catalog_rows:
        period = clean_text(row.get("period_start"))[:7] + "-01"
        add_observation(observations, generated_at, "catalog_searches", "month", period, to_int(row.get("searches")), source_detail=system_ids["catalog_search_terms"])
        add_observation(observations, generated_at, "distinct_catalog_search_terms", "month", period, to_int(row.get("distinct_terms")), source_detail=system_ids["catalog_search_terms"])

    referrer_rows = soda_query(
        system_ids["referrers"],
        "SELECT date_trunc_ym(timestamp) as period_start, sum(value) as referrer_visits, "
        "count(distinct referrer) as distinct_referrers "
        "GROUP BY period_start ORDER BY period_start LIMIT 10000",
    )
    for row in referrer_rows:
        period = clean_text(row.get("period_start"))[:7] + "-01"
        add_observation(observations, generated_at, "referrer_visits", "month", period, to_int(row.get("referrer_visits")), source_detail=system_ids["referrers"])
        add_observation(observations, generated_at, "distinct_referrers", "month", period, to_int(row.get("distinct_referrers")), source_detail=system_ids["referrers"])

    login_rows = soda_query(
        system_ids["user_authentications"],
        "SELECT date_trunc_ym(timestamp) as period_start, user_segment, "
        "sum(value) as logins, count(distinct user_uid) as active_users "
        "GROUP BY period_start, user_segment ORDER BY period_start LIMIT 10000",
    )
    login_by_month: dict[str, Counter[str]] = defaultdict(Counter)
    for row in login_rows:
        period = clean_text(row.get("period_start"))[:7] + "-01"
        login_by_month[period]["portal_logins"] += to_int(row.get("logins"))
        if clean_text(row.get("user_segment")) == "site_member":
            login_by_month[period]["active_internal_portal_accounts"] = max(
                login_by_month[period]["active_internal_portal_accounts"],
                to_int(row.get("active_users")),
            )
    for period, counts in sorted(login_by_month.items()):
        for metric_id, value in counts.items():
            add_observation(observations, generated_at, metric_id, "month", period, value, source_detail=system_ids["user_authentications"])

    manual_observations, manual_files = load_manual_observations(generated_at)
    observations.extend(manual_observations)

    total_public_datasets = len(public_datasets)
    pddl_count = sum(1 for row in public_datasets if clean_text(row.get("license")) == PUBLIC_DOMAIN_LICENSE)
    automated_count = sum(1 for row in public_datasets if row["automated_refresh"])
    privacy_count = sum(1 for row in public_datasets if row["privacy_notes_present"])
    department_metadata_count = sum(1 for row in public_datasets if has_text(row.get("maintenanceplan_department")))
    scheduled = [row for row in public_datasets if row["fresh_on_schedule"] is not None]
    fresh_count = sum(1 for row in scheduled if row["fresh_on_schedule"])

    snapshot_values = {
        "discovery_api_public_datasets": discovery_count,
        "datasets_with_pddl_license": pddl_count,
        "datasets_with_pddl_license_pct": pct(pddl_count, total_public_datasets),
        "datasets_with_automated_refresh": automated_count,
        "dataset_freshness_pct": pct(fresh_count, len(scheduled)),
        "datasets_with_privacy_geomasking_notes": privacy_count,
        "datasets_with_department_metadata": department_metadata_count,
    }
    for metric_id, value in snapshot_values.items():
        add_observation(observations, generated_at, metric_id, "snapshot", snapshot_date, value, source_detail=system_ids.get("asset_inventory", ""))

    monthly_metric_ids = {
        row["metric_id"]
        for row in METRIC_DEFINITIONS
        if row["period_type"] == "month" and row["status"] != "manual_required"
    }
    manual_monthly_metric_ids = {
        row["metric_id"]
        for row in METRIC_DEFINITIONS
        if row["period_type"] == "month" and row["status"] == "manual_required"
    }
    observed_months = [row["period_start"] for row in observations if row["period_type"] == "month"]
    all_months = iter_months(min(observed_months), current_month) if observed_months else []
    existing_keys = {
        (row["metric_id"], row["period_type"], row["period_start"], row.get("dimension", ""), row.get("dimension_value", ""))
        for row in observations
    }
    for metric_id in sorted(monthly_metric_ids | manual_monthly_metric_ids):
        for period in all_months:
            key = (metric_id, "month", period, "", "")
            if key not in existing_keys:
                status = definition_by_id[metric_id]["status"]
                add_observation(
                    observations,
                    generated_at,
                    metric_id,
                    "month",
                    period,
                    None,
                    notes="No source value available for this period." if status == "manual_required" else "",
                )

    monthly_rows = sorted(
        [row for row in observations if row["period_type"] == "month"],
        key=lambda row: (row["metric_id"], row["period_start"], row.get("dimension", ""), row.get("dimension_value", "")),
    )
    yearly_rows = aggregate_yearly(monthly_rows, definition_by_id, generated_at)

    manual_year_metric_ids = {
        row["metric_id"]
        for row in METRIC_DEFINITIONS
        if row["period_type"] == "year" and row["status"] == "manual_required"
    }
    years = sorted({year_start(period) for period in all_months})
    existing_year_keys = {
        (row["metric_id"], row["period_type"], row["period_start"], row.get("dimension", ""), row.get("dimension_value", ""))
        for row in yearly_rows
    }
    for metric_id in sorted(manual_year_metric_ids):
        for period in years:
            key = (metric_id, "year", period, "", "")
            if key not in existing_year_keys:
                add_observation(yearly_rows, generated_at, metric_id, "year", period, None, notes="Manual metric not yet captured.")

    snapshot_rows = [row for row in observations if row["period_type"] == "snapshot"]
    all_observations = sorted(
        monthly_rows + yearly_rows + snapshot_rows,
        key=lambda row: (row["metric_id"], row["period_type"], row["period_start"], row.get("dimension", ""), row.get("dimension_value", "")),
    )

    category_counts = Counter(clean_text(row.get("category")) or "Uncategorized" for row in public_datasets)
    category_rows = [
        {"category": category, "public_dataset_count": count}
        for category, count in sorted(category_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    keyword_counts: Counter[str] = Counter()
    for row in public_datasets:
        keyword_counts.update(parse_keywords(row.get("tags")))
    keyword_rows = [
        {"keyword": keyword, "public_dataset_count": count}
        for keyword, count in sorted(keyword_counts.items(), key=lambda item: (-item[1], item[0].lower()))
    ]

    department_counts = Counter(row["department_inferred"] for row in public_datasets)
    department_methods: dict[str, Counter[str]] = defaultdict(Counter)
    for row in public_datasets:
        department_methods[row["department_inferred"]][row["department_inference_method"]] += 1
    department_rows = []
    for department in sorted(official_departments | set(department_counts.keys())):
        count = department_counts.get(department, 0)
        department_rows.append(
            {
                "department": department,
                "public_dataset_count": count,
                "coverage_status": "represented" if count else "not represented",
                "structured_metadata_count": department_methods[department].get("maintenanceplan_department", 0),
                "inferred_metadata_count": department_methods[department].get("inferred_from_metadata", 0),
                "missing_metadata_count": department_methods[department].get("missing", 0),
            }
        )
    department_rows.sort(key=lambda row: (-row["public_dataset_count"], row["department"]))

    asset_filter_rows = []
    asset_filter_csv_rows = []
    for row in sorted(public_assets, key=lambda asset: clean_text(asset.get("name")).lower()):
        keywords = parse_keywords(row.get("tags"))
        asset_uid = clean_text(row.get("uid"))
        asset_filter_row = {
            "uid": asset_uid,
            "name": clean_text(row.get("name")),
            "type": clean_text(row.get("type")),
            "category": clean_text(row.get("category")) or "Uncategorized",
            "keywords": keywords,
            "is_public_base_dataset": asset_uid in public_readable_base_dataset_uids,
            "is_public_discoverable_dataset": asset_uid in public_dataset_uids,
            "url": clean_text(row.get("url")),
        }
        asset_filter_rows.append(asset_filter_row)
        asset_filter_csv_rows.append({**asset_filter_row, "keywords": ", ".join(keywords)})

    inventory_export_rows = []
    for row in sorted(public_datasets, key=lambda asset: clean_text(asset.get("name")).lower()):
        inventory_export_rows.append(
            {
                "uid": clean_text(row.get("uid")),
                "name": clean_text(row.get("name")),
                "category": clean_text(row.get("category")),
                "keywords": clean_text(row.get("tags")),
                "department_inferred": row["department_inferred"],
                "department_inference_method": row["department_inference_method"],
                "attribution": clean_text(row.get("attribution")),
                "license": clean_text(row.get("license")),
                "creation_date": clean_text(row.get("creation_date")),
                "last_data_updated_date": clean_text(row.get("last_data_updated_date")),
                "last_data_updated_age_days": "" if row["last_data_updated_age_days"] is None else row["last_data_updated_age_days"],
                "estimated_update_frequency": clean_text(row.get("maintenanceplan_estimatedupdatefrequency")),
                "fresh_on_schedule": "" if row["fresh_on_schedule"] is None else row["fresh_on_schedule"],
                "update_process": clean_text(row.get("internal_updateprocess")),
                "automated_refresh": row["automated_refresh"],
                "privacy_notes_present": row["privacy_notes_present"],
                "visits": to_int(row.get("visits")),
                "downloads": to_int(row.get("downloads")),
                "url": clean_text(row.get("url")),
            }
        )

    update_frequency_counts = Counter(
        row["estimated_update_frequency"] or "Not specified"
        for row in inventory_export_rows
    )
    update_frequency_rows = [
        {"estimated_update_frequency": frequency, "public_dataset_count": count}
        for frequency, count in sorted(update_frequency_counts.items(), key=lambda item: (-item[1], item[0].lower()))
    ]

    top_datasets = sorted(
        [
            {
                "uid": row["uid"],
                "name": row["name"],
                "category": row["category"] or "Uncategorized",
                "department_inferred": row["department_inferred"],
                "visits": row["visits"],
                "downloads": row["downloads"],
                "url": row["url"],
            }
            for row in inventory_export_rows
        ],
        key=lambda row: (row["visits"], row["downloads"]),
        reverse=True,
    )[:25]

    stale_datasets = sorted(
        [
            row
            for row in inventory_export_rows
            if row["fresh_on_schedule"] is False
        ],
        key=lambda row: row["last_data_updated_age_days"] if row["last_data_updated_age_days"] != "" else -1,
        reverse=True,
    )[:25]

    hidden_public_dataset_rows = [
        {
            "uid": clean_text(row.get("uid")),
            "name": clean_text(row.get("name")),
            "category": clean_text(row.get("category")),
            "url": clean_text(row.get("url")),
            "notes": "Public-readable in Asset Inventory but hidden from public Discovery API/catalog.",
        }
        for row in sorted(hidden_public_datasets, key=lambda asset: clean_text(asset.get("name")).lower())
    ]

    data_gaps = [
        {
            "metric_id": "legacy_pre_2020_usage",
            "priority": "Priority 1",
            "gap_type": "historical_api_gap",
            "status": "not_available_via_current_soda_system_dataset",
            "recommended_source": "Socrata /admin/analytics legacy CSV or JSON export",
            "notes": "Current Asset Access starts in February 2020. Socrata docs say older records are only available through legacy admin downloads and may not match newer analytics definitions.",
        },
        {
            "metric_id": "department_dataset_ownership",
            "priority": "Priority 4",
            "gap_type": "metadata_gap",
            "status": "mostly_missing",
            "recommended_source": "Populate Maintenance Plan: Department for every public dataset",
            "notes": f"{department_metadata_count} of {total_public_datasets} current public-discoverable catalog datasets have structured department metadata.",
        },
        {
            "metric_id": "classes_and_trainings",
            "priority": "Priority 3/4",
            "gap_type": "local_input_missing",
            "status": "not_loaded" if not manual_files else "loaded_manual_files",
            "recommended_source": "Add non-template CSV files under input/manual",
            "notes": "No non-template class/training files were found." if not manual_files else f"Loaded manual files: {', '.join(manual_files)}",
        },
    ]
    for definition in METRIC_DEFINITIONS:
        if definition["status"] == "manual_required":
            data_gaps.append(
                {
                    "metric_id": definition["metric_id"],
                    "priority": definition["priority"],
                    "gap_type": "non_socrata_source_needed",
                    "status": "manual_required",
                    "recommended_source": "Program tracker, newsletter platform, event registration, meeting records, or manual_metrics.csv",
                    "notes": definition["notes"],
                }
            )

    fields_metrics = [
        "metric_id",
        "period_type",
        "period_start",
        "value",
        "dimension",
        "dimension_value",
        "source_detail",
        "notes",
        "generated_at",
    ]
    fields_definitions = [
        "metric_id",
        "metric_name",
        "priority",
        "period_type",
        "unit",
        "aggregation",
        "status",
        "source",
        "notes",
    ]
    write_csv(PROCESSED_DIR / "open_data_program_metrics.csv", all_observations, fields_metrics)
    write_csv(PROCESSED_DIR / "open_data_program_metrics_monthly.csv", monthly_rows, fields_metrics)
    write_csv(PROCESSED_DIR / "open_data_program_metrics_yearly.csv", yearly_rows + snapshot_rows, fields_metrics)
    write_csv(PROCESSED_DIR / "open_data_program_metric_definitions.csv", METRIC_DEFINITIONS, fields_definitions)
    write_csv(
        PROCESSED_DIR / "dataset_inventory_snapshot.csv",
        inventory_export_rows,
        [
            "uid",
            "name",
            "category",
            "keywords",
            "department_inferred",
            "department_inference_method",
            "attribution",
            "license",
            "creation_date",
            "last_data_updated_date",
            "last_data_updated_age_days",
            "estimated_update_frequency",
            "fresh_on_schedule",
            "update_process",
            "automated_refresh",
            "privacy_notes_present",
            "visits",
            "downloads",
            "url",
        ],
    )
    write_csv(PROCESSED_DIR / "dataset_category_summary.csv", category_rows, ["category", "public_dataset_count"])
    write_csv(PROCESSED_DIR / "dataset_keyword_summary.csv", keyword_rows, ["keyword", "public_dataset_count"])
    write_csv(
        PROCESSED_DIR / "dataset_update_frequency_summary.csv",
        update_frequency_rows,
        ["estimated_update_frequency", "public_dataset_count"],
    )
    write_csv(
        PROCESSED_DIR / "hidden_public_datasets.csv",
        hidden_public_dataset_rows,
        ["uid", "name", "category", "url", "notes"],
    )
    write_csv(
        PROCESSED_DIR / "dataset_daily_activity_recent.csv",
        dataset_daily_activity_rows,
        ["day", "asset_uid", "views", "downloads", "api_reads"],
    )
    write_csv(
        PROCESSED_DIR / "asset_filter_options.csv",
        asset_filter_csv_rows,
        ["uid", "name", "type", "category", "keywords", "is_public_base_dataset", "is_public_discoverable_dataset", "url"],
    )
    write_csv(
        PROCESSED_DIR / "department_coverage.csv",
        department_rows,
        [
            "department",
            "public_dataset_count",
            "coverage_status",
            "structured_metadata_count",
            "inferred_metadata_count",
            "missing_metadata_count",
        ],
    )
    write_csv(
        PROCESSED_DIR / "data_gaps.csv",
        data_gaps,
        ["metric_id", "priority", "gap_type", "status", "recommended_source", "notes"],
    )

    dashboard_data = {
        "generatedAt": generated_at,
        "domain": DOMAIN,
        "systemDatasetIds": system_ids,
        "sources": {
            "socrataSiteAnalyticsDocs": "https://support.socrata.com/hc/en-us/articles/360045612793-Data-Insights-Site-Analytics",
            "assetAccessDocs": "https://support.socrata.com/hc/en-us/articles/360051223314-Site-Analytics-Asset-Access",
            "cambridgeDepartments": "https://www.cambridgema.gov/Departments",
            "strategicPlan": "input/cambridgeopendatastrategicplan2026-2028.pdf",
        },
        "summary": {
            "totalPublicDatasets": total_public_datasets,
            "discoveryApiPublicDatasets": discovery_count,
            "publicReadableBaseDatasets": len(public_readable_base_datasets),
            "hiddenPublicDatasets": len(hidden_public_datasets),
            "publicAssets": len(public_assets),
            "pddlDatasets": pddl_count,
            "pddlPercent": pct(pddl_count, total_public_datasets),
            "automatedRefreshDatasets": automated_count,
            "automatedRefreshPercent": pct(automated_count, total_public_datasets),
            "scheduledDatasets": len(scheduled),
            "freshScheduledDatasets": fresh_count,
            "freshnessPercent": pct(fresh_count, len(scheduled)),
            "privacyNotesDatasets": privacy_count,
            "departmentMetadataDatasets": department_metadata_count,
            "manualFilesLoaded": manual_files,
        },
        "definitions": METRIC_DEFINITIONS,
        "metrics": all_observations,
        "monthly": monthly_rows,
        "yearly": yearly_rows,
        "snapshot": snapshot_rows,
        "categories": category_rows,
        "keywords": keyword_rows,
        "updateFrequencies": update_frequency_rows,
        "departments": department_rows,
        "assets": asset_filter_rows,
        "topDatasets": top_datasets,
        "staleDatasets": stale_datasets,
        "hiddenPublicDatasets": hidden_public_dataset_rows,
        "gaps": data_gaps,
        "accessByType": access_by_type_rows,
        "datasetDailyActivity": dataset_daily_activity_rows,
    }
    with (DOCS_DATA_DIR / "dashboard_data.json").open("w", encoding="utf-8") as handle:
        json.dump(dashboard_data, handle, indent=2)

    print(f"Wrote {len(all_observations):,} metric observations.")
    print(f"Current public-discoverable catalog datasets: {total_public_datasets:,}")
    print(f"Public-readable hidden base datasets excluded from dataset counts: {len(hidden_public_datasets):,}")
    print(f"Monthly Socrata usage history begins: {min(access_by_month) if access_by_month else 'n/a'}")
    print(f"Manual files loaded: {', '.join(manual_files) if manual_files else 'none'}")


if __name__ == "__main__":
    main()
