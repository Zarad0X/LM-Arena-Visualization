#!/usr/bin/env python3
"""CLI entrypoint for preprocessing LMArena leaderboard snapshots."""

from __future__ import annotations

import argparse
from pathlib import Path

from lmarena_processing.config import Paths
from lmarena_processing.pipeline import run_preprocess


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build processed JSON files from LMArena leaderboard parquet snapshots."
    )
    parser.add_argument(
        "--raw-dir",
        default="data/raw/lmarena-leaderboard",
        help="Directory containing downloaded raw parquet files.",
    )
    parser.add_argument(
        "--out-dir",
        default="public/data",
        help="Directory for frontend-ready JSON outputs.",
    )
    parser.add_argument(
        "--docs-dir",
        default="docs",
        help="Directory for generated data profiling markdown.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=10,
        help="Top K models to keep per arena/category/date in rank_timeseries_top.json.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=0,
        help="JSON indentation. Use 0 for compact JSON.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    paths = Paths(
        raw_dir=Path(args.raw_dir),
        out_dir=Path(args.out_dir),
        docs_dir=Path(args.docs_dir),
    )
    run_preprocess(paths, top_k=args.top_k, indent=args.indent)


if __name__ == "__main__":
    main()
