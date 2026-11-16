"""Loopback-only local adapter. Never claim enterprise authentication in this service."""

import asyncio
import hashlib
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from jsonschema import ValidationError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .analysis import QCThresholds, qc_flags, summarize
from .context import validate_context
from .export import evidence_bundle
from .generator import ROOT, build
from .store import ReviewConflict, ReviewStore


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Thresholds(StrictModel):
    focusMin: float = Field(0.025, ge=0, le=1)
    saturationMax: float = Field(0.015, ge=0, le=1)
    illuminationMax: float = Field(0.55, ge=0, le=5)
    objectCountMin: int = Field(12, ge=0, le=10000)


class AnalysisRequest(StrictModel):
    runId: Literal["run1", "run2"] = "run1"
    excludeQC: bool = True
    thresholds: Thresholds = Field(default_factory=Thresholds)


class ReviewRequest(StrictModel):
    state: Literal["Investigate", "Repeat acquisition", "Prioritize for confirmatory research"]
    rationale: str = Field(min_length=1, max_length=4000)
    annotation: str = Field(default="", max_length=4000)
    version: int = Field(default=0, ge=0)


class ChannelSetting(StrictModel):
    visible: bool
    color: str = Field(pattern=r"^#[a-fA-F0-9]{6}$")
    low: float = Field(ge=0, le=254)
    high: float = Field(ge=1, le=255)

    @model_validator(mode="after")
    def range_order(self):
        if self.low >= self.high:
            raise ValueError("Lower display bound must be below upper bound.")
        return self


class ViewRequest(StrictModel):
    assetId: str = Field(pattern=r"^[a-zA-Z0-9_-]+$")
    time: int = Field(ge=0, le=100)
    z: int = Field(ge=0, le=4096)
    channels: list[ChannelSetting] = Field(min_length=1, max_length=8)


class ExportRequest(AnalysisRequest):
    wellId: str
    view: ViewRequest


