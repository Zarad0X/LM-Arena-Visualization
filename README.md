# LM Arena Visualization

Visual analytics project for exploring LMArena leaderboard snapshots across
model families, task arenas, organizations, licenses, ratings, ranks, votes, and
uncertainty intervals.

## Interaction Features (多视图协调与按需详情)

The dashboard is built around a single global selection state so the views
coordinate instead of acting independently:

- **不再折叠的单页布局 (no-fold scroll layout)**: every section renders and is
  visible at once on one scrolling page; the sticky top nav is a scroll-spy that
  jumps to a section and tracks where you are, instead of hiding three of four
  views behind tabs.
- **紧凑冠军摘要 + 领奖台**: the current #1 model and Top-3 remain visible without
  displacing the analytical views; the KPI strip reflects the active filter.
- **排名历史双模式**: one panel switches between an analytical bump chart and a
  presentation-oriented bar-chart race, avoiding duplicate time views.
- **不确定性显式编码**: neutral confidence intervals, vote-sized points, overlap
  markers, and an in-chart legend discourage over-reading tiny rank differences.
- **全局联动高亮 (brushing & linking)**: selecting or hovering a model /
  organization in any chart or the table highlights the same object everywhere
  else and dims the rest, via lightweight CSS class toggling (no re-render).
- **常驻详情抽屉 (details-on-demand)**: clicking any model opens a right-side
  drawer with its metrics and a **per-category rank heatmap** (rank-colored);
  clicking any organization shows its per-arena performance and drill-down to its
  models. Close with the × button, the overlay, or `Esc`.
- **时间轴 brushing**: drag horizontally on the activity timeline or the rank
  evolution chart to select a time window — it is shared across views and updates
  the KPIs; double-click to clear.
- **交互图例 + 十字准线**: in the evolution bump chart, click a legend item to
  hide/show a series (Shift-click to focus it), and hover to get a crosshair that
  summarizes every visible model's rank at that date.
- **交叉过滤 (cross-filter)**: click an arena bar/row in 总览 to switch the whole
  dashboard; click an organization bubble/bar to filter the leaderboard and sync
  the dropdown; rectangle-brush the organization scatter to compare several orgs.
- **机构位置图**: organizations are positioned by model breadth and average rating;
  best rank remains available on demand instead of collapsing many organizations
  onto a single `#1` line.
- **跨视图搜索**: the top search box locates models/orgs across the visible charts
  and table, with a result list to drill into the detail drawer.
- **联动状态栏 (context bar)**: active filters/selections appear as removable
  chips so every coordinated state is visible and individually clearable.

A worked analysis of five non-trivial patterns discoverable through these
interactions is in [docs/case-study.md](docs/case-study.md).

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
