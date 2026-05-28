# Data Processing

This project uses the Hugging Face dataset `lmarena-ai/leaderboard-dataset`.

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

Main outputs:

- `manifest.json`: dataset-level metadata and output manifest.
- `arena_summary.json`: one row per leaderboard arena.
- `latest_leaderboard.json`: latest snapshot rows across all arenas.
- `rank_timeseries_top.json`: top-K model rows per arena/category/date.
- `date_category_counts.json`: time-series aggregation by arena/category/date.
- `organization_summary_latest.json`: latest organization-level summary.
- `model_profiles_latest.json`: latest per-model profiles for detail panels.

