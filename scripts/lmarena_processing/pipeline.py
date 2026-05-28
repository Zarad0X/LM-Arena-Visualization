from __future__ import annotations

from .aggregations import (
    build_arena_summary,
    build_date_category_counts,
    build_manifest,
    build_model_profiles_latest,
    build_org_summary_latest,
    build_rank_timeseries_top,
    missing_value_report,
)
from .config import Paths
from .io import discover_arenas, frame_to_records, load_dataset, write_json
from .report import write_profile_doc


def run_preprocess(paths: Paths, top_k: int, indent: int) -> None:
    paths.out_dir.mkdir(parents=True, exist_ok=True)
    paths.docs_dir.mkdir(parents=True, exist_ok=True)

    arenas = discover_arenas(paths.raw_dir)
    full, latest = load_dataset(paths, arenas)

    arena_summary = build_arena_summary(full, latest)
    manifest = build_manifest(full, latest, arena_summary)

    write_json(paths.out_dir / "manifest.json", manifest, indent)
    write_json(paths.out_dir / "arena_summary.json", arena_summary, indent)
    write_json(paths.out_dir / "latest_leaderboard.json", frame_to_records(latest), indent)
    write_json(
        paths.out_dir / "rank_timeseries_top.json",
        frame_to_records(build_rank_timeseries_top(full, top_k)),
        indent,
    )
    write_json(
        paths.out_dir / "date_category_counts.json",
        frame_to_records(build_date_category_counts(full)),
        indent,
    )
    write_json(
        paths.out_dir / "organization_summary_latest.json",
        frame_to_records(build_org_summary_latest(latest)),
        indent,
    )
    write_json(
        paths.out_dir / "model_profiles_latest.json",
        build_model_profiles_latest(latest),
        indent,
    )
    write_profile_doc(
        paths.docs_dir / "data-profile.md",
        manifest,
        arena_summary,
        missing_value_report(full),
        latest,
    )

    print(f"Processed {len(full):,} full rows and {len(latest):,} latest rows.")
    print(f"Wrote JSON files to {paths.out_dir}")
    print(f"Wrote data profile to {paths.docs_dir / 'data-profile.md'}")

