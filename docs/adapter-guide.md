# Bring your own microscopy and metadata

## What is supplied

`assayscope.import_images` is a real, bounded OME-TIFF/OME-Zarr converter.
It validates an explicitly supplied metadata CSV, preserves originals, records source
and derivative provenance, and emits canonical OME-TIFF/NGFF plus viewer frames.
It **does not** invent treatments, analyze an arbitrary assay with synthetic thresholds,
publish files, or silently insert private images in the public reference library.

The interactive screen is intentionally one reviewed synthetic assay. Replacing it with
a real assay is a metadata/method adaptation, not a certified instrument or LIMS connector.
The converter is available now; arbitrary real-assay UI configuration is not claimed to
be a one-click completed integration.

## Prepare authorized inputs

Use only files you have rights to process. Keep real/customer images, metadata and local
configuration outside Git. Supported inputs:

- OME-TIFF (`.ome.tif`/`.ome.tiff`) with dimensional metadata.
- OME-NGFF 0.4 / Zarr v2, level 0 in TCZYX order.
- One to three explicitly named channels, one to six real timepoints.
- uint8 or uint16 intensities; at most 512 MiB decoded per selected input.
- Physical spacing in micrometers and regular, explicitly supplied time coordinates in hours.

For proprietary acquisition formats, use a separately reviewed Bio-Formats conversion
first; no proprietary reader or instrument API is claimed here.
Select a representative ROI before importing a large collection.

Edit a CSV based on [examples/instrument-export.csv](../examples/instrument-export.csv):

| Field | Meaning |
|---|---|
| image_id | Stable unique alphanumeric/underscore/hyphen ID |
| file | Relative path under the explicitly supplied image directory |
| channel_names_json | Actual channel names in source array order |
| spacing_z_um, spacing_y_um, spacing_x_um | Positive physical calibration; never guessed from display size |
| timepoints_hours_json | Actual frame times, not an invented live-cell sequence |
| acquisition_id | Stable instrument/run/acquisition identity |
| source_rights | Actual license or authorized internal rights description |

Example command, after substituting real input paths:

```powershell
.\.venv\Scripts\python.exe -m assayscope.import_images `
  --images C:\authorized-microscopy `
  --metadata C:\authorized-microscopy\metadata.csv `
  --out data\imports\reviewed-pack
```

macOS/Linux uses `.venv/bin/python` and your absolute authorized source directory.
The command never fetches a network path supplied inside the CSV or traverses outside
the declared image directory. A duplicate output ID is refused rather than overwritten.

Output includes `import-manifest.json`, source SHA-256 for single TIFF files, metadata CSV
hash, channel/time/spacing declarations, downsampling factors and fixed dtype-wide
uint16-to-uint8 conversion (not per-image autoscaling).
It is marked **tenant-owned-unconnected**. OME-Zarr source stores remain intact and
must be preserved separately; the converter hashes derivative files/frames, not a complete
cryptographic manifest of every original Zarr chunk.

Block-mean dimensions are bounded to Z<=64, Y/X<=112. Nondivisible dimensions require an
explicit reviewed ROI rather than silently padding/cropping. The maximum supported
three-channel frame matches the tenant proxy's 3 MiB binary bound.

## Join scientific context, do not infer it

[examples/lims-metadata.csv](../examples/lims-metadata.csv) is an **example schema**, not a
certified vendor connector. Join through stable acquisition/image IDs, not filenames alone.
Review plate, well, sample model, condition, concentration and replicate type with the
scientific owner. Record missing metadata as missing. Never turn cells or timepoints into
independent replicates, or combine unrelated cell lines/assays into one response curve.

The examples are illustrative rows, not executable downloads or real instrument/LIMS exports.

## Adapt the typed boundary

1. Define the real assay's question, eligible controls, units and replicate design.
2. Validate real segmentation/QC against appropriate annotations and acquisition checks.
   Do not relabel thresholding as AI or reuse the synthetic operating thresholds unexamined.
3. Map curated assets/acquisitions into [contracts/catalog.schema.json](../contracts/catalog.schema.json).
   Preserve source identifiers/hashes and mark origin accurately; remove synthetic-specific
   UI assumptions/talk tracks for a real deployment.
4. Add focused tests for the real metadata mapping and scientific calculations. Re-generate
   TypeScript declarations with `npm run contracts`; validate Python output against the same schema.
5. Adapt `assayscope.ingest.tables` to the reviewed experiment contract and load through
   the supported writer API. Update the explicit experiment identity in the environment's
   Functions target. Do not accept arbitrary storage paths or SQL from a browser.
6. Use `DataAdapter` as the UI boundary: catalog, analysis, single verified frame, optional
   labels, review, export and reset behavior. The Fabric adapter must never fall back to
   local data or label an unverified connection as connected.
7. Validate authorization with approved positive and negative identities, and run source,
   analysis, persistence and export smoke checks before sharing.

This is the deliberate extension point, not a claim of completed integration with a
named instrument, manufacturer, customer or LIMS product.
