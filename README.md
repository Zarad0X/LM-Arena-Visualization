# LM Arena Visualization

Visual analytics project for exploring LMArena leaderboard snapshots across
model families, task arenas, organizations, licenses, ratings, ranks, votes, and
uncertainty intervals.

## Data Source

This project uses the Hugging Face dataset
[`lmarena-ai/leaderboard-dataset`](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset),
licensed under CC BY 4.0.

Raw files are reproducible and are not committed to git. Processed frontend JSON
files are stored in `public/data/`.

## Reproduce Data Processing

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

./scripts/download_leaderboard_dataset.sh
python scripts/preprocess_leaderboard.py
```

This downloads raw parquet files into `data/raw/lmarena-leaderboard/`, then
generates:

```text
public/data/
├── manifest.json
├── arena_summary.json
├── latest_leaderboard.json
├── rank_timeseries_top.json
├── date_category_counts.json
├── organization_summary_latest.json
└── model_profiles_latest.json
```

It also writes the data profile report:

```text
docs/data-profile.md
```

For more details, see [docs/data-processing.md](docs/data-processing.md).

