from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


DATASET_NAME = "lmarena-ai/leaderboard-dataset"
SOURCE_URL = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset"

OUTPUT_FILES = [
    "arena_summary.json",
    "latest_leaderboard.json",
    "rank_timeseries_top.json",
    "date_category_counts.json",
    "organization_summary_latest.json",
    "model_profiles_latest.json",
]

RAW_COLUMNS = [
    "model_name",
    "organization",
    "license",
    "rating",
    "rating_lower",
    "rating_upper",
    "variance",
    "vote_count",
    "rank",
    "category",
    "leaderboard_publish_date",
]

NUMERIC_COLUMNS = [
    "rating",
    "rating_lower",
    "rating_upper",
    "variance",
    "vote_count",
    "rank",
]

TEXT_COLUMNS = [
    "arena",
    "split",
    "model_name",
    "organization",
    "license",
    "category",
]


@dataclass(frozen=True)
class Paths:
    raw_dir: Path
    out_dir: Path
    docs_dir: Path

