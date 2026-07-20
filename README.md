# Cambridge Open Data Metrics

This repository builds a Socrata-ready metrics dataset and a GitHub Pages dashboard for tracking the Cambridge Open Data Program strategic plan.

## [View the live Open Data Metrics dashboard](https://cambridgeitd.github.io/OpenDataMetrics/)

## What It Produces

- `data/processed/open_data_program_metrics.csv`: long-format Socrata-ready metric observations.
- `data/processed/open_data_program_metric_definitions.csv`: metric definitions, sources, and caveats.
- `data/processed/dataset_inventory_snapshot.csv`: public dataset inventory snapshot with inferred department coverage and freshness fields.
- `data/processed/data_gaps.csv`: metrics the current Socrata sources do not capture.
- `docs/`: static GitHub Pages dashboard.

## Refresh

Set these environment variables, then run:

```powershell
$env:SOCRATA_USERNAME="..."
$env:SOCRATA_PASSWORD="..."
python scripts/fetch_metrics.py
```

Optional:

```powershell
$env:SOCRATA_DOMAIN="data.cambridgema.gov"
$env:SOCRATA_APP_TOKEN="..."
```

## Socrata Sources

The script discovers the hidden Site Analytics system datasets from the existing Site Analytics story and falls back to known Cambridge IDs:

- Asset Access
- Asset Inventory
- Catalog Search Terms
- User Authentications
- Referrers

The current API-accessible Asset Access history starts in February 2020. Older portal traffic appears to require Socrata's legacy `/admin/analytics` export path.

## Manual Sources Still Needed

Several strategic-plan metrics are not available in Socrata system datasets: newsletter subscribers, event attendance, CDAG attendance, privacy requests, governance updates, pilots, partnerships, and external references. Add non-template files under `input/manual/` using the included templates, then rerun the fetch script.

Program event tracking lives in `input/manual/training_events.csv`. Use ISO dates and months; rows marked `planned` are retained for tracking but are excluded from completed-event and attendance metrics until their status is updated.

Newsletter subscriber tracking lives in `input/manual/newsletter_subscribers.csv`. Use ISO snapshot dates; the build records only months with captured snapshot counts so the dashboard does not imply values for missing months.
