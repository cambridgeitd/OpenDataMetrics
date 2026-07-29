# Copilot Handoff: Cambridge Open Data Metrics

Generated on 2026-06-29 to help GitHub Copilot / Copilot coding agent pick up the project from the checked-in repository state.

## Short Answer

The repository itself contains the important project artifacts. A raw Codex conversation export/import is not assumed to be available or useful. Use this handoff plus `README.md` as the working context.

Before this handoff file was added, the local worktree was clean on `main`, tracking `origin/main`.

- Remote: `https://github.com/cambridgeitd/OpenDataMetrics.git`
- Last checked commit: `24f5cb8a5212eea7e88ec68e302347b586e5fff0`
- Commit date: `2026-06-17 14:03:50 +0000`
- Commit subject: `Refresh generated metrics [skip ci]`

## Project Purpose

This repo builds a Socrata-ready metrics dataset and static GitHub Pages dashboard for tracking the Cambridge Open Data Program strategic plan.

The project combines:

- Socrata system datasets from `data.cambridgema.gov`
- Cambridge department configuration in `config/cambridge_departments.csv`
- OpenGov (ViewPoint Cloud) permit type configuration in `config/opengov_permit_categories.csv` and `config/opengov_permit_dataset_matches.csv`
- Manual program inputs under `input/manual/`
- Generated processed CSVs under `data/processed/`
- Generated dashboard JSON under `docs/data/dashboard_data.json`
- Static dashboard files under `docs/`

## Key Files

- `README.md`: current user-facing overview and refresh instructions.
- `scripts/fetch_metrics.py`: main build script. Reads Socrata APIs and manual CSVs, writes processed data and dashboard JSON.
- `.github/workflows/pages.yml`: nightly/manual/push workflow that refreshes generated data, commits changes, uploads the dashboard artifact, and deploys Pages when the repo is public.
- `docs/index.html`, `docs/dashboard.js`, `docs/styles.css`: static dashboard.
- `data/processed/open_data_program_metrics.csv`: long-format Socrata-ready metric observations.
- `data/processed/open_data_program_metric_definitions.csv`: definitions, statuses, sources, caveats.
- `data/processed/permit_department_coverage.csv`, `data/processed/permit_type_dataset_coverage.csv`: OpenGov permit/license types compared with matching open datasets.
- `data/processed/data_gaps.csv`: known gaps and recommended data sources.
- `input/manual/training_events.csv`: real and planned event tracking.
- `input/manual/newsletter_subscribers.csv`: newsletter subscriber snapshots.
- `input/manual/*_template.csv`: templates for additional manual sources.

## Current Data State

As checked before this handoff:

- `open_data_program_metrics.csv`: 5,112 rows.
- `open_data_program_metric_definitions.csv`: 47 metric definitions.
- Metric definition status counts:
  - `manual_required`: 26
  - `populated_current`: 5
  - `populated_current_estimate`: 2
  - `populated_partial_history`: 2
  - `populated_since_2020_02`: 10
  - `populated_since_2021_05`: 2
- `data_gaps.csv`: 29 rows.
- `training_events.csv`: 14 rows, with 12 `completed` events and 2 `planned` events.
- Latest event month present: `2026-07-01`.
- `newsletter_subscribers.csv`: 7 snapshots.
- Latest newsletter snapshot: `2026-06-01`, `779` subscribers.

## Refresh Workflow

Local refresh:

```powershell
$env:SOCRATA_USERNAME="..."
$env:SOCRATA_PASSWORD="..."
$env:SOCRATA_DOMAIN="data.cambridgema.gov"
$env:SOCRATA_APP_TOKEN="..." # optional
python scripts/fetch_metrics.py
```

The script writes:

- `data/processed/*.csv`
- `docs/data/dashboard_data.json`

GitHub Actions refresh:

- Workflow: `.github/workflows/pages.yml`
- Triggers: push to `main`, monthly schedule, manual dispatch.
- Required repository secrets:
  - `SOCRATA_USERNAME`
  - `SOCRATA_PASSWORD`
- Optional secret if later wired into the workflow:
  - `SOCRATA_APP_TOKEN`

## Known Gaps And Caveats

These are already represented in `data/processed/data_gaps.csv`, but they are the main things a coding agent should keep in mind:

- Pre-February-2020 usage history is not available through the current Socrata SODA system datasets. The likely source is Socrata legacy `/admin/analytics` export.
- Department ownership metadata is mostly missing in the structured Socrata metadata field. Current department coverage is inferred where possible.
- Many strategic-plan metrics still need manual or non-Socrata sources:
  - privacy inquiries and requests
  - governance updates
  - Open Data Review Board attendance
  - newsletter issues sent
  - program events and attendance details beyond the current event CSV
  - CDAG meetings, attendance, and represented departments
  - emerging tool evaluations, pilots, adopted tools/methods
  - academic/civic tech collaborations
  - regional/national convenings
  - shared partner outputs
  - external references to Cambridge's work
- Rows marked `planned` in `input/manual/training_events.csv` are retained for tracking but excluded from completed-event and attendance metrics until updated.
- Newsletter subscriber tracking records only months with captured snapshots; the build intentionally does not infer values for missing months.

## Dashboard Notes

The dashboard is static and reads `docs/data/dashboard_data.json`.

Recent code in `docs/dashboard.js` supports:

- URL-driven tab state.
- Timeline metric, period, range, asset, category, and keyword filters.
- Metric links such as `?tab=timeline&metric=public_dataset_page_views&period=month&range=all`.
- Hidden/greyed timeline metric behavior for metrics that are unavailable or sparse.
- Snapshot sorting/filtering through dashboard state.
- Coverage tab permit coverage: sortable per-department table (department name, permit type
  count, matched/unmatched counts, coverage percent) whose rows expand to the OpenGov permit
  types, green when a matching open dataset exists and red when it does not, reading
  `permitCoverage` from the dashboard JSON. Sorting defaults to matched dataset count
  descending, and the sort key, direction, and missing-only filter round trip through the
  `permitSort`, `permitDir`, and `permitMissing` query parameters so a specific view can be
  linked to.

If changing dashboard behavior, test by serving or opening `docs/index.html` with the generated JSON available under `docs/data/`.

## Suggested Next Tasks

Good first tasks for Copilot:

1. Inspect `README.md`, `scripts/fetch_metrics.py`, and `data/processed/data_gaps.csv`.
2. Decide whether any additional manual metric inputs should be modeled as structured CSVs instead of generic `manual_metrics.csv`.
3. Add or update manual inputs for the highest-priority missing strategic-plan metrics.
4. Re-run `python scripts/fetch_metrics.py` with Socrata credentials and verify the generated CSV/JSON diffs.
5. Open the dashboard and check that new or changed metrics render cleanly.
6. If needed, improve README documentation for manual data maintenance and dashboard deployment.

## Suggested Copilot Starting Prompt

```text
Read COPILOT_HANDOFF.md and README.md, then inspect scripts/fetch_metrics.py and data/processed/data_gaps.csv. Summarize the current architecture, generated outputs, and remaining data gaps. Do not change files yet.
```

For implementation work:

```text
Using COPILOT_HANDOFF.md as context, add support for [specific metric/source], following existing patterns in scripts/fetch_metrics.py. Update templates or README if needed, run the refresh script if credentials are available, and summarize the generated data diffs.
```
