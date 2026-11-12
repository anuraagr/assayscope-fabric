"""Inspect a running showcase; capture real output, console failures and measured timings."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8000")
parser.add_argument("--out", type=Path, default=Path("test-results"))
parser.add_argument("--software-webgl", action="store_true")
parser.add_argument("--edge", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        channel="msedge" if args.edge else None,
        args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] if args.software_webgl else [],
    )
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(args.url, wait_until="networkidle")
    page.wait_for_timeout(2000)
    page.screenshot(path=str(args.out / "first-workbench.png"), full_page=True)
    result = page.evaluate("""() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        browser: navigator.userAgent,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGB: navigator.deviceMemory ?? null,
        marks: performance.getEntriesByType('mark').map(m => ({name:m.name,ms:m.startTime})),
        alerts: [...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),
        volumeReady: document.querySelector('[data-testid=volume-primary]')?.getAttribute('data-ready'),
        body: document.body.innerText.slice(0,6000)
      };
    }""")
    result["browserVersion"] = browser.version
    result["errors"] = errors
    (args.out / "probe.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    browser.close()
