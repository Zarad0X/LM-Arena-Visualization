# Data Processing

This project uses the Hugging Face dataset `lmarena-ai/leaderboard-dataset`.

Source URL: https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset

The dataset contains historical LMArena leaderboard snapshots. Each row
describes one model's score in one arena category at one leaderboard publish
date. The original files are parquet files grouped by arena and split.

## Raw Data Shape

Raw files are downloaded to:

```text
data/raw/lmarena-leaderboard/
├── text/
│   ├── full-00000-of-00001.parquet
│   └── latest-00000-of-00001.parquet
├── text_style_control/
├── vision/
├── vision_style_control/
├── webdev/
├── search/
├── document/
└── ...
```

There are 14 arenas. Each arena has two splits:

- `full`: all historical leaderboard snapshots.
- `latest`: the latest leaderboard snapshot.

The current processed data profile reports:

- Full rows: 1,601,272
- Latest rows: 20,521
- Arena count: 14
- Full model count: 571
- Latest model count: 559
- Organization count: 85
- Category count: 46
- Date range: 2023-05-08 to 2026-05-22

## Raw Field Definitions

| Field | Meaning | Use in the system |
|---|---|---|
| `model_name` | Model identifier shown on the leaderboard. | Model selection, model details, rank evolution. |
| `organization` | Organization or provider associated with the model. | Organization comparison and provider-level summaries. |
| `license` | Model license label, such as proprietary or open model licenses. | Open/closed or license-based comparison. |
| `rating` | Arena rating score for the model in a category and snapshot. | Main performance metric. |
| `rating_lower` | Lower bound of the rating interval. | Uncertainty visualization. |
| `rating_upper` | Upper bound of the rating interval. | Uncertainty visualization. |
| `variance` | Rating variance supplied by the dataset. | Stability and uncertainty analysis. |
| `vote_count` | Number of votes behind the leaderboard estimate. | Reliability and sample-size analysis. |
| `rank` | Model rank within the arena/category/snapshot. | Ranking and bump-chart views. |
| `category` | Subtask or category inside an arena, such as `overall`, language categories, or task-specific categories. | Category matrix and filtered comparisons. |
| `leaderboard_publish_date` | Date when the leaderboard snapshot was published. | Time-series and historical evolution views. |

## Derived Fields

The preprocessing script adds:

| Field | Definition | Why it matters |
|---|---|---|
| `arena` | Directory/config name of the source arena, such as `text`, `vision`, or `webdev`. | Enables cross-arena comparison. |
| `split` | `full` or `latest`. | Distinguishes history from current leaderboard state. |
| `confidence_width` | `rating_upper - rating_lower`. | Compact uncertainty measure for visual encoding. |

## Processing Pipeline

The data pipeline has four stages:

```text
Hugging Face parquet files
→ data/raw/lmarena-leaderboard/
→ scripts/preprocess_leaderboard.py
→ public/data/*.json + docs/data-profile.md
```

Implementation layout:

```text
scripts/preprocess_leaderboard.py              # CLI entrypoint
scripts/lmarena_processing/config.py          # constants and paths
scripts/lmarena_processing/io.py              # read parquet, normalize fields, write JSON
scripts/lmarena_processing/aggregations.py    # build summaries and derived tables
scripts/lmarena_processing/report.py          # write markdown data profile
scripts/lmarena_processing/pipeline.py         # orchestrate the full flow
```

During preprocessing, the script:

1. Discovers all arena folders under `data/raw/lmarena-leaderboard/`.
2. Reads each arena's `full` and `latest` parquet files.
3. Validates required columns.
4. Normalizes text fields and numeric fields.
5. Converts `leaderboard_publish_date` to a date value.
6. Computes `confidence_width = rating_upper - rating_lower`.
7. Builds frontend-ready JSON files.
8. Writes a data profile report to `docs/data-profile.md`.

## Download Raw Data

```bash
./scripts/download_leaderboard_dataset.sh
```

Raw files are stored under `data/raw/lmarena-leaderboard/` and ignored by git.

## Install Processing Dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Build Frontend JSON

```bash
python scripts/preprocess_leaderboard.py
```

The script writes frontend-ready JSON files to `public/data/` and generates
`docs/data-profile.md`.

## Processed Output Files

| File | Content | Intended view |
|---|---|---|
| `manifest.json` | Dataset-level metadata, row counts, date range, output manifest. | Dataset overview and sanity checks. |
| `arena_summary.json` | One row per arena with row counts, date range, snapshot count, model count, categories. | Arena overview and arena selector. |
| `latest_leaderboard.json` | Latest snapshot rows across all arenas, with `arena`, `split`, and `confidence_width`. | Current leaderboard table, category matrix, detail views. |
| `rank_timeseries_top.json` | Top-K models per arena/category/date. Default `top_k=10`. | Rank evolution and bump chart. |
| `date_category_counts.json` | Aggregated time-series statistics by arena/date/category. | Dataset activity, coverage, vote, and uncertainty trends. |
| `organization_summary_latest.json` | Latest organization-level summary by arena. | Organization/provider comparison. |
| `model_profiles_latest.json` | One profile per model with latest records across arenas/categories. | Model detail panel. |

## Before and After

Before preprocessing:

- Raw data is split across 28 parquet files.
- Files are organized by arena and split.
- Frontend would need parquet support and would have to load too much data.
- There are no ready-to-use time-series, organization, model-profile, or arena-summary tables.

After preprocessing:

- Frontend reads compact JSON files from `public/data/`.
- Large historical rows are reduced into view-oriented summaries.
- Top-K rank time series is capped to avoid overloading the browser.
- Data profile is generated for documentation and presentation.

## Reproducibility Notes

- `data/raw/` is ignored by git because raw data is reproducible from Hugging Face.
- `public/data/` is committed because it is the app-ready processed dataset.
- The processing result can be regenerated with:

```bash
./scripts/download_leaderboard_dataset.sh
python scripts/preprocess_leaderboard.py
```
