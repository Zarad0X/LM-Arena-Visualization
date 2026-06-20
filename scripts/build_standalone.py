#!/usr/bin/env python3
"""Build a single self-contained HTML file (CSS + JS + data inlined).

The dashboard normally fetch()es JSON from public/data, which the browser blocks
under file://. This bundles everything into one HTML so it opens by double-click,
no local server needed.

Usage:  python3 scripts/build_standalone.py
Output: dist/lm-arena-standalone.html
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
OUT = ROOT / "dist" / "lm-arena-standalone.html"

# DATA key in app.js  ->  json filename
DATASETS = {
    "manifest": "manifest.json",
    "arenaSummary": "arena_summary.json",
    "latest": "latest_leaderboard.json",
    "rankSeries": "rank_timeseries_top.json",
    "activity": "date_category_counts.json",
    "organizations": "organization_summary_latest.json",
    "profiles": "model_profiles_latest.json",
}


def read(path):
    return path.read_text(encoding="utf-8")


def safe_json(text):
    # JSON embedded in <script type="application/json"> must not contain the
    # literal </script>; escaping "</" as "<\/" is valid JSON and HTML-safe.
    return text.replace("</", "<\\/")


def main():
    html = read(PUBLIC / "index.html")
    css = read(PUBLIC / "styles.css")
    theme_css = read(PUBLIC / "themes.css")
    theme_js = read(PUBLIC / "theme.js")
    js = read(PUBLIC / "app.js")

    # build the inlined data blocks + a bootstrap that parses them
    blocks = []
    boot = ["window.__LMARENA_DATA__ = {"]
    total = 0
    for key, fname in DATASETS.items():
        raw = read(DATA / fname)
        total += len(raw)
        blocks.append(
            f'<script type="application/json" id="d-{key}">{safe_json(raw)}</script>'
        )
        boot.append(f'  {key}: JSON.parse(document.getElementById("d-{key}").textContent),')
    boot.append("};")
    data_section = "\n".join(blocks) + "\n<script>\n" + "\n".join(boot) + "\n</script>"

    # inline CSS: replace the external stylesheet link
    html = re.sub(
        r'<link rel="stylesheet" href="\./styles\.css"[^>]*/>',
        f"<style>\n{css}\n</style>",
        html,
    )
    html = re.sub(
        r'<link rel="stylesheet" href="\./themes\.css"[^>]*/>',
        f"<style>\n{theme_css}\n</style>",
        html,
    )
    html = html.replace(
        '<script src="./theme.js"></script>',
        f"<script>\n{theme_js}\n</script>",
    )

    # replace the external script with: data blocks + bootstrap + app.js
    html = html.replace(
        '<script src="./app.js"></script>',
        f"{data_section}\n<script>\n{js}\n</script>",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    size_mb = OUT.stat().st_size / 1_048_576
    print(f"wrote {OUT}  ({size_mb:.1f} MB, data {total/1_048_576:.1f} MB)")


if __name__ == "__main__":
    main()
