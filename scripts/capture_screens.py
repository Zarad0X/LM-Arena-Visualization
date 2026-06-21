#!/usr/bin/env python3
"""Drive the live LM Arena dashboard and capture presentation screenshots.

Requires a local server running at BASE (python3 -m http.server in public/).
Outputs PNGs into docs/img/. All interaction functions in app.js are global,
so we set analytic states by calling them through page.evaluate.
"""
import os
import pathlib
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8011/index.html"
CHROME = os.path.expanduser(
    "~/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "img"
OUT.mkdir(parents=True, exist_ok=True)


def shot(page, selector, name, pad_settle=350):
    page.wait_for_timeout(pad_settle)
    el = page.query_selector(selector)
    if not el:
        print(f"  !! missing {selector} for {name}")
        return
    el.screenshot(path=str(OUT / name))
    print(f"  ok {name}")


def run():
    with sync_playwright() as p:
        launch_kw = {"executable_path": CHROME} if os.path.exists(CHROME) else {}
        browser = p.chromium.launch(**launch_kw)
        ctx = browser.new_context(
            viewport={"width": 1680, "height": 1050},
            device_scale_factor=2,
        )
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        # wait until data finished loading (status pill flips to snapshot date)
        page.wait_for_function(
            "document.querySelector('#dataStatus') && "
            "document.querySelector('#dataStatus').textContent.includes('快照')",
            timeout=30000,
        )
        page.wait_for_timeout(1600)  # let count-up + first render settle

        # de-stick top bars so element screenshots of lower tiles don't get the
        # sticky toolbar/contextbar painted over their top edge.
        page.add_style_tag(content=(
            ".topbar,.toolbar,.context-bar{position:static !important;}"
        ))

        # --- full top band: branding + toolbar + task guide + hero ---
        page.evaluate("window.scrollTo(0,0)")
        page.screenshot(path=str(OUT / "00-hero-full.png"),
                        clip={"x": 0, "y": 0, "width": 1680, "height": 1050})
        print("  ok 00-hero-full.png")

        shot(page, "#hero", "01-podium.png")
        shot(page, ".analysis-guide", "02-task-guide.png")
        shot(page, "#kpiGrid", "03-kpi.png")

        # --- Case 2: uncertainty / confidence intervals on leaderboard ---
        page.evaluate("applyCasePreset('uncertainty'); closeDrawer();")
        shot(page, ".t-leaderboard", "04-leaderboard-uncertainty.png", 700)
        shot(page, ".t-table", "15-table.png", 300)

        # --- Case 1: frontier churn — bump chart + race ---
        page.evaluate("applyCasePreset('frontier'); closeDrawer();")
        page.wait_for_timeout(700)
        shot(page, ".t-evolution", "05-evolution.png", 500)
        # mid-race frame so rows are visibly reordering
        page.evaluate(
            "(()=>{const n=race.dates.length; if(n){race.frame=Math.floor(n*0.62);"
            "els.raceScrub.value=race.frame; drawRaceFrame();}})()"
        )
        shot(page, ".t-race", "06-race.png", 600)
        shot(page, ".t-timeline", "07-timeline.png")

        # --- Case 4: organization landscape ---
        page.evaluate("applyCasePreset('org');")
        page.wait_for_timeout(500)
        shot(page, "#contextBar", "14-context-bar.png", 200)
        page.evaluate("closeDrawer();")
        shot(page, ".t-scatter", "08-org-scatter.png", 500)
        shot(page, ".t-orgbars", "09-org-bars.png")
        shot(page, ".t-arena", "10-arena-bars.png")
        # org drill-down drawer (google) — render directly to avoid the
        # setFocusOrg toggle (preset already set organization=google).
        page.evaluate(
            "state.focusOrg='google'; renderOrgDrawer('google'); openDrawer(); applyLinking();"
        )
        shot(page, "#detailDrawer", "11-drawer-org.png", 600)
        page.evaluate("closeDrawer()")

        # --- Case 5: per-model cross-category specialization (heatlist) ---
        # auto-pick a high-variance model: many records, large rank spread.
        model = page.evaluate(
            """(()=>{
                let best=null, bestSpread=-1;
                for(const pr of (data.profiles||[])){
                    const recs=pr.records||[];
                    if(recs.length<12) continue;
                    const ranks=recs.map(r=>r.rank).filter(x=>x!=null);
                    if(ranks.length<12) continue;
                    const spread=Math.max(...ranks)-Math.min(...ranks);
                    if((pr.total_votes||0)<5000) continue;
                    if(spread>bestSpread){bestSpread=spread; best=pr.model_name;}
                }
                return best;
            })()"""
        )
        print(f"  drawer model = {model}")
        if model:
            page.evaluate("applyCasePreset('frontier'); closeDrawer();")
            page.wait_for_timeout(400)
            page.evaluate(f"setFocusModel({model!r})")
            shot(page, "#detailDrawer", "12-drawer-model.png", 600)
            # brushing & linking: model focused -> leftmost leaderboard tile shows
            # is-focus/is-dim highlight (drawer sits on the right, no overlap)
            shot(page, ".t-leaderboard", "13-linking-leaderboard.png", 300)
            page.evaluate("closeDrawer()")

        browser.close()
        print("DONE")


if __name__ == "__main__":
    run()
