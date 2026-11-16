# AssayScope documentation

AssayScope demonstrates microscopy evidence review. It is not a validated diagnostic,
regulated system, universal image-analysis pipeline or certified instrument connector.
Start with the path that matches the work you need to do.

For a single guided path with actual app pictures, use the
[illustrated end-to-end walkthrough](end-to-end.md).

## For scientists and imaging teams

The [integrated lab-workflow guide](lab-workflows.md) covers the new browser surfaces:
study/control readiness, measurement exploration, run/QC comparisons, review queues,
repeat worksheets, spatial QC and exact lab-context inspection.

1. [Lab research guide](lab-research-guide.md): useful questions, supported evidence,
   technical replication, review decisions and evaluation in a real lab.
2. [Presenter scripts](demo-scripts.md): a five-minute overview and a fifteen-minute
   scientific walkthrough using the same evidence.
3. [Scientific methods](scientific-method.md): measurement formulas, QC, controls,
   physical coordinates and limitations.
4. [Research report and notebook](fabric-research.md): control dispersion and
   before/after-QC comparisons from the five analytical tables.
5. [Data cards](data-cards.md): what is simulated, what is public, and what is deliberately
   unknown. [Source notices](../THIRD_PARTY_NOTICES.md) explain redistribution rights.
6. [Ontology and external lab context](knowledge-context.md): deployed knowledge items,
   explicit example mappings and the boundary before a live LIMS connection.

## For engineers and platform owners

1. [README quickstart](../README.md#run-locally): verified native setup and the separate
   Docker option.
2. [Architecture](architecture.md): local/cloud boundaries and editable diagrams.
3. [Data dictionary](data-dictionary.md): identifiers, table grains, units and joins.
4. [Deployment](deployment.md): specific target, preflight, plan, apply and smoke.
5. [Security](security.md), [troubleshooting](troubleshooting.md) and [cleanup](cleanup.md):
   authorization, observable failures, costs and explicit teardown.
6. [Adapter guide](adapter-guide.md): authorized OME inputs and example metadata contracts.
7. [Knowledge deployment](knowledge-deployment.md): curated tables, ontology, agent,
   tenant publication and real MCP evaluation.

## For reviewers and contributors

| Document | Purpose |
|---|---|
| [Verification record](verification.md) | Actual checks, measured environment and unverified gates |
| [Progress](progress.md) | Concise implementation state and remaining work |
| [Design decisions and acceptance](implementation-plan.md) | Why the implementation uses these boundaries |
| [Contributing](../CONTRIBUTING.md) | Source conventions, tests and review expectations |
| [Security reporting](../SECURITY.md) | Report vulnerabilities privately without exposing data |
| [Support](../SUPPORT.md) | Provide a useful, redacted issue report |
| [Audience lenses](audience-talk-tracks.md) | Separate discovery, imaging and informatics conversations; no endorsements |
| [Diagram sources](diagrams/README.md) | Rebuild SVGs and edit Excalidraw diagrams |

**Reading a deployment example does not grant access.** Configure your own authorized
target. Portable source contains no tenant identifiers, access tokens, customer images
or generated screening pack.
