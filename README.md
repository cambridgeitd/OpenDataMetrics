# Cambridge Open Data Metrics

This repository builds a Socrata-ready metrics dataset and a GitHub Pages dashboard for tracking the Cambridge Open Data Program strategic plan.

## [View the live Open Data Metrics dashboard](https://cambridgeitd.github.io/OpenDataMetrics/)

## What It Produces

- `data/processed/open_data_program_metrics.csv`: long-format Socrata-ready metric observations.
- `data/processed/open_data_program_metric_definitions.csv`: metric definitions, sources, and caveats.
- `data/processed/dataset_inventory_snapshot.csv`: public dataset inventory snapshot with inferred department coverage and freshness fields.
- `data/processed/permit_department_coverage.csv`: share of OpenGov permit/license types with a matching open dataset, by department.
- `data/processed/permit_type_dataset_coverage.csv`: one row per OpenGov permit/license type with its matched dataset(s), if any.
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

## Permit Coverage Source

The Coverage tab answers "what is the denominator?" for permitting data by comparing every
permit and license type residents can apply for on the City's OpenGov (ViewPoint Cloud)
storefront with the datasets published on the open data portal.

The build reads two unauthenticated OpenGov endpoints:

- `https://api-east.viewpointcloud.com/v2/cambridgema/record_types`
- `https://api-east.viewpointcloud.com/v2/cambridgema/categories`

Only enabled record types with public apply access are counted. Two config files control
how they roll up:

- `config/opengov_permit_categories.csv`: maps an OpenGov category to a Cambridge
  department and flags non-permit categories (for example the help/FAQ category) as
  excluded.
- `config/opengov_permit_dataset_matches.csv`: the curated permit type to dataset
  mapping. An empty `dataset_uids` value means the permit type was reviewed and has no
  matching public dataset. Permit types with no row fall back to conservative
  name-similarity matching and are reported with a `match_source` of `auto` or
  `unreviewed`, which is the signal to curate them.

A curated "no dataset" row is still scored on every build so a dataset published later
cannot stay hidden behind an old decision. When a match now looks likely, the build
prints a `Review:` line, records the candidate in the `review_candidate_uids` column of
`data/processed/permit_type_dataset_coverage.csv`, and the dashboard shows a "Possible
match to review" hint on that permit. Either fill in `dataset_uids` to accept it, or list
the uid in `review_suppressed_uids` with a note to record that it was reviewed and
rejected.

Override the endpoints with `OPENGOV_COMMUNITY`, `OPENGOV_API_BASE`, and
`OPENGOV_PORTAL_BASE` if the portal moves. The permit coverage rebuilds on every
`scripts/fetch_metrics.py` run, which the `Refresh metrics and publish Pages` workflow
executes daily on a schedule, so it refreshes alongside the Socrata metrics without any
extra credentials. If OpenGov is unreachable the build still succeeds: it falls back to
the previously committed `data/processed/permit_type_dataset_coverage.csv` and marks the
result `stale`, and only hides the panel outright when no prior build exists.

## Manual Sources Still Needed

Several strategic-plan metrics are not available in Socrata system datasets: newsletter subscribers, event attendance, CDAG attendance, privacy requests, governance updates, pilots, partnerships, and external references. Add non-template files under `input/manual/` using the included templates, then rerun the fetch script.

Program event tracking lives in `input/manual/training_events.csv`. Use ISO dates and months; rows marked `planned` are retained for tracking but are excluded from completed-event and attendance metrics until their status is updated.

Newsletter subscriber tracking lives in `input/manual/newsletter_subscribers.csv`. Use ISO snapshot dates; the build records only months with captured snapshot counts so the dashboard does not imply values for missing months.
