import sqlite3
from datetime import datetime, timezone
from pathlib import Path

STATES = ("Investigate", "Repeat acquisition", "Prioritize for confirmatory research")


class ReviewConflict(ValueError):
    pass


class ReviewStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS reviews (
                    well_id TEXT PRIMARY KEY, state TEXT NOT NULL, rationale TEXT NOT NULL,
                    annotation TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL
                )
            """)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def get(self, well_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM reviews WHERE well_id=?", (well_id,)).fetchone()
        return dict(row) if row else None

    def save(self, well_id, state, rationale, annotation, version) -> dict:
        if state not in STATES or not rationale.strip():
            raise ValueError("A research review state and rationale are required.")
        if len(rationale) > 4000 or len(annotation) > 4000:
            raise ValueError("Review text must be at most 4000 characters per field.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT version FROM reviews WHERE well_id=?", (well_id,)).fetchone()
            current = row["version"] if row else 0
            if version != current:
                raise ReviewConflict("This review changed. Refresh it before saving again.")
            db.execute("""
                INSERT INTO reviews VALUES(?,?,?,?,?,?)
                ON CONFLICT(well_id) DO UPDATE SET state=excluded.state,
                    rationale=excluded.rationale, annotation=excluded.annotation,
                    updated_at=excluded.updated_at, version=excluded.version
            """, (well_id, state, rationale.strip(), annotation.strip(),
                  datetime.now(timezone.utc).isoformat(), current + 1))
        return self.get(well_id)

    def reset_demo(self, allowed_ids: list[str]):
        with self.connect() as db:
            db.executemany("DELETE FROM reviews WHERE well_id=?", [(i,) for i in allowed_ids])
