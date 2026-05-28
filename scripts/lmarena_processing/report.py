from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


def write_profile_doc(
    path: Path,
    manifest: dict[str, Any],
    arena_summary: list[dict[str, Any]],
    full_missing: list[dict[str, Any]],
    latest: pd.DataFrame,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = _profile_markdown(manifest, arena_summary, full_missing, latest)
    path.write_text(content, encoding="utf-8")


def _profile_markdown(
    manifest: dict[str, Any],
    arena_summary: list[dict[str, Any]],
    full_missing: list[dict[str, Any]],
    latest: pd.DataFrame,
) -> str:
    return f"""# LMArena Leaderboard Data Profile

Generated at: `{manifest["generated_at"]}`

Source dataset: `{manifest["dataset"]}`  
Source URL: {manifest["source_url"]}

## Overall

- Full rows: {manifest["full_rows"]:,}
- Latest rows: {manifest["latest_rows"]:,}
- Arena count: {manifest["arena_count"]}
- Full model count: {manifest["model_count_full"]:,}
- Latest model count: {manifest["model_count_latest"]:,}
- Organization count: {manifest["organization_count_full"]:,}
- Category count: {manifest["category_count_full"]:,}
- Date range: {manifest["date_start"]} to {manifest["date_end"]}
- Latest snapshot date: {manifest["latest_snapshot_date"]}

## Arena Summary

{markdown_table(_arena_headers(), _arena_rows(arena_summary))}

## Missing Values In Full Data

{markdown_table(["column", "missing", "missing_rate"], _missing_rows(full_missing))}

## Top Organizations In Latest Data

{markdown_table(["organization", "unique_models", "rows", "best_rank"], _top_org_rows(latest))}

## Frontend JSON Outputs

{chr(10).join(f"- `{name}`" for name in manifest["outputs"])}
"""


def markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_format_cell(value) for value in row) + " |")
    return "\n".join(lines)


def _format_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def _arena_headers() -> list[str]:
    return [
        "arena", "full_rows", "latest_rows", "date_start",
        "date_end", "snapshots", "models", "categories",
    ]


def _arena_rows(summary: list[dict[str, Any]]) -> list[list[Any]]:
    return [
        [
            item["arena"],
            item["full_rows"],
            item["latest_rows"],
            item["date_start"],
            item["date_end"],
            item["snapshot_count"],
            item["model_count_full"],
            item["category_count_full"],
        ]
        for item in summary
    ]


def _missing_rows(report: list[dict[str, Any]]) -> list[list[Any]]:
    return [
        [item["column"], item["missing"], item["missing_rate"]]
        for item in report
    ]


def _top_org_rows(latest: pd.DataFrame) -> list[list[Any]]:
    rows = (
        latest.groupby("organization")
        .agg(
            unique_models=("model_name", "nunique"),
            rows=("model_name", "size"),
            best_rank=("rank", "min"),
        )
        .reset_index()
        .sort_values(["best_rank", "unique_models"], ascending=[True, False])
        .head(15)
    )
    return rows[["organization", "unique_models", "rows", "best_rank"]].values.tolist()

