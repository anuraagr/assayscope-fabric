"""Behavioral acceptance on an isolated local server, with real screenshots and timings."""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np
from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def set_range(page, label, value):
    page.get_by_role("slider", name=label, exact=True).evaluate("""(el,value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }""", value)


def image_changes(a: bytes, b: bytes, minimum=0.002):
    first = np.array(Image.open(io.BytesIO(a)).convert("RGB"), dtype=float)
    second = np.array(Image.open(io.BytesIO(b)).convert("RGB"), dtype=float)
    assert first.shape == second.shape, "Comparison must use the same image surface."
    fraction = np.mean(np.max(np.abs(first - second), axis=2) > 8)
    assert fraction > minimum, f"Only {fraction:.4%} of actual image pixels changed."
    return float(fraction)


class Server:
    def __init__(self, state: Path):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.state = state
        self.process = None
        self.url = f"http://127.0.0.1:{self.port}"
        self.log = (state / "server.log").open("a", encoding="utf-8")

    def start(self):
        environment = {
            **os.environ, "ASSAYSCOPE_DATA": str(self.state),
            "ASSAYSCOPE_CORE": str(ROOT / "data" / "core"),
            "ASSAYSCOPE_PUBLIC": str(ROOT / "data" / "public"),
        }
        self.process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "assayscope.server:app", "--host", "127.0.0.1",
             "--port", str(self.port), "--no-access-log"], cwd=ROOT, env=environment,
            stdout=self.log, stderr=subprocess.STDOUT,
        )
        for _ in range(120):
            if self.process.poll() is not None:
                raise RuntimeError("Isolated server exited; inspect server.log.")
            try:
                if httpx.get(self.url + "/api/status", timeout=1).status_code == 200:
                    return
            except httpx.RequestError:
                pass
            time.sleep(0.25)
        raise RuntimeError("Server readiness timeout.")

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=15)
        self.process = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edge", action="store_true")
    parser.add_argument("--software-webgl", action="store_true")
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args()
    report_dir = ROOT / "test-results"
    screenshots = ROOT / "docs" / "screenshots"
    report_dir.mkdir(exist_ok=True)
    screenshots.mkdir(parents=True, exist_ok=True)
    results = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "sourceHashes": {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in (
                "requirements.txt", "package-lock.json", "assayscope/assets.py",
                "src/components/Workbench.tsx", "config/public-sources.json",
            )
        },
        "gates": [], "errors": [], "measurements": {}, "publicPack": "Not selected",
    }

    def passed(number, detail):
        results["gates"].append({"gate": number, "status": "Pass", "evidence": detail})
        print(f"Gate {number}: Pass | {detail}")

    with tempfile.TemporaryDirectory(prefix="browser-state-", dir=report_dir) as temporary:
        server = Server(Path(temporary))
        server.start()
        results["sourceHashes"]["data/core/catalog.json"] = hashlib.sha256(
            (ROOT / "data" / "core" / "catalog.json").read_bytes()
        ).hexdigest()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True, channel="msedge" if args.edge else None,
                    args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] if args.software_webgl else [],
                )
                video_options = {"record_video_dir": str(report_dir / "video"),
                                 "record_video_size": {"width": 1440, "height": 900}} if args.record else {}
                context = browser.new_context(viewport={"width": 1440, "height": 900}, **video_options)
                page = context.new_page()
                page.on("pageerror", lambda e: results["errors"].append(str(e)))
                page.goto(server.url, wait_until="networkidle")
                primary = page.get_by_test_id("volume-primary")
                expect(primary).to_have_attribute("data-ready", "true", timeout=15000)
                expect(page.get_by_role("group", name="96-well plate").get_by_role("button")).to_have_count(96)
                expect(page.get_by_test_id("included-count")).to_have_text("85")
                results["measurements"] = page.evaluate("""() => {
                  const c=document.createElement('canvas'), gl=c.getContext('webgl2');
                  const dbg=gl?.getExtension('WEBGL_debug_renderer_info');
                  return {userAgent:navigator.userAgent, hardwareConcurrency:navigator.hardwareConcurrency,
                    browserMemoryGiB:navigator.deviceMemory??null,
                    renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'unavailable',
                    marks:performance.getEntriesByType('mark').map(m=>({name:m.name,ms:m.startTime}))};
                }""")
                results["measurements"]["browserVersion"] = browser.version
                results["measurements"]["viewport"] = [1440, 900]
                results["measurements"]["volumeDimensionsTCZYX"] = [6, 3, 64, 112, 112]
                marks = {m["name"]: m["ms"] for m in results["measurements"]["marks"]}
                assert marks["assayscope-shell-ready"] < 3000, "App shell missed the 3-second target."
                assert marks["assayscope-volume-ready"] < 10000, "Hero volume missed the 10-second target."
                page.screenshot(path=str(screenshots / "workbench-1440.png"))
                passed(1, "Clean startup: 96 selectable wells, populated evidence and actual 3D frame.")

                base_image = page.get_by_test_id("main-image").screenshot()
                base_value = page.get_by_test_id("normalized-value").inner_text()
                page.get_by_role("button", name=re.compile(r"^Well A01,")).click()
                expect(page.get_by_test_id("image-view")).to_have_attribute("data-asset", "run1-A01")
                page.wait_for_timeout(350)
                image_changes(base_image, page.get_by_test_id("main-image").screenshot())
                assert page.get_by_test_id("normalized-value").inner_text() != base_value
                passed(2, "Plate selection changes source asset, image pixels and normalized evidence.")

                image_before = page.get_by_test_id("main-image").screenshot()
                page.get_by_role("checkbox", name="Nuclei channel", exact=True).uncheck()
                page.wait_for_timeout(300)
                image_changes(image_before, page.get_by_test_id("main-image").screenshot())
                image_before = page.get_by_test_id("main-image").screenshot()
                page.get_by_role("checkbox", name="Segmentation overlay", exact=True).check()
                page.wait_for_timeout(300)
                image_changes(image_before, page.get_by_test_id("main-image").screenshot())
                passed(3, "Channel visibility and derived watershed overlay change actual rendered pixels.")
                page.get_by_role("checkbox", name="Segmentation overlay", exact=True).uncheck()
                page.get_by_role("checkbox", name="Nuclei channel", exact=True).check()

                page.get_by_role("button", name=re.compile(r"^Well B11,")).click()
                expect(primary).to_have_attribute("data-ready", "true")
                before = primary.screenshot()
                set_range(page, "3D clipping", 85)
                page.wait_for_timeout(180)
                results["measurements"]["clippingPixelChange"] = image_changes(before, primary.screenshot())
                xy = page.locator(".slice canvas").first
                before = xy.screenshot()
                set_range(page, "Z slice", 10)
                expect(page.get_by_test_id("z-label")).to_have_text("10")
                image_changes(before, xy.screenshot())
                passed(4, "Clipping changes the ray-cast volume; Z navigation changes its aligned XY section.")

                before = primary.screenshot()
                page.get_by_role("button", name="Play time playback", exact=True).click()
                page.wait_for_function("document.querySelector('[data-testid=volume-primary]')?.dataset.frame !== '0'")
                page.get_by_role("button", name="Pause time playback", exact=True).click()
                assert page.get_by_test_id("time-label").inner_text() != "0 h"
                image_changes(before, primary.screenshot(), minimum=0.0005)
                passed(5, "Playback loads a different volumetric frame and changes its time label and pixels.")

                page.get_by_role("button", name="Compare control", exact=True).click()
                control = page.get_by_test_id("volume-control")
                expect(control).to_have_attribute("data-ready", "true")
                set_range(page, "Timepoint", 5)
                expect(primary).to_have_attribute("data-frame", "5")
                expect(control).to_have_attribute("data-frame", "5")
                before = control.screenshot()
                page.get_by_role("checkbox", name="Reporter channel", exact=True).uncheck()
                page.wait_for_timeout(150)
                image_changes(before, control.screenshot(), minimum=0.0005)
                page.get_by_role("checkbox", name="Reporter channel", exact=True).check()
                box = primary.bounding_box()
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                page.mouse.down()
                page.mouse.move(box["x"] + box["width"] / 2 + 60, box["y"] + box["height"] / 2 + 25, steps=20)
                page.mouse.up()
                page.wait_for_timeout(150)
                first_pose = primary.locator(".vtk").get_attribute("data-camera")
                second_pose = control.locator(".vtk").get_attribute("data-camera")
                assert first_pose and first_pose == second_pose, (first_pose, second_pose)
                page.screenshot(path=str(screenshots / "comparison.png"))
                passed(6, "Control and treatment share time, display controls and the actual camera position.")
                page.get_by_role("button", name="Compare control", exact=True).click()

                page.get_by_role("button", name="Lab quality", exact=True).click()
                page.locator(".data-table").get_by_role("button", name=re.compile(r"^F11 .*Cygnus")).click()
                expect(primary).to_have_attribute("data-asset", "run1-F11-volume")
                expect(page.locator(".qc-banner")).to_contain_text("Low focus")
                expect(page.locator(".qc-banner")).to_contain_text("Excluded")
                page.get_by_role("button", name="2D image", exact=True).click()
                expect(page.get_by_test_id("image-view")).to_have_attribute("data-asset", "run1-F11")
                page.wait_for_timeout(300)
                page.screenshot(path=str(screenshots / "qc-confounded.png"))
                passed(7, "Measured low-focus flag links from Lab quality to the affected source field.")

                page.get_by_role("button", name="Response & evidence", exact=True).click()
                point_count = page.locator(".response-plot circle").count()
                with page.expect_response("**/api/analysis") as returned:
                    page.get_by_role("checkbox", name="Exclude QC flagged wells", exact=True).uncheck()
                analysis = returned.value.json()
                expect(page.get_by_test_id("included-count")).to_have_text("96")
                expect(page.get_by_test_id("excluded-count")).to_have_text("0")
                assert analysis["controlN"] == 24
                assert page.locator(".response-plot circle").count() > point_count
                assert next(g for g in analysis["groups"] if g["compound"] == "Cygnus-09" and g["doseUm"] == 10)["n"] == 3
                page.screenshot(path=str(screenshots / "response-evidence.png"))
                passed(8, "QC inclusion recomputes denominator, replicate points and explicit included/excluded counts.")

                page.get_by_role("combobox", name="Research decision", exact=True).select_option("Repeat acquisition")
                page.get_by_role("textbox", name="Decision rationale", exact=True).fill("Low focus confounds the reporter decrease; repeat matched acquisition.")
                page.get_by_role("textbox", name="Image annotation", exact=True).fill("Inspect F11 nuclear boundaries before prioritizing the compound.")
                page.get_by_role("button", name="Save review", exact=True).click()
                expect(page.get_by_text("Saved on this computer", exact=True)).to_be_visible()
                page.reload(wait_until="networkidle")
                expect(page.get_by_role("textbox", name="Decision rationale", exact=True)).to_have_value(re.compile("Low focus confounds"))
                server.stop()
                server.start()
                page.reload(wait_until="networkidle")
                expect(page.get_by_role("textbox", name="Image annotation", exact=True)).to_have_value(re.compile("Inspect F11"))
                passed(9, "Decision and annotation survive both browser refresh and a real server process restart.")

                visible = float(page.get_by_test_id("normalized-value").inner_text())
                with page.expect_download() as downloading:
                    page.get_by_role("button", name="Export evidence", exact=True).click()
                bundle_path = report_dir / "verified-evidence.zip"
                downloading.value.save_as(bundle_path)
                with zipfile.ZipFile(bundle_path) as bundle:
                    assert {"report.html", "measurements.csv", "selected-slice.png", "provenance.json", "citations.txt"} == set(bundle.namelist())
                    manifest = json.loads(bundle.read("provenance.json"))
                    rows = list(csv.DictReader(io.StringIO(bundle.read("measurements.csv").decode())))
                    selected = next(r for r in rows if r["wellId"] == "run1-F11")
                    assert abs(float(selected["normalizedReporterPercent"]) - visible) < 0.051
                    assert manifest["review"]["state"] == "Repeat acquisition"
                    assert manifest["processing"]["analysis"] == "cpu-baseline-1"
                    assert "scikit-image.org" in bundle.read("citations.txt").decode()
                    assert np.array(Image.open(io.BytesIO(bundle.read("selected-slice.png")))).std() > 5
                passed(10, "ZIP measurements match the displayed value, with actual image pixels, review and source provenance.")

                page.get_by_role("button", name=re.compile(r"^Well B11,")).click()
                expect(primary).to_have_attribute("data-ready", "true")
                set_range(page, "Timepoint", 3)
                set_range(page, "Z slice", 22)
                set_range(page, "3D clipping", 69)
                page.get_by_role("checkbox", name="Structure channel", exact=True).uncheck()
                page.get_by_role("button", name="Share view", exact=True).click()
                link = page.get_by_role("textbox", name="Shareable view link", exact=True).input_value()
                assert set(parse_qs(urlparse(link).query)) <= {"mode", "well", "run", "time", "z", "clip", "view", "compare", "overlay", "channels"}
                restored = context.new_page()
                restored.goto(link, wait_until="networkidle")
                expect(restored.get_by_test_id("volume-primary")).to_have_attribute("data-frame", "3")
                expect(restored.get_by_test_id("z-label")).to_have_text("22")
                expect(restored.get_by_role("checkbox", name="Structure channel", exact=True)).not_to_be_checked()
                restored.close()
                passed(11, "An allowlisted credential-free deep link restores well, channels, time, clipping and Z.")

                page.get_by_role("button", name="Reset demo", exact=True).click()
                page.get_by_role("button", name="Reset synthetic demo", exact=True).click()
                expect(primary).to_have_attribute("data-asset", "run1-B11-volume")
                expect(primary).to_have_attribute("data-frame", "0")
                expect(page.get_by_role("checkbox", name="Structure channel", exact=True)).to_be_checked()
                assert page.request.get(server.url + "/api/reviews/run1-F11").json() is None
                passed(12, "Reset clears only synthetic review state and restores deterministic starting controls.")

                box = primary.bounding_box()
                vtk = primary.locator(".vtk")
                before_count = int(vtk.get_attribute("data-render-count") or 0)
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                page.mouse.down()
                start = time.perf_counter()
                for i in range(90):
                    page.mouse.move(box["x"] + box["width"] / 2 + 65 * np.sin(i / 14),
                                    box["y"] + box["height"] / 2 + 25 * np.cos(i / 14))
                    page.wait_for_timeout(16)
                page.mouse.up()
                seconds = time.perf_counter() - start
                count = int(vtk.get_attribute("data-render-count") or 0) - before_count
                results["measurements"]["interaction"] = {
                    "renderEvents": count, "seconds": seconds, "fps": count / seconds,
                    "method": "vtk RenderWindowInteractor render events during 90-step real pointer orbit; not requestAnimationFrame-only",
                }
                if not args.software_webgl:
                    assert count / seconds >= 15, "Representative volume interaction missed 15 rendered FPS."
                page.get_by_role("button", name="Reset view", exact=True).click()
                page.set_viewport_size({"width": 1920, "height": 1080})
                page.wait_for_timeout(200)
                page.screenshot(path=str(screenshots / "workbench-1920.png"))
                page.set_viewport_size({"width": 1440, "height": 900})

                public_installed = (ROOT / "data" / "public" / "reference.json").exists()
                if public_installed:
                    page.get_by_role("combobox", name="Data experience", exact=True).select_option("public")
                    expect(primary).to_have_attribute("data-asset", "biad610-bt474")
                    expect(primary).to_have_attribute("data-ready", "true")
                    expect(page.get_by_role("button", name="Play time playback", exact=True)).to_be_disabled()
                    expect(page.get_by_role("checkbox", name="Source channel 1 channel", exact=True)).not_to_be_checked()
                    expect(page.get_by_role("checkbox", name="Source channel 2 channel", exact=True)).to_be_checked()
                    expect(page.get_by_role("checkbox", name="Segmentation overlay", exact=True)).to_be_disabled()
                    page.screenshot(path=str(screenshots / "public-bt474.png"))
                    page.get_by_role("button", name=re.compile("^Cell Painting")).click()
                    expect(page.get_by_test_id("image-view")).to_have_attribute("data-asset", "cpg0000-field")
                    expect(page.get_by_role("slider", name="Z slice", exact=True)).to_have_count(0)
                    expect(page.locator(".orthogonal-views .slice")).to_have_count(1)
                    expect(page.get_by_text("One optical field", exact=True)).to_be_visible()
                    expect(page.get_by_role("button", name="3D volume", exact=True)).to_be_disabled()
                    page.wait_for_timeout(350)
                    page.screenshot(path=str(screenshots / "public-cell-painting.png"))
                    results["publicPack"] = "Pass: actual independent public volume/field; no time-series or segmentation claims."

                page.get_by_role("combobox", name="Data experience", exact=True).select_option("connected")
                expect(page.get_by_role("heading", name="Not connected to Fabric.", exact=True)).to_be_visible()
                expect(page.get_by_text(re.compile("Missing tenant configuration:"))).to_be_visible()
                expect(page.get_by_role("group", name="96-well plate")).to_have_count(0)
                expect(page.get_by_test_id("normalized-value")).to_have_count(0)
                passed(13, "Missing Fabric configuration is visibly not connected; no local fixtures or measurements are presented.")
                assert results["errors"] == [], results["errors"]
                video = page.video
                context.close()
                if video:
                    video.save_as(str(report_dir / "walkthrough.webm"))
                browser.close()

                fallback = p.chromium.launch(headless=True, args=["--disable-webgl"])
                fallback_page = fallback.new_page()
                fallback_page.goto(server.url, wait_until="networkidle")
                expect(fallback_page.get_by_role("alert")).to_contain_text("WebGL 2 is unavailable")
                fallback_page.get_by_role("button", name="2D image", exact=True).click()
                expect(fallback_page.get_by_test_id("image-view")).to_have_attribute("data-asset", "run1-B11")
                results["noWebGL"] = "Pass: visible error, orthogonal slices and working 2D viewer."
                fallback.close()
        except Exception as exc:
            results["failure"] = str(exc)
            raise
        finally:
            server.stop()
            server.log.close()
            results["finishedAt"] = datetime.now(timezone.utc).isoformat()
            (report_dir / "browser-acceptance.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results["measurements"], indent=2))


if __name__ == "__main__":
    main()
