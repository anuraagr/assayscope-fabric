"""Additional real-browser acceptance for integrated laboratory research workflows."""

import csv
import json
import re
import zipfile
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect


def verify_lab_flows(page, server, screenshots, report_dir):
    results = []

    def passed(name, detail):
        results.append({"name": name, "status": "Pass", "evidence": detail})
        print(f"Lab workflow: {name} | Pass | {detail}")

    page.get_by_role("checkbox", name="Exclude QC flagged wells", exact=True).check()
    expect(page.get_by_test_id("included-count")).to_have_text("85")
    page.get_by_role("button", name="Study overview", exact=True).click()
    study = page.get_by_role("region", name="Study overview")
    expect(study.get_by_text("Denominator available", exact=True)).to_have_count(2)
    expect(study.locator(".lab-run-card")).to_have_count(2)
    expect(study).to_contain_text("Not established: simulated acquisition runs")
    page.screenshot(path=str(screenshots / "study-overview.png"))
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="Export study review", exact=True).click()
    study_path = report_dir / "verified-study-review.zip"
    downloaded.value.save_as(study_path)
    with zipfile.ZipFile(study_path) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["rowCount"] == 2
        assert all(row["included"] == 85 and row["controls"] == 22 for row in manifest["records"])
        assert manifest["dataOrigin"] == "Simulated screening experiment"
    passed("study-controls", "Both runs' real adapter results, vehicle counts and study packet agree.")

    page.get_by_role("button", name="Measurements", exact=True).click()
    explorer = page.get_by_role("region", name="Measurement explorer")
    expect(page.get_by_test_id("explorer-matched")).to_have_text("96")
    page.get_by_role("combobox", name="Explorer inclusion", exact=True).select_option("excluded")
    expect(page.get_by_test_id("explorer-matched")).to_have_text("11")
    page.get_by_role("combobox", name="Y measurement", exact=True).select_option("spheroidVolumeUm3")
    expect(explorer.locator(".measurement-plot [role=button]")).to_have_count(1)
    expect(explorer).to_contain_text("10 missing / not estimable")
    page.get_by_role("combobox", name="Y measurement", exact=True).select_option("normalized")
    page.screenshot(path=str(screenshots / "measurement-explorer.png"))
    page.get_by_role("textbox", name="Search measurements", exact=True).fill("F11")
    expect(page.get_by_test_id("explorer-matched")).to_have_text("1")
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="Export filtered measurements", exact=True).click()
    measurements_path = report_dir / "verified-filtered-measurements.zip"
    downloaded.value.save_as(measurements_path)
    with zipfile.ZipFile(measurements_path) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["rowCount"] == 1
        row = manifest["records"][0]
        assert row["wellId"] == "run1-F11" and row["inclusion"] == "excluded"
        assert 25 < row["yValue"] < 27 and row["xMetric"] == "focusScore"
        assert len(row["sourceSha256"]) == 64
    page.get_by_role("button", name="Inspect measurement run1-F11", exact=True).press("Enter")
    expect(page.get_by_test_id("volume-primary")).to_have_attribute("data-asset", "run1-F11-volume")
    passed("measurement-explorer", "Metric/filter changes use real values, missing volumes remain missing, keyboard points navigate, and filtered export matches.")

    page.get_by_role("button", name="Run comparison", exact=True).click()
    comparison = page.get_by_role("table", name="Condition comparison across runs")
    expect(comparison.locator("tbody tr")).to_have_count(24)
    cygnus = comparison.locator("tbody tr").filter(has_text="Cygnus-09").filter(
        has=page.get_by_text("10 µM", exact=True))
    expect(cygnus).to_contain_text("0 / 3")
    expect(cygnus).to_contain_text("Not estimable")
    page.screenshot(path=str(screenshots / "run-comparison.png"))
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="Export comparison", exact=True).click()
    comparison_path = report_dir / "verified-run-comparison.zip"
    downloaded.value.save_as(comparison_path)
    with zipfile.ZipFile(comparison_path) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert all(row["leftTechnicalN"] <= 3 and row["rightTechnicalN"] <= 3 for row in manifest["records"])
        row = next(row for row in manifest["records"] if row["compound"] == "Cygnus-09" and row["doseUm"] == 10)
        assert row["differencePercentagePoints"] is None
    passed("run-comparison", "24 conditions retain separate run denominators/n/SD; non-estimable comparisons remain null in exports.")

    page.get_by_role("button", name="Preview QC scenario", exact=True).click()
    scenario = page.get_by_test_id("scenario-result")
    expect(scenario).to_contain_text("96 included")
    expect(scenario).to_contain_text("85 included")
    expect(scenario).to_contain_text("11 wells change inclusion")
    scenario.scroll_into_view_if_needed()
    page.screenshot(path=str(screenshots / "qc-scenario.png"))
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="Export scenario", exact=True).click()
    scenario_path = report_dir / "verified-qc-scenario.zip"
    downloaded.value.save_as(scenario_path)
    with zipfile.ZipFile(scenario_path) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["options"]["excludeQC"] is True
        assert manifest["detail"]["candidate"]["excludeQC"] is False
        assert manifest["detail"]["baselineControlMedian"] != manifest["detail"]["candidateControlMedian"]
        row = next(row for row in manifest["records"] if row["wellId"] == "run1-F11")
        assert row["baselineIncluded"] is False and row["candidateIncluded"] is True
        assert row["originalIntegratedSignalAdu"] > 0
    page.get_by_role("button", name="Apply candidate to view", exact=True).click()
    expect(page.get_by_test_id("included-count")).to_have_text("96")
    page.get_by_role("button", name="Share view", exact=True).click()
    link = page.get_by_role("textbox", name="Shareable view link", exact=True).input_value()
    query = parse_qs(urlparse(link).query)
    assert query["surface"] == ["runs"] and query["excludeQC"] == ["0"]
    restored = page.context.new_page()
    restored.goto(link, wait_until="networkidle")
    expect(restored.get_by_role("heading", name="Run comparison", exact=True)).to_be_visible()
    expect(restored.get_by_test_id("included-count")).to_have_text("96")
    restored.close()
    page.get_by_role("spinbutton", name="Scenario minimum focus", exact=True).fill("0.9")
    page.get_by_role("checkbox", name="Scenario exclude flagged wells", exact=True).check()
    page.get_by_role("button", name="Preview QC scenario", exact=True).click()
    expect(scenario).to_contain_text("0 included")
    expect(scenario).to_contain_text("Not estimable")
    page.get_by_role("checkbox", name="Exclude QC flagged wells", exact=True).check()
    expect(page.get_by_test_id("included-count")).to_have_text("85")
    expect(scenario).to_have_count(0)
    passed("qc-scenarios", "Explicit previews compare actual recalculations, export both scopes, preserve originals, handle zero controls and restore shared QC/surface.")

    page.get_by_role("button", name="Review queue", exact=True).click()
    queue = page.get_by_role("region", name="Research review queue")
    expect(queue.get_by_role("table", name="Review queue records").locator("tbody tr")).to_have_count(21)
    page.get_by_role("combobox", name="Review queue filter", exact=True).select_option("Repeat acquisition")
    expect(queue.get_by_role("table", name="Review queue records").locator("tbody tr")).to_have_count(1)
    page.get_by_role("checkbox", name="Select review run1-F11", exact=True).check()
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="Export repeat worksheet", exact=True).click()
    repeat_path = report_dir / "verified-repeat-acquisition.csv"
    downloaded.value.save_as(repeat_path)
    with repeat_path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 1 and rows[0]["wellId"] == "run1-F11"
    assert rows[0]["decision"] == "Repeat acquisition"
    assert rows[0]["dataOrigin"] == "Simulated screening experiment"
    assert "no external task" in rows[0]["worksheetStatus"]
    assert "Low focus confounds" in rows[0]["rationale"]
    assert len(rows[0]["sourceSha256"]) == 64
    page.screenshot(path=str(screenshots / "review-queue.png"))
    page.get_by_role("combobox", name="Review queue filter", exact=True).select_option("Needs review")
    page.get_by_role("textbox", name="Search review queue", exact=True).fill("run1-F10")
    page.get_by_role("button", name="Review rationale", exact=True).click()
    page.get_by_role("textbox", name="Decision rationale", exact=True).fill("Review queue follow-up: inspect the original focus evidence.")
    page.get_by_role("button", name="Save review", exact=True).click()
    expect(page.get_by_text("Saved on this computer", exact=True)).to_be_visible()
    expect(queue).to_contain_text("No fields match this queue")
    page.reload(wait_until="networkidle")
    page.get_by_role("combobox", name="Review queue filter", exact=True).select_option("Investigate")
    expect(page.get_by_role("table", name="Review queue records")).to_contain_text("Review queue follow-up")
    page.route("**/api/reviews", lambda route: route.fulfill(status=403, content_type="application/json",
                                                           body=json.dumps({"detail": "Denied"})))
    page.get_by_role("button", name="Refresh reviews", exact=True).click()
    expect(queue.get_by_role("alert")).to_contain_text("Permission denied")
    expect(queue.get_by_role("table", name="Review queue records")).to_have_count(0)
    page.unroute("**/api/reviews")
    page.get_by_role("button", name="Refresh reviews", exact=True).click()
    expect(page.get_by_role("table", name="Review queue records")).to_contain_text("Review queue follow-up")
    passed("persistent-review-queue", "Saved decisions refresh the queue, persist after reload, generate traceable repeat worksheets, and denied reads do not become an empty queue.")

    page.get_by_role("button", name="Lab context", exact=True).click()
    expect(page.get_by_test_id("missing-lab-context")).to_contain_text("run1-F10")
    context = page.get_by_role("region", name="Lab context")
    context.get_by_role("button", name="run1-F11", exact=True).click()
    expect(context.locator(".context-record")).to_contain_text("EXAMPLE-002")
    expect(context.locator(".context-record")).to_contain_text("SIM-HCS-01 / 1")
    expect(context).to_contain_text("No live LIMS or ELN connection")
    page.screenshot(path=str(screenshots / "lab-context.png"))
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="Export context snapshot", exact=True).click()
    context_path = report_dir / "verified-lab-context.json"
    downloaded.value.save_as(context_path)
    snapshot = json.loads(context_path.read_text())
    assert snapshot["snapshot"]["connectionState"] == "example-only"
    assert len(snapshot["snapshot"]["records"]) == 4
    page.route("**/api/lab-context", lambda route: route.fulfill(status=403, content_type="application/json",
                                                               body=json.dumps({"detail": "Denied"})))
    page.get_by_role("button", name="Refresh context", exact=True).click()
    expect(context.get_by_role("alert")).to_contain_text("Permission denied")
    expect(context.get_by_role("table", name="Lab context mappings")).to_have_count(0)
    page.unroute("**/api/lab-context")
    page.get_by_role("button", name="Refresh context", exact=True).click()
    expect(context.get_by_role("table", name="Lab context mappings").locator("tbody tr")).to_have_count(4)
    passed("lab-context", "Exact source/protocol/example joins, missing mappings, snapshot export and denied-source behavior are verified.")

    page.get_by_role("button", name="Lab quality", exact=True).click()
    spatial = page.get_by_role("group", name="Spatial plate values")
    expect(spatial.get_by_role("button")).to_have_count(96)
    page.get_by_role("checkbox", name="Spatial controls only", exact=True).check()
    expect(spatial.locator("button:enabled")).to_have_count(24)
    page.get_by_role("region", name="Plate spatial diagnostics").scroll_into_view_if_needed()
    page.screenshot(path=str(screenshots / "spatial-qc.png"))
    spatial.get_by_role("button", name=re.compile(r"^Spatial run1 H11:")).click()
    expect(page.get_by_test_id("image-view")).to_have_attribute("data-asset", "run1-H11")
    passed("spatial-qc", "96 source-linked cells, control-only selection, included-value row/edge summaries and actual source navigation.")

    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Measurements", exact=True).click()
    expect(page.get_by_role("heading", name="Measurement explorer", exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Lab layout overflows the mobile viewport."
    page.get_by_role("heading", name="Measurement explorer", exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(report_dir / "lab-mobile.png"))
    page.set_viewport_size({"width": 1440, "height": 900})
    assert page.request.get(server.url + "/api/reviews").status == 200
    return results
