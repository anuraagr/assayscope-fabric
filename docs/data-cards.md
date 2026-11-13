# Data cards

## Synthetic screening experiment

| Field | Value |
|---|---|
| Origin/rights | Original AssayScope CPU simulation; original code MIT |
| Purpose | Research-review and acquisition-QC demonstration |
| Scale | Two 96-well acquisitions; 192 measured 2D fields; six treatment/control volume acquisitions |
| Channels | Simulated nuclear stain, structural fluorescence, response reporter |
| Models/compounds | Fictional cell-line-like spheroids; Aster-17, Beryl-04, Cygnus-09, vehicle |
| Physical metadata | 2D 1.5 micrometers/pixel; 3D Z/Y/X 3/1.5/1.5 micrometers |
| Time | Six actual volume arrays from 0 to 48 h; 2D screening endpoint 48 h |
| Analysis | Image-only CPU watershed and measurements; separate hidden evaluation truth |
| Independence | Technical wells, not biological replicates; separate 2D and 3D acquisitions |
| Boundaries | No patient data, real drug, proprietary hardware integration or learned model |
| Size | Final regenerated pack: 142,995,887 compressed bytes; below 250 MB |

Source frames and measurements are deterministic with pinned dependencies. Processing
timestamps and source-code hashes document the actual run and are not expected to be
identical across unrelated installations. [Scientific methods](scientific-method.md).
Deterministic OME UUID/Plane DeltaT and nonzero NGFF time translation are covered by
passing final Python tests. The earlier pack/evidence is preserved separately.

## Cell Painting Gallery: one field, three selected channels

| Field | Value |
|---|---|
| Source | cpg0000-jump-pilot, source_4, batch 2020_11_04_CPJUMP1 |
| Plate/field | BR00116991__2020-11-05T19_51_35-Measurement1; r01c01f01p01 |
| Files | ch5 Hoechst 33342, ch1 Alexa 647, ch2 Alexa 568 |
| Rights | CC0-1.0; professional citation retained |
| Original size | 7,205,164 bytes for three TIFF files |
| Original arrays | Three 1080x1080 uint16 single planes |
| Calibration | Index.idx.xml ImageResolutionX/Y 5.979760809567617E-07 m |
| Derived arrays | 1,3,1,540,540 TCZYX uint8; 1.1959521619135234 micrometers/pixel |
| Transform | 2x2 block mean; recorded 1st/99.8th-percentile channel-specific display mapping |
| Instrument | Primary XML says Phenix, PerkinElmer; not a Thermo Fisher claim |
| Deliberate omissions | No inferred cell line, compound assignment, paired BT474 sample or trajectory |

Z=1 in the array is a singleton indexing dimension, not a measured physical thickness.
The UI reports no Z calibration for a 2D field. Primary XML calibration was used rather
than conflicting generic TIFF resolution tags. The large primary XML was inspected
during source review, but is not part of the four-file runtime pack.

Cite Chandrasekaran et al. 2024, DOI
[10.1038/s41592-024-02241-6](https://doi.org/10.1038/s41592-024-02241-6),
and Weisbart et al. 2024, DOI
[10.1038/s41592-024-02399-z](https://doi.org/10.1038/s41592-024-02399-z).
Credit AWS Open Data Sponsorship Program for storage.

## S-BIAD610: BT474 spheroid

| Field | Value |
|---|---|
| Source | BioImage Archive S-BIAD610, exact `BT474.tif` |
| Material | Human cell-line-derived BT474 spheroid; resin-embedded specimen in study record |
| Rights | CC BY 4.0, D'Imprima E and Mahamid J |
| Original size | 110,121,336 bytes |
| Original arrays | Z,C,Y,X = 35,3,1024,1024 uint8 |
| Calibration | ImageJ spacing Z=2.8598338341383296 micrometers; XY=0.3321064215101344 |
| Derived arrays | T,C,Z,Y,X = 1,3,35,256,256 uint8 |
| Transform | Full field, 4x4 XY block mean, Z retained, no intensity rescaling |
| Source channel names | Unavailable in selected TIFF; shown as source channel 1/2/3 |
| Initial visibility | High-background source channel 1 hidden; selectable, not deleted |
| Instrument | Zeiss LSM 780 NLO from primary study record |
| Time/response | Single published stack; no asserted drug response or live-cell trajectory |

The archive also contains HT6.tif (452,452,027 bytes), associated with different material.
It was **not selected**. The file is not renamed as an organoid. No fetal/patient imagery
from the design reference is used. Citation:
[10.1101/2021.07.02.450855](https://doi.org/10.1101/2021.07.02.450855).

The visibility default is set in the current manifest and regenerated reference index,
and was verified in the final browser run. No source images were downloaded again.

## Download and provenance policy

The [manifest](../config/public-sources.json) pins exact HTTPS URLs, byte sizes, SHA-256,
licenses, citations, channel and voxel metadata, and transform descriptions.
Source files stay in ignored `data/public/original`; derivatives and a copy of the
source manifest stay in `data/public/derived`. Public examples do not receive fictional
treatment metadata or synthetic QC pass labels.

Fetch is separate from application startup; progress is real byte progress. Partial
files resume only when the server honors the range. If it returns a whole file, the
partial is restarted rather than concatenated incorrectly. Corrupt cached originals
are not silently overwritten. No public failure creates a synthetic substitute.

## Tenant data

Tenant deployment initially ingests the explicitly synthetic demonstration. Importing
real microscopy is a different, rights-reviewed operation. The converter records
`tenant-owned-unconnected`, does not publish or label it connected, and does not pretend
the synthetic assay's thresholds/methods are validated on those files.
See the [adapter guide](adapter-guide.md).
