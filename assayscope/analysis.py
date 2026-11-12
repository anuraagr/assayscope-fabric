"""Image-only baseline. Never import the generator or consume its truth labels."""

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage as ndi
from skimage import filters, measure, morphology, segmentation
from skimage.feature import peak_local_max

ANALYSIS_VERSION = "cpu-baseline-1"


@dataclass(frozen=True)
class QCThresholds:
    focusMin: float = 0.025
    saturationMax: float = 0.015
    illuminationMax: float = 0.55
    objectCountMin: int = 12

    def __post_init__(self):
        if not (0 <= self.focusMin <= 1 and 0 <= self.saturationMax <= 1):
            raise ValueError("Focus and saturation thresholds must be between 0 and 1.")
        if not (0 <= self.illuminationMax <= 5 and 0 <= self.objectCountMin <= 10000):
            raise ValueError("Illumination/object-count thresholds are outside supported bounds.")


def segment_nuclei(image: np.ndarray) -> np.ndarray:
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError("Segmentation requires a finite 2D intensity image.")
    smooth = ndi.gaussian_filter(image.astype(np.float32), 0.65)
    if float(smooth.max() - smooth.min()) < 2:
        return np.zeros(image.shape, np.uint16)
    mask = smooth > max(float(filters.threshold_otsu(smooth)), 28)
    mask = morphology.remove_small_objects(mask, min_size=9)
    distance = ndi.distance_transform_edt(mask)
    points = peak_local_max(distance, min_distance=3, threshold_abs=1.5, labels=mask)
    markers = np.zeros(mask.shape, np.int32)
    if len(points):
        markers[tuple(points.T)] = np.arange(1, len(points) + 1)
    return segmentation.watershed(-distance, markers, mask=mask).astype(np.uint16)


def analyze_image(channels: np.ndarray, spacing_yx=(1.5, 1.5)) -> tuple[dict, np.ndarray]:
    if channels.ndim != 3 or channels.shape[0] != 3 or channels.dtype != np.uint8:
        raise ValueError("Expected three CYX uint8 channels.")
    nuclei, structure, signal = channels
    labels = segment_nuclei(nuclei)
    regions = measure.regionprops(labels)
    area_per_pixel = float(np.prod(spacing_yx))
    background = float(np.percentile(signal, 10))
    corrected = np.maximum(signal.astype(float) - background, 0)
    foreground = ndi.binary_fill_holes(structure > 26)
    nuclei_float = nuclei.astype(float) / 255
    focus = float(np.var(ndi.laplace(nuclei_float)) / (np.var(nuclei_float) + 1e-8))
    saturation = float((channels >= 254).mean())
    # Peripheral illumination estimates acquisition background, not spheroid symmetry.
    h, w = nuclei.shape
    border = max(4, min(h, w) // 10)
    patches = [
        structure[:border, :border], structure[:border, -border:],
        structure[-border:, :border], structure[-border:, -border:],
    ]
    background_means = np.array([p.mean() for p in patches])
    illumination = float(background_means.std() / max(background_means.mean(), 1))
    areas = [r.area * area_per_pixel for r in regions]
    return {
        "objectCount": len(regions),
        "medianAreaUm2": float(np.median(areas)) if areas else None,
        "foregroundAreaUm2": float(foreground.sum() * area_per_pixel),
        "meanSignalAdu": float(corrected[foreground].mean()) if foreground.any() else None,
        "integratedSignalAdu": float(corrected.sum()),
        "spheroidVolumeUm3": None,
        "focusScore": focus,
        "saturationFraction": saturation,
        "illuminationCv": illumination,
    }, labels


def analyze_volume(frame: np.ndarray, spacing_zyx: tuple[float, float, float]):
    if frame.ndim != 4 or frame.shape[0] != 3:
        raise ValueError("Expected a CZYX volume with three channels.")
    structure = ndi.gaussian_filter(frame[1].astype(float), 1)
    mask = structure > 30
    mask = ndi.binary_fill_holes(mask)
    components, n = ndi.label(mask)
    if n:
        sizes = np.bincount(components.ravel())
        sizes[0] = 0
        mask = components == sizes.argmax()
    return float(mask.sum() * np.prod(spacing_zyx)), mask.astype(np.uint8)


def qc_flags(measurements: dict | None, thresholds: QCThresholds) -> list[str]:
    if measurements is None:
        return ["Unmeasured"]
    checks = [
        (measurements["focusScore"] < thresholds.focusMin, "Low focus"),
        (measurements["saturationFraction"] > thresholds.saturationMax, "Saturation"),
        (measurements["illuminationCv"] > thresholds.illuminationMax, "Uneven illumination"),
        (measurements["objectCount"] < thresholds.objectCountMin, "Low object count"),
    ]
    return [label for failed, label in checks if failed]


def summarize(wells: list[dict], thresholds: QCThresholds, exclude_qc=True) -> dict:
    included = [
        w for w in wells if w["measured"] and w["measurements"] is not None
        and (not exclude_qc or not qc_flags(w["measurements"], thresholds))
    ]
    excluded = [w["id"] for w in wells if w["measured"] and w not in included]
    controls = [
        w["measurements"]["integratedSignalAdu"] for w in included if w["control"]
    ]
    control = float(np.median(controls)) if controls else None
    if control is not None and control <= 0:
        control = None
    normalized = {
        w["id"]: (
            100 * w["measurements"]["integratedSignalAdu"] / control
            if control is not None and w["measurements"] is not None else None
        )
        for w in wells
    }
    groups = []
    for compound in sorted({w["compound"] for w in wells if not w["control"]}):
        for dose in sorted({w["doseUm"] for w in wells if w["compound"] == compound}):
            members = [w for w in included if w["compound"] == compound and w["doseUm"] == dose]
            values = [normalized[w["id"]] for w in members if normalized[w["id"]] is not None]
            groups.append({
                "compound": compound, "doseUm": dose, "n": len(values),
                "wellIds": [w["id"] for w in members],
                "points": values,
                "mean": float(np.mean(values)) if values else None,
                "sd": float(np.std(values, ddof=1)) if len(values) > 1 else None,
            })
    return {
        "included": len(included), "excluded": excluded,
        "unmeasured": len([w for w in wells if not w["measured"]]),
        "controlMedian": control, "controlN": len(controls),
        "normalized": normalized, "groups": groups,
        "formula": "100 x background-corrected integrated reporter / median included vehicle reporter",
        "nDefinition": "n = technical replicate wells in this run; not cells or timepoints",
        "fit": "Not estimable: descriptive reporter proxy, no validated pharmacological endpoint or fit.",
        "thresholds": asdict(thresholds),
    }
