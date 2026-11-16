# Working on AssayScope

This is an independent microscopy research demo. Read README, docs/scientific-method.md,
docs/deployment.md and docs/security.md before changing behavior.

Use factual scientific labels and descriptions in the UI, exports and documentation.
Do not add marketing taglines, slogans or sales language.

## Run and verify

- Local, no cloud: `docker compose up --build` or the README's Python 3.12/Node 24
  setup followed by `npm run dev`. `npm run dev` is not `rayfin dev`.
- Frontend: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- Python: `.venv/Scripts/python.exe -m pytest` and
  `.venv/Scripts/python.exe -m ruff check assayscope research tests scripts` on Windows;
  use `.venv/bin/python` on macOS/Linux.
- Browser: `scripts/verify_browser.py --edge --record` on Windows with Edge, or
  `--software-webgl` with installed Playwright Chromium. It owns an isolated server/store.
- Cloud code: `npm ci` and `npm run build` in `rayfin/functions`.
- Offline plan: `npm run fabric:plan -- --offline`.
- Local deployment guards: `pwsh -NoLogo -NoProfile -File scripts/verify_deployment.ps1`.

## Invariants

1. Research only. No clinical/GxP/efficacy/viability claims from generic signal or morphology.
2. TCZYX canonical arrays, physical Z/Y/X micrometer spacing and explicit time coordinates.
   The browser frame is interleaved ZYXC uint8 with a checked hash, not a new imaging format.
3. Keep generator truth outside served assets; analysis.py must not import or consume it.
4. Metrics come from images. n means technical wells in one run, not cells/timepoints.
   Missing/zero denominators and unjustified fits stay not estimable.
5. Simulated, public-reference and connected modes never masquerade as one another.
   Public datasets stay independent; no invented treatments, pairing, stains or trajectories.
6. Original images and reasons for exclusion are preserved. Display changes cannot alter
   measurements. Control/treatment display mapping must remain linked.
7. Local reviews are SQLite on this instance; cloud revisions are caller-scoped and append-only.
   Do not present local persistence as enterprise authentication.
8. The catalog schema is the shared boundary. Edit contracts/catalog.schema.json and run
   `npm run contracts`; do not hand-edit src/catalog.generated.d.ts.
   Review inventory and lab context also use shared JSON Schemas/generated declarations.
   Run `npm run functions:types` for the pinned, local-only Functions type/runtime generator.
9. All Rayfin packages stay at exactly 1.36.2. Read current official agent rules before
   changing SDK calls: https://rayfin.ai/docs/reference/agent-rules.md.
   Use TC39 decorators, explicit permissions, bounded text and protected static hosting.
10. Every Azure CLI call uses Invoke-DemoAz with the subscription guard; Assert-DemoAzContext
    runs first. No interactive sign-in, context switch, new capacity or broad role grants.
11. Never commit credentials, source/customer data, .env, local.settings.json, deployment
    state, node_modules or generated bulk data. Use Write-DemoLog for PowerShell output.
12. Deployment/cleanup requires explicit target and confirmation. A successful command is
    not proof of authenticated retrieval, SQL rows, persistence or authorization.

Generated Rayfin function types/runtime metadata must be regenerated with the pinned CLI,
never edited by hand. `rayfin functions init` can add optional agent/MCP files; review
generated diffs rather than treating those files as prerequisites or permission grants.
No custom slash command, external agent framework or model service is required.

Update docs/progress.md and docs/verification.md with actual evidence and remaining gates.
Do not claim Docker/cloud/another platform was tested when it was not. Keep direct and
transitive dependency changes scoped, pinned and covered by the scientific/browser tests.

## Portable research extensions

The root `/data/` is generated content; `rayfin/data/` is required schema source.
Run `npm run repo:check` and `npm run test:repository` before source packaging.
Research helpers live in `research/`; include that directory in Ruff checks.
Regenerate the output-free notebook with `python -m scripts.build_research_notebook`.
Diagrams are generated together as SVG and editable Excalidraw with `npm run docs:diagrams`.

The LIMS/ELN context join is an offline example, not a live external connector.
`knowledge/` holds intent, instructions and evaluation cases used by the deployed
generation-2 ontology and read-only data agent. They share curated Lakehouse tables;
do not imply a direct ontology tool binding. Keep exact source selection and private
review exclusion. Live LIMS/ELN remains unconnected without a supplied authorized endpoint.
Run `scripts/verify_knowledge.ps1`, knowledge projection tests and actual definition/SQL
checks for changes; collected model answers still need independent scientific evaluation.
