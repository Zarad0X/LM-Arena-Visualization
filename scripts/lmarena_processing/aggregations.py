from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd

from .config import DATASET_NAME, OUTPUT_FILES, SOURCE_URL
from .io import clean_json_value, date_to_str, frame_to_records


def build_arena_summary(full: pd.DataFrame, latest: pd.DataFrame) -> list[dict[str, Any]]:
    records = []
    for arena, arena_full in full.groupby("arena", sort=True):
        arena_latest = latest[latest["arena"] == arena]
        dates = arena_full["leaderboard_publish_date"].dropna()
        records.append(
            {
                "arena": arena,
                "full_rows": int(len(arena_full)),
                "latest_rows": int(len(arena_latest)),
                "date_start": date_to_str(dates.min()) if not dates.empty else None,
                "date_end": date_to_str(dates.max()) if not dates.empty else None,
                "snapshot_count": int(dates.nunique()),
                "model_count_full": int(arena_full["model_name"].nunique()),
                "model_count_latest": int(arena_latest["model_name"].nunique()),
                "organization_count_full": int(arena_full["organization"].nunique()),
                "category_count_full": int(arena_full["category"].nunique()),
                "categories": sorted(arena_full["category"].dropna().unique().tolist()),
            }
        )
    return records


def build_manifest(
    full: pd.DataFrame,
    latest: pd.DataFrame,
    arena_summary: list[dict[str, Any]],
) -> dict[str, Any]:
    dates = full["leaderboard_publish_date"].dropna()
    latest_dates = latest["leaderboard_publish_date"].dropna()
    return {
        "dataset": DATASET_NAME,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_url": SOURCE_URL,
        "full_rows": int(len(full)),
        "latest_rows": int(len(latest)),
        "arena_count": int(full["arena"].nunique()),
        "model_count_full": int(full["model_name"].nunique()),
        "model_count_latest": int(latest["model_name"].nunique()),
        "organization_count_full": int(full["organization"].nunique()),
        "category_count_full": int(full["category"].nunique()),
        "date_start": date_to_str(dates.min()) if not dates.empty else None,
        "date_end": date_to_str(dates.max()) if not dates.empty else None,
        "latest_snapshot_date": date_to_str(latest_dates.max()) if not latest_dates.empty else None,
        "arenas": arena_summary,
        "outputs": OUTPUT_FILES,
    }


def build_rank_timeseries_top(full: pd.DataFrame, top_k: int) -> pd.DataFrame:
    sorted_frame = full.sort_values(
        ["arena", "category", "leaderboard_publish_date", "rank", "rating"],
        ascending=[True, True, True, True, False],
    )
    top = sorted_frame.groupby(
        ["arena", "category", "leaderboard_publish_date"],
        dropna=False,
        sort=False,
    ).head(top_k)
    return top[_rank_columns()].reset_index(drop=True)


def build_date_category_counts(full: pd.DataFrame) -> pd.DataFrame:
    out = full.groupby(
        ["arena", "leaderboard_publish_date", "category"],
        dropna=False,
    ).agg(
        row_count=("model_name", "size"),
        model_count=("model_name", "nunique"),
        organization_count=("organization", "nunique"),
        avg_rating=("rating", "mean"),
        max_rating=("rating", "max"),
        min_rank=("rank", "min"),
        total_votes=("vote_count", "sum"),
        avg_confidence_width=("confidence_width", "mean"),
    ).reset_index()
    return out.sort_values(["arena", "leaderboard_publish_date", "category"])


def build_org_summary_latest(latest: pd.DataFrame) -> pd.DataFrame:
    out = latest.groupby(["arena", "organization"], dropna=False).agg(
        model_rows=("model_name", "size"),
        unique_models=("model_name", "nunique"),
        category_count=("category", "nunique"),
        best_rank=("rank", "min"),
        avg_rating=("rating", "mean"),
        max_rating=("rating", "max"),
        total_votes=("vote_count", "sum"),
    ).reset_index()
    return out.sort_values(["arena", "best_rank", "organization"])


def build_model_profiles_latest(latest: pd.DataFrame) -> list[dict[str, Any]]:
    profiles = []
    for model_name, model_frame in latest.groupby("model_name", sort=True):
        best_row = model_frame.sort_values(["rank", "rating"], ascending=[True, False]).iloc[0]
        records = model_frame.sort_values(["arena", "category", "rank"])[_profile_columns()]
        profiles.append(_model_profile(model_name, model_frame, best_row, records))
    return profiles


def missing_value_report(frame: pd.DataFrame) -> list[dict[str, Any]]:
    columns = [
        "model_name", "organization", "license", "rating",
        "vote_count", "rank", "category", "leaderboard_publish_date",
    ]
    return [
        {
            "column": column,
            "missing": int(frame[column].isna().sum()),
            "missing_rate": frame[column].isna().sum() / len(frame) if len(frame) else 0,
        }
        for column in columns
    ]


def _model_profile(model_name: str, frame: pd.DataFrame, best_row: pd.Series, records: pd.DataFrame) -> dict[str, Any]:
    return {
        "model_name": model_name,
        "organization": clean_json_value(best_row["organization"]),
        "license": clean_json_value(best_row["license"]),
        "best_rank": clean_json_value(best_row["rank"]),
        "best_arena": clean_json_value(best_row["arena"]),
        "best_category": clean_json_value(best_row["category"]),
        "arena_count": int(frame["arena"].nunique()),
        "category_count": int(frame["category"].nunique()),
        "row_count": int(len(frame)),
        "avg_rating": clean_json_value(frame["rating"].mean()),
        "max_rating": clean_json_value(frame["rating"].max()),
        "total_votes": clean_json_value(frame["vote_count"].sum()),
        "records": frame_to_records(records),
    }


def _rank_columns() -> list[str]:
    return [
        "arena", "category", "leaderboard_publish_date", "model_name",
        "organization", "license", "rank", "rating", "rating_lower",
        "rating_upper", "confidence_width", "variance", "vote_count",
    ]


def _profile_columns() -> list[str]:
    return [
        "arena", "category", "rank", "rating", "rating_lower",
        "rating_upper", "confidence_width", "vote_count",
    ]

