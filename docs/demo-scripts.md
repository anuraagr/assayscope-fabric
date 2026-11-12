# Presenter scripts

Use the **Simulated screening experiment** experience. Reset demo state before a rehearsal
only when it is safe to discard local synthetic reviews. The built-in Presenter button
follows the same evidence path; playback does not start automatically.

## Five-minute executive story

| Time | Show | Say |
|---|---|---|
| 0:00-0:40 | Opening cutaway and visible question | "This is a research simulation. The important question is not just which well has a lower signal, but which result we should trust enough to investigate." |
| 0:40-1:25 | B11, plate selection, nucleus/reporter channel switches | "The result is connected to its source images, acquisition and measurement method. We can inspect the evidence rather than trust a screenshot." |
| 1:25-2:10 | Z, cutaway, time playback; Compare control | "These are actual 3D arrays at six simulated timepoints. Display settings and camera are linked; we do not autoscale away intensity differences." |
| 2:10-3:05 | F11 and 2D image; Lab quality | "This looks like a strong response, but the measured focus score is poor. That is a reason to repeat acquisition, not a proven biological effect." |
| 3:05-4:00 | Response & evidence; toggle QC exclusions | "Removing questionable acquisitions changes which technical replicate wells support the plot. We show those exclusions and never force an IC50." |
| 4:00-5:00 | Save Repeat acquisition rationale; Export evidence; Provenance | "A human records the next research action with its rationale. The ZIP carries the measurements, source snapshot, exclusions and provenance together. In a configured tenant, Fabric adds governed images, cross-run analytics and authorized persistence." |

Close with the limitation: no clinical outcome, efficacy or customer ROI has been measured.
Cloud deployment is not demonstrated by the local mode. If no authorized tenant is available,
say the cloud path is unverified rather than narrating an imaginary successful deployment.

## Fifteen-minute scientist/technical story

| Time | Action and scientific point |
|---|---|
| 0:00-1:30 | Explain 3 compounds x 8 concentrations x 3 technical wells, 24 controls, two simulated runs. Explicitly distinguish technical and biological replication. |
| 1:30-3:00 | Click B11 then another plate well. Show measurements tied to source IDs. Describe the 2D screen and separate 3D companion acquisition, both 48 h endpoint evidence where specified. |
| 3:00-5:00 | Inspect multichannel 3D, change cutaway and Z, inspect physical XY/XZ/YZ ratios. Play all six timepoints; explain that camera rotation is not time. |
| 5:00-6:30 | Compare G01 vehicle with shared time/display/camera. Note fixed synthetic 0..255 ADU display and the distinction between a projection, a slice and the screen's integrated reporter metric. |
| 6:30-8:30 | Open F11 2D. Discuss Laplacian-based focus and loss of crisp nuclear boundaries. Show H11 saturation and H12 illumination. A pixel-level association does not establish a hardware root cause. |
| 8:30-10:00 | Review response points and sample SD. Toggle exclusions, inspect n and denominator changes. Explain missing/zero controls and why no pharmacological fit/IC50 is justified. Switch acquisition runs without pooling them as biological replicates. |
| 10:00-11:30 | Save an explicit research decision/annotation, refresh, then show the retained review. Explain local SQLite vs per-author append-only tenant revisions. |
| 11:30-12:30 | Export ZIP; open report, CSV and provenance. Follow source hash and algorithm parameters. Explain the link contains state, not access rights. |
| 12:30-14:00 | Select Public microscopy reference. Show BT474's true single stack and Cell Painting's independent endpoint field. Read licenses, channel uncertainty, instrument provenance and transforms. Do not call them paired or a trajectory. |
| 14:00-15:00 | Show the architecture and honest cloud gate table. Discuss a real assay's validated metadata/QC mapping, scoped permissions and deployment preflight before introducing tenant data. |

## Concrete saved-review examples

**F11 / Repeat acquisition:** "Reporter decrease coincides with low focus. Repeat with
matched acquisition settings before interpreting this as a biological response."

**B11 / Prioritize for confirmatory research:** "Reporter reduction is supported by
included technical wells in this simulation. Plan independent biological replication
and an orthogonal assay; this is not an efficacy or mechanism claim."

## Rehearsal checklist

Open the app and confirm the explicit mode. Wait for services/data preparation to complete.
Verify WebGL 2 or rehearse the visible 2D fallback. Fetch public packs beforehand if needed.
Keep the research question/takeaway visible. Know where your local review store is.
Do not reset someone else's saved reviews mid-demonstration.
Screenshots are in `docs/screenshots`; a recorded automated walkthrough is produced
at `test-results/walkthrough.webm` by `verify_browser.py --record`.
