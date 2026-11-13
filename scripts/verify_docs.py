"""Render the generated diagrams and read-only research report in a real headless browser."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edge", action="store_true", help="Use installed Microsoft Edge.")
    args = parser.parse_args()
    output = ROOT / "test-results" / "documentation"
    output.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "test-results" / "research" / "research-review.html"
    if not report_path.is_file():
        raise SystemExit("Run python -m research.review before documentation acceptance.")
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel="msedge" if args.edge else None)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            for name in ("architecture", "research-workflow", "data-lineage", "knowledge-context"):
                svg = ROOT / "docs" / "diagrams" / f"{name}.svg"
                page.goto(svg.as_uri(), wait_until="networkidle")
                assert page.locator("svg > title").text_content()
                assert page.locator("svg > desc").text_content()
                overflow = page.locator("g[data-node-id]").evaluate_all("""groups => groups.flatMap(group => {
                    const box = group.querySelector('rect').getBBox();
                    return [...group.querySelectorAll('text')].filter(text => {
                        const b = text.getBBox();
                        return b.x < box.x + 5 || b.x + b.width > box.x + box.width - 5
                            || b.y < box.y + 5 || b.y + b.height > box.y + box.height - 5;
                    }).map(text => ({node: group.dataset.nodeId, text: text.textContent}));
                })""")
                assert not overflow, f"{name} has clipped/overflowing labels: {overflow}"
                page.locator("svg").screenshot(path=str(output / f"{name}.png"))
                editable = json.loads(svg.with_suffix(".excalidraw").read_text(encoding="utf-8"))
                ids = [element["id"] for element in editable["elements"]]
                assert len(ids) == len(set(ids))
                assert all(e["width"] > 0 and e["height"] > 0 and e["strokeColor"] == "#000000"
                           for e in editable["elements"] if e["type"] == "text")
                checks.append({"name": name, "result": "Pass", "sha256": hashlib.sha256(svg.read_bytes()).hexdigest()})
            page.goto(report_path.as_uri(), wait_until="networkidle")
            assert page.get_by_role("heading", name="AssayScope research review", exact=True).is_visible()
            assert page.locator("table").count() == 4
            assert page.get_by_role("table", name="Run quality and control dispersion").locator("tbody tr").count() == 2
            conditions = page.get_by_role("table", name="QC exclusion sensitivity by condition and run")
            assert conditions.locator("tbody tr").count() == 48
            cygnus = conditions.locator("tbody tr").filter(has_text="run1").filter(has_text="Cygnus-09")
            assert any("Not estimable" in value for value in cygnus.all_inner_texts())
            assert page.get_by_role("table", name="Wells requiring image review; no review decision is written").locator("tbody tr").count() == 22
            page.screenshot(path=str(ROOT / "docs" / "screenshots" / "research-review.png"), full_page=False)
            page.get_by_text("Source-image lineage", exact=True).click()
            assert page.get_by_role("table", name="Source lineage for every technical well").locator("tbody tr").count() == 192
            page.set_viewport_size({"width": 390, "height": 844})
            page.reload(wait_until="networkidle")
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path=str(output / "research-mobile.png"), full_page=True)
            assert not errors, errors
            checks.append({"name": "research-report", "result": "Pass",
                           "sha256": hashlib.sha256(report_path.read_bytes()).hexdigest(),
                           "conditionRows": 48, "flaggedRows": 22, "lineageRows": 192,
                           "viewports": [[1440, 1000], [390, 844]]})
            result = {"executedAt": datetime.now(timezone.utc).isoformat(),
                      "browser": browser.version, "headless": True, "checks": checks,
                      "scope": "Local rendered SVGs and research HTML; not cloud UI or managed-agent testing."}
        finally:
            browser.close()
    (output / "acceptance.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Documentation acceptance passed: {len(checks)} checks; browser {result['browser']}.")


if __name__ == "__main__":
    main()
