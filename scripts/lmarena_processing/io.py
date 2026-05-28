from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from .config import NUMERIC_COLUMNS, RAW_COLUMNS, TEXT_COLUMNS, Paths


def discover_arenas(raw_dir: Path) -> list[str]:
    if not raw_dir.exists():
        raise FileNotFoundError(
            f"Raw data directory does not exist: {raw_dir}. "
            "Run scripts/download_leaderboard_dataset.sh first."
        )
    arenas = sorted(
        path.name
        for path in raw_dir.iterdir()
        if path.is_dir() and (path / "full-00000-of-00001.parquet").exists()
    )
    if not arenas:
        raise FileNotFoundError(f"No arena parquet files found under {raw_dir}.")
    return arenas


def read_split(raw_dir: Path, arena: str, split: str) -> pd.DataFrame:
    file_path = raw_dir / arena / f"{split}-00000-of-00001.parquet"
    if not file_path.exists():
        return pd.DataFrame(columns=["arena", "split", *RAW_COLUMNS])

    frame = pd.read_parquet(file_path)
    missing = [column for column in RAW_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"{file_path} is missing columns: {missing}")

    frame = frame[RAW_COLUMNS].copy()
    frame.insert(0, "split", split)
    frame.insert(0, "arena", arena)
    normalize_frame(frame)
    return frame


def normalize_frame(frame: pd.DataFrame) -> None:
    for column in TEXT_COLUMNS:
        frame[column] = frame[column].fillna("unknown").astype(str)

    frame["leaderboard_publish_date"] = pd.to_datetime(
        frame["leaderboard_publish_date"], errors="coerce"
    ).dt.date

    for column in NUMERIC_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    frame["confidence_width"] = frame["rating_upper"] - frame["rating_lower"]


def load_dataset(paths: Paths, arenas: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    full_frames = []
    latest_frames = []
    for arena in arenas:
        full_frames.append(read_split(paths.raw_dir, arena, "full"))
        latest_frames.append(read_split(paths.raw_dir, arena, "latest"))
    return (
        pd.concat(full_frames, ignore_index=True),
        pd.concat(latest_frames, ignore_index=True),
    )


def date_to_str(value: Any) -> str | None:
    if pd.isna(value):
        return None
    return str(value)


def clean_json_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def frame_to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    out = frame.copy()
    if "leaderboard_publish_date" in out.columns:
        out["leaderboard_publish_date"] = out["leaderboard_publish_date"].map(date_to_str)
    records = out.to_dict(orient="records")
    return [
        {key: clean_json_value(value) for key, value in record.items()}
        for record in records
    ]


def write_json(path: Path, payload: Any, indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        payload,
        ensure_ascii=False,
        indent=None if indent == 0 else indent,
        separators=(",", ":") if indent == 0 else None,
    )
    path.write_text(text + "\n", encoding="utf-8")

