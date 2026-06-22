# LM Arena Visualization

Visual analytics project for exploring LMArena leaderboard snapshots across
model families, task arenas, organizations, licenses, ratings, ranks, votes, and
uncertainty intervals.

## Environment and Startup

### Required environment

| Component | Version | Purpose |
| --- | --- | --- |
| **Node.js** | **24.14.0** | Recommended and tested runtime for serving the frontend. |
| Python | 3.10 or newer | Required only when reproducing the data-processing pipeline. |
| Browser | Current Chrome, Edge, Firefox, or Safari | Runs the visual analytics system. |

The frontend is a static application and has no npm dependencies. If `nvm` is
available, select the pinned Node.js version from the repository root:

```bash
nvm install
nvm use
node --version  # v24.14.0
```

Start the system from the repository root:

```bash
npx --yes serve@14.2.5 public -l 8000
```

Then open <http://localhost:8000/>. No backend service or database is required;
the browser reads the processed JSON files under `public/data/`.

If Node.js is unavailable, the equivalent Python static server can be used:

```bash
python3 -m http.server 8000 --directory public
```

### Optional data-processing environment

Only configure this environment when the processed JSON needs to be regenerated:

```bash
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## Interaction Features (多视图协调与按需详情)

The dashboard is built around a single global selection state so the views
coordinate instead of acting independently:

- **不再折叠的单页布局 (no-fold scroll layout)**: every section renders and is
  visible at once on one scrolling page; the sticky top nav is a scroll-spy that
  jumps to a section and tracks where you are, instead of hiding three of four
  views behind tabs.
- **冠军 Hero + 领奖台 (headline podium)**: the current #1 model and a gold / silver /
  bronze Top-3 podium sit at the top with a count-up rating, surfacing the
  headline rather than burying it; click any podium slot to open its details.
- **排名竞速 (bar-chart race)**: a play / scrub transport animates the Top-12
  models' ratings across every snapshot date with smooth row reordering — click a
  bar for details, drag the scrubber to any date, pick 1× / 2× / 4× speed.
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
