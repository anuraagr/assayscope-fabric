import csv
import json

import numpy as np
import pytest

from assayscope.assets import read_tczyx, write_asset
from assayscope.import_images import convert


def metadata(path, file="images/source.ome.tif", times=None):
    row = {
        "image_id": "imported", "file": file, "channel_names_json": '["A","B","C"]',
        "spacing_z_um": 3, "spacing_y_um": 1.5, "spacing_x_um": 1.5,
        "timepoints_hours_json": json.dumps(times or [0]),
        "acquisition_id": "example", "source_rights": "Original synthetic fixture, MIT",
    }
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=row)
        writer.writeheader()
        writer.writerow(row)


def test_authorized_import_preserves_axes_and_does_not_invent_response(tmp_path):
    pixels = np.arange(1 * 3 * 2 * 8 * 8, dtype=np.uint8).reshape((1, 3, 2, 8, 8))
    write_asset(tmp_path / "source", "source", pixels, (3, 1.5, 1.5), [0], ["A", "B", "C"])
    csv_path = tmp_path / "metadata.csv"
    metadata(csv_path)
    out = tmp_path / "output"
    result = convert(tmp_path / "source", csv_path, out)
    restored, _ = read_tczyx(out / result[0]["asset"]["path"])
    np.testing.assert_array_equal(pixels, restored)
    assert result[0]["asset"]["spacingUm"] == [3, 1.5, 1.5]
    assert result[0]["sourceKind"] == "tenant-owned-unconnected"
    assert result[0]["analysis"].startswith("Not performed")
    with pytest.raises(ValueError, match="already exists"):
        convert(tmp_path / "source", csv_path, out)


def test_import_rejects_traversal_and_fabricated_timepoints(tmp_path):
    csv_path = tmp_path / "metadata.csv"
    metadata(csv_path, file="../outside.ome.tif")
    with pytest.raises(ValueError, match="leaves"):
        convert(tmp_path / "source", csv_path, tmp_path / "output")
    pixels = np.zeros((1, 3, 1, 8, 8), np.uint8)
    write_asset(tmp_path / "source", "source", pixels, (3, 1.5, 1.5), [0])
    metadata(csv_path, times=[0, 1])
    with pytest.raises(ValueError, match="disagrees"):
        convert(tmp_path / "source", csv_path, tmp_path / "output")