def create_app(data_dir: Path | None = None) -> FastAPI:
    data = data_dir or Path(os.environ.get("ASSAYSCOPE_DATA", ROOT / "data"))
    core = Path(os.environ.get("ASSAYSCOPE_CORE", data / "core"))
    public = Path(os.environ.get("ASSAYSCOPE_PUBLIC", data / "public"))
    store = ReviewStore(data / "reviews.sqlite3")
    catalog = {}
    assets = {}

    @asynccontextmanager
    async def lifespan(app):
        result = await asyncio.to_thread(build, core)
        catalog.update(result)
        for well in catalog["wells"]:
            for asset in (well["image"], well["volume"]):
                if asset:
                    assets[asset["id"]] = (asset, core)
        yield

    app = FastAPI(title="AssayScope local adapter", lifespan=lifespan, docs_url=None,
                  redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        host = urlparse(f"http://{request.headers.get('host', '')}").hostname
        if host not in ("localhost", "127.0.0.1", "::1", "testserver"):
            return JSONResponse({"detail": "Local showcase accepts loopback hosts only."}, 403)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if int(request.headers.get("content-length", "0")) > 32768:
                return JSONResponse({"detail": "Request exceeds the 32 KiB limit."}, 413)
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "Cross-origin writes are not allowed."}, 403)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"detail": "Writes require application/json."}, 415)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        return response

    def get_well(well_id):
        well = next((w for w in catalog["wells"] if w["id"] == well_id), None)
        if well is None:
            raise HTTPException(404, "Unknown well; select a registered acquisition.")
        return well

    def public_index():
        path = public / "reference.json"
        if not path.exists():
            return {"available": False, "studies": [],
                    "message": "Public pack is not installed. Run python -m assayscope.public_data fetch."}
        result = json.loads(path.read_text(encoding="utf-8"))
        for study in result["studies"]:
            assets[study["asset"]["id"]] = (study["asset"], public / "derived")
        return result

    def registered_asset(asset_id, t):
        if asset_id not in assets:
            public_index()
        if asset_id not in assets:
            raise HTTPException(404, "Image is not in the authorized local catalog.")
        asset, asset_root = assets[asset_id]
        if not 0 <= t < asset["shape"][0]:
            raise HTTPException(422, "Timepoint is outside this image.")
        return asset, asset_root

    @app.get("/api/status")
    def status():
        return {"ready": bool(catalog), "mode": "local", "authentication": "None; loopback showcase",
                "reviewStorage": "SQLite on this computer; not shared across devices"}

    @app.get("/api/catalog")
    def get_catalog():
        return catalog

    @app.get("/api/public")
    def get_public():
        return public_index()

    @app.get("/api/assets/{asset_id}/frames/{t}")
    def frame(asset_id: str, t: int):
        asset, asset_root = registered_asset(asset_id, t)
        path = asset_root / "frames" / f"{asset_id}-{t}.bin"
        if not path.exists():
            raise HTTPException(409, "Missing frame. Rebuild the relevant data pack.")
        contents = path.read_bytes()
        expected = int(np.prod(asset["shape"][1:]))
        if len(contents) != expected or hashlib.sha256(contents).hexdigest() != asset["frameHashes"][t]:
            raise HTTPException(409, "Frame checksum mismatch. Rebuild the relevant data pack.")
        return Response(contents, media_type="application/octet-stream",
                        headers={"X-Frame-SHA256": asset["frameHashes"][t]})

    @app.get("/api/assets/{asset_id}/labels/{t}")
    def labels(asset_id: str, t: int):
        asset, asset_root = registered_asset(asset_id, t)
        path = asset_root / "labels" / f"{asset_id}-{t}.bin"
        if not path.exists():
            raise HTTPException(404, "No segmentation is available for this reference image.")
        if path.stat().st_size != int(np.prod(asset["shape"][2:])):
            raise HTTPException(409, "Label dimensions do not match the source image.")
        return FileResponse(path, media_type="application/octet-stream")

    @app.post("/api/analysis")
    def analysis(options: AnalysisRequest):
        thresholds = QCThresholds(**options.thresholds.model_dump())
        selected = [w for w in catalog["wells"] if w["runId"] == options.runId]
        result = summarize(selected, thresholds, options.excludeQC)
        result["flags"] = {w["id"]: qc_flags(w["measurements"], thresholds) for w in catalog["wells"]}
        result["crossRun"] = [{
            "runId": run["id"], "instrument": run["instrument"],
            "flagged": sum(bool(result["flags"][w["id"]]) for w in catalog["wells"]
                           if w["runId"] == run["id"]),
            "total": sum(w["runId"] == run["id"] for w in catalog["wells"]),
            "medianFocus": float(np.median([
                w["measurements"]["focusScore"] for w in catalog["wells"]
                if w["runId"] == run["id"] and w["measurements"] is not None
            ])),
        } for run in catalog["runs"]]
        return result

    @app.get("/api/reviews/{well_id}")
    def get_review(well_id: str):
        get_well(well_id)
        return store.get(well_id)

    @app.get("/api/reviews")
    def list_reviews():
        return store.list_registered([well["id"] for well in catalog["wells"]])

    @app.get("/api/lab-context")
    def lab_context():
        path = ROOT / "examples" / "lab-context.example.json"
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 128 * 1024:
            raise HTTPException(503, "The bounded example context snapshot is unavailable. No external connection or replacement data was used.")
        try:
            snapshot = json.loads(path.read_text(encoding="utf-8"))
            return validate_context(snapshot, catalog["experiment"]["id"], {
                well["id"]: {"run_id": well["runId"], "source_image_id": well["image"]["id"]}
                for well in catalog["wells"]
            })
        except (ValueError, ValidationError) as exc:
            raise HTTPException(409, f"Lab context validation failed: {exc.message if isinstance(exc, ValidationError) else str(exc)}") from exc

    @app.put("/api/reviews/{well_id}")
    def save_review(well_id: str, review: ReviewRequest):
        get_well(well_id)
        try:
            return store.save(well_id, **review.model_dump())
        except ReviewConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/export")
    def export(options: ExportRequest):
        well = get_well(options.wellId)
        if well["runId"] != options.runId:
            raise HTTPException(422, "Export run does not match the selected well.")
        try:
            result = evidence_bundle(core, catalog, well, options.model_dump(), store.get(well["id"]))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return Response(result, media_type="application/zip", headers={
            "Content-Disposition": f'attachment; filename="assayscope-{well["id"]}.zip"'
        })

    @app.post("/api/reset")
    def reset():
        store.reset_demo([w["id"] for w in catalog["wells"]])
        return {"reset": True, "scope": "Synthetic review rows only; source images preserved"}

    @app.get("/api/fabric/status")
    def fabric_status():
        raise HTTPException(503, "Fabric is not configured in the local adapter. No local data is labeled Connected.")

    dist = ROOT / "dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Unknown API route.")
            return FileResponse(dist / "index.html")

    return app


app = create_app()
