# Tenant deployment and portability

## Status and boundaries

The local product has no cloud dependency. The authorized tenant deployment now runs
in its dedicated workspace on the existing F4: protected AppBackend, Functions,
transactional review schema, separate Lakehouse, 3,289 uploaded files and five analytical
tables. The actual Fabric SSO UI loaded the volume and SQL-derived QC/response results,
and exported a matching evidence ZIP. Anonymous hosting and Functions requests returned
HTTP 401. Cloud review writes and a different signed-in identity were not tested.

The initial deployment needed **Enable Fabric App Items (preview)** (`AppBackendTenant`)
enabled by the operator at capacity scope. This is distinct from allowing public-facing
apps. Tenant IDs, deployment receipts and actual URLs stay in ignored environment state.
Deployment scripts do not change policy, roles, capacity size or sign-in context.

### Enable app creation at the intended scope

An authorized administrator can enable the exact creation setting for approved users.
If `delegateToCapacity` is already true, as it is in the inspected target, the narrower
supported route is **Capacity settings > Fabric capacity > intended capacity >
Delegated tenant settings > Enable Fabric App Items (preview)**. Select **Override
tenant admin selection**, enable it for approved users/security groups and apply.
This changes policy for that capacity, not just one workspace; review that scope first.

The documented REST equivalent is
[Update Capacity Tenant Setting Override](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/update-capacity-tenant-setting-override).
Read the current setting and preserve group restrictions/exclusions. This repository's
deployment scripts never make that policy change. The agent needs explicit permission
before doing so. In this deployment, the operator made the change directly.

Leave anonymous data access off and keep `staticHosting.assetAccess: protected`.
The existing public-facing-app permission is not needed and is not automatically
changed. Tenant settings can take
[up to 15 minutes to propagate](https://learn.microsoft.com/en-us/fabric/admin/about-tenant-settings).
Verify the effective creation setting, then reuse the existing workspace for deployment.

The deployment uses documented Fabric REST APIs and Rayfin **1.36.2**, not ARM/Bicep
for Fabric items. All Rayfin packages use the same exact version. Rayfin development
commands can provision/use a managed backend; the native local app deliberately
uses `scripts/dev.mjs` and FastAPI instead.

## Prerequisites and intended target

Use Node 24, Python 3.12 with `requirements.txt`, npm, PowerShell 7.4+ and Azure CLI.
Run `npm ci` in the app root and `npm ci` in `rayfin/functions`.
PowerShell is required on macOS/Linux for the same guarded deployment entry point.

Supply a **specific existing** Fabric workspace and assigned active capacity.
No command creates, resumes, resizes or assigns capacity. You need:

- Workspace Contributor or higher for app/Lakehouse creation and edit.
- Capacity visibility sufficient to verify the intended capacity is Active; an owner
  can run this check rather than broadly granting everyone administrative access.
- Tenant-admin enablement of Fabric Apps (preview), in your allowed group.
- Functions availability in the workspace/region.
- The app identity's scoped read access to the dedicated Lakehouse Files and SQL endpoint.
  In current Rayfin documentation the deployed app identity is the app item's owner.
- Your own sign-in. If needed, **you**, not an assistant, run `az login --tenant <tenant-id>`.
  The scripts never log in or change the Azure CLI default context.

Copy [tenant.example.json](../config/tenant.example.json) to
`config/tenant.local.json`. Required identity values are tenantId, workspaceId,
capacityId, subscriptionId and expectedAccount. The subscription is a guard for Azure
CLI; Fabric/OneLake ownership remains tenant/workspace-scoped.
The expected account must match `az account show --subscription <configured-id>`.
Token acquisition also retains `--subscription`; it does not combine it with Azure CLI's
mutually exclusive `--tenant` option. The returned tenant and subscription are checked
before the token is used.

The five `...Confirmed` booleans are **operator attestations**, not a claim that the
tool can read privileged tenant-admin settings. Leave them false until the relevant
owner verifies Apps/Functions availability, workspace role and app-identity data access.
They must be actual JSON booleans; text such as `"false"` is rejected. Optional app and
Lakehouse IDs must be empty strings or nonempty GUIDs. A configured item cannot silently
replace a different item in the recorded environment state.
The tool reports these as Manual action required. It does not set tenant-wide policy
or grant itself permissions. An inaccessible capacity/permission check fails closed.

`lakehouseId` and `appItemId` may identify explicitly approved existing items. With empty
IDs, apply creates a dedicated Lakehouse and uses Rayfin to create the app. A same-name
item outside this environment's recorded state is a collision, not permission to adopt
or overwrite it. Review its identity and supply its exact ID if adoption is intended.
Existing adopted resources are not cleanup-owned.

## Commands

Run from the standalone project root:

```sh
npm run fabric:doctor -- --config config/tenant.local.json
npm run fabric:plan -- --config config/tenant.local.json
npm run fabric:apply -- --config config/tenant.local.json --confirm-costs
npm run fabric:smoke -- --config config/tenant.local.json
```

For code/configuration checks with no target or sign-in:

```sh
npm run fabric:plan -- --offline
pwsh -NoLogo -NoProfile -File scripts/verify_deployment.ps1
```

Offline mode makes **no cloud request** and does not prove availability or authorization.
A separate no-network test harness covers local config/identity guards, retry/LRO failures,
cleanup ownership and upload selection. Its report is `test-results/deployment-local.json`;
test doubles are not evidence of live tenant behavior.
A real plan checks the intended context, workspace and active capacity, lists expected
resources/cost drivers, and invokes the documented `rayfin up --dry-run` when the Node
runtime is supported. It does not apply schema or upload assets.

### What apply does

1. Verifies tools, exact account/tenant/subscription, workspace and active capacity.
2. Refuses missing owner confirmations and missing `--confirm-costs`.
3. Creates or reuses the dedicated Lakehouse under the configured workspace.
4. Reads its real OneLake Files URI and SQL endpoint/database ID from Get Lakehouse.
   Coordinates are not invented from a developer's personal workspace.
5. Runs the image-derived pipeline and writes five analytical Parquet tables:
   experiments, acquisitions, measurements, QC and provenance.
6. Uploads canonical OME images, verified frames/labels, NGFF derivatives and table
   inputs under `Files/assayscope/spheroid-screen-001`. Generator truth, public originals,
   local reviews and arbitrary directories are not uploaded.
   The upload allowlist rejects unrelated files and linked files/directories before
   requesting a storage token. Authenticated OneLake requests do not follow redirects.
   Uploads use at most four workers and checkpoint completed hashes. Reruns verify
   recorded files before reusing them; permission failures are explicit, not replacement data.
7. Uses the documented **Load Table** writer API with overwrite for idempotent Delta
   tables. The SQL analytics endpoint is never used for transactional writes.
   A regional `Location` can be returned for an LRO. When `x-ms-operation-id` is present,
   polling uses the documented canonical `api.fabric.microsoft.com/v1/operations/{id}`
   route instead of forwarding credentials to a different origin. `Retry-After` is honored.
8. Stages an environment-specific source copy with resolved resource coordinates.
9. Uses pinned `rayfin up` to apply the backend, generates frontend environment metadata,
   and performs the full app deploy with **protected** static hosting and authenticated
   functions. No `--force` destructive schema option is used.
   Schema compilation uses the pinned CLI's `.temp/compiled` output path. Installed
   dependencies are reused only when the staged lockfile is unchanged and validation
   succeeds; a changed lockfile (including transitive-only changes) triggers `npm ci`.
10. Runs `rayfin up status`, but reports that live feature smoke tests are still required.

Canonical sources remain in Lakehouse Files; measurements reference source IDs/hashes.
The Functions `analyze` handler runs a fixed, parameterized cross-run SQL query and
rejects image/analytical code-version mismatches during SQL synchronization.
Only reviews use Rayfin's transactional MSSQL entity. They are private, caller-scoped,
append-only revisions; no segmented-object dump is stored there.

Lakehouse table creation and SQL endpoint metadata synchronization are separate.
Allow synchronization to complete and prove SQL rows/provenance, rather than treating
a table-load acknowledgement as SQL success. A selective
[SQL metadata refresh](https://learn.microsoft.com/en-us/rest/api/fabric/sqlendpoint/items/refresh-sql-endpoint-metadata)
can target the five tables with `recreateTables: false`; never drop/recreate tables to
hide a sync delay. The final deployed query returned all expected rows and matching code hashes.

## Authenticated image delivery

The default cloud path is a **server-side authenticated Functions proxy** for a bounded
single frame. It first verifies the caller through a protected Rayfin entity read and
the app runtime's Run/Interact authorization, then resolves an asset from the registered
experiment catalog. There is no client-supplied storage URL or unrestricted file path.
OneLake uses an in-memory Storage-audience app token. Tokens never reach the browser.

Reads have a 20-second timeout, three attempts for transient service/rate failures,
bounded response sizes and frame SHA-256 validation. Permission denial and expiry are
visible errors, not reasons to use local data. Rayfin invocation limits are bounded;
the browser discards stale results because the documented invocation SDK does not expose
AbortSignal cancellation. Local HTTP reads are actively aborted.

The actual workload endpoint can use `pbidedicated.windows.net`. The browser accepts
that HTTPS form only when the capacity host/path and configured workspace/item match.
The pinned Functions client can return a handler's JSON string already decoded;
catalog, analysis and review results are validated without parsing objects a second time.

**No SAS is generated.** This avoids assuming tenant delegation policy or direct-storage
CORS settings. The preflight therefore identifies direct-storage SAS/CORS as Not selected,
not silently enabled. If Functions cannot run or the app identity lacks access, the
app fails; there is no policy-bypassing fallback. Public BT474's larger derivative is
local-reference-only; the current tenant frame proxy is bounded to 3 MiB binary frames.

## Minimal sharing permissions

An app viewer needs **Run and interact / Read and execute** permission on the Fabric
AppBackend. Do not grant workspace Contributor just to view the app. The configured
app identity needs read access to only the dedicated Lakehouse/SQL analytics data.
The proxy serves that single registered demonstration experiment to authorized app
viewers; it is not a general multi-experiment entitlement system.

Review entities explicitly permit authenticated create/read only, with
`claims.sub.eq(item.user_id)`. Update/delete are not granted. Server handlers validate
the well, research state and bounded text before the normal save path.
Direct entity writes remain caller-scoped; no GxP-grade audit or tamper resistance is
claimed. Concurrent cloud revisions are append-only and preserved; the read/version
check is not a serializable compare-and-swap transaction.

A deep link encodes display state only. It cannot grant permissions or bypass sign-in.
Local links refer to the recipient's local server, not a secretly hosted sharing service.
Cloud reviews are private to each author; collaboration in this version is via the
authorized source view and explicitly exported evidence, not live shared editing.

## Post-deployment checks

```sh
npm run fabric:smoke -- --config config/tenant.local.json
npm run fabric:smoke -- --config config/tenant.local.json --write-review
```

The second command requires an approved test identity and appends one clearly labeled
synthetic smoke-test review. It does not overwrite previous revisions. Smoke reports
independently:

| Gate | Actual operation |
|---|---|
| Authenticated manifest | Typed SDK Functions call returns the registered experiment |
| Authenticated image | Real OneLake frame bytes match the source manifest hash |
| Analytical query | Real SQL results include both acquisition runs and correct row accounting |
| Review persistence | Optional real create followed by independent entity read-back |
| Anonymous access | Explicit 401/403 is Pass; ambiguous SDK errors are Warning |
| Different unauthorized identity | Not selected until a separate test identity is supplied |
| Protected hosting | Confirm with a signed-out browser; configuration alone is not proof |

Do not treat local tests, a successful deployment command, or a token acquisition as a
Pass for any unexecuted row above. If an anonymous read succeeds, smoke fails.

On the implementation host, the existing Azure CLI tokens carry `user_impersonation`,
not the delegated `Item.Execute.All` scope required by direct Entra-to-Rayfin exchange.
Consequently `fabric:smoke` fails at that exchange; no scopes were granted or sign-in
automated to suppress it. The separate standard Fabric portal SSO path worked and was
used for actual app image/analysis/export checks. Scripted smoke requires an already
authorized delegated token with the documented scope. A failed scripted sign-in is
not proof that the Fabric SSO application is unavailable.

## Reruns, another tenant and cleanup

State is ignored and scoped as:

```text
.deployment/<tenant-id>/<workspace-id>/<environment>/
    state.json
    project/       # environment-specific staged app and Rayfin metadata
```

It records created item IDs, upload fingerprints and resolved coordinates, not credentials.
The source checkout never receives developer-specific tenant IDs. Reruns reuse recorded
items and overwrite only the dedicated analytical tables. A per-prefix owner marker
prevents cross-environment replacement. Lost state is not permission to create duplicates:
same-name collisions require explicit identity review.
The marker is checked against tenant, workspace and environment, and creation uses a
conditional write so a concurrent claimant is not overwritten.

To redeploy elsewhere, create a **new ignored config** with the other tenant/workspace/
capacity/account and a new environment slug. Complete that identity's sign-in yourself,
then run doctor, plan, apply and smoke with the new config. Never copy an old environment's
state into a different tenant.

[Cleanup](cleanup.md) previews exact recorded demo-created IDs and requires an explicit
environment-name confirmation. Existing workspace/capacity/items are never deletion targets.

## Costs and preview limitations

Capacity execution, SQL/Functions execution, OneLake storage and ingestion consume the
existing tenant's resources. Storage persists when compute is not being used; soft-deleted
items can remain under retention. No model is deployed or called. There are no hard-coded
prices, free-deployment guarantees or unmeasured deployment-time promises.

The [optional research notebook](fabric-research.md) is deployed separately with
`fabric:research:apply` and executed separately with `fabric:research:run`. It reuses
the recorded Lakehouse, records its own item/job IDs, checks recent jobs and never
changes scientific tables or review records. Notebook execution consumes Spark capacity.
The [ontology/data-agent deployment](knowledge-deployment.md) is a separate explicit
plan/apply/publish/evaluate sequence. Neither knowledge item nor a live LIMS connector
is created by the base apply command. The sample knowledge items have been deployed;
live LIMS/ELN access remains unconnected.

Review the tenant's capacity metrics and current
[Fabric pricing/capacity documentation](https://learn.microsoft.com/en-us/fabric/enterprise/licenses)
before apply. Preview availability, response limits and authentication can change.
The 3 MiB proxy is suitable for this pack, not a scalable whole-slide streaming service.

## Verified documentation (checked 2026-11-12)

- [Create Fabric Apps](https://learn.microsoft.com/en-us/fabric/apps/create-app)
- [Exact tenant setting names](https://learn.microsoft.com/en-us/fabric/admin/tenant-settings-index)
- [Capacity-scoped delegated settings](https://learn.microsoft.com/en-us/fabric/admin/capacity-settings#delegated-tenant-settings)
- [Current regional availability](https://learn.microsoft.com/en-us/fabric/admin/region-availability)
- [Rayfin 1.36.2 agent rules](https://rayfin.ai/docs/reference/agent-rules.md)
- [Managed Fabric backend and permissions](https://microsoft.github.io/rayfin/docs/guide/app-backend/)
- [Rayfin up, dry-run and status](https://rayfin.ai/docs/reference/cli/up.md)
- [Ambient Rayfin token and login status](https://rayfin.ai/docs/reference/cli/login.md)
- [Functions authoring and context](https://rayfin.ai/docs/functions/writing-functions.md)
- [App-identity SQL/Storage tokens](https://rayfin.ai/docs/functions/connections.md)
- [Typed invocation and timeouts](https://rayfin.ai/docs/functions/calling-functions.md)
- [Fabric SSO](https://rayfin.ai/docs/auth/fabric-sso.md)
- [Entity permissions](https://rayfin.ai/docs/data/permissions.md)
- [OneLake ADLS/Blob APIs and URIs](https://learn.microsoft.com/en-us/fabric/onelake/onelake-access-api)
- [Get Workspace](https://learn.microsoft.com/en-us/rest/api/fabric/core/workspaces/get-workspace)
- [List Capacities](https://learn.microsoft.com/en-us/rest/api/fabric/core/capacities/list-capacities)
- [Get Lakehouse](https://learn.microsoft.com/en-us/rest/api/fabric/lakehouse/items/get-lakehouse)
- [Create Lakehouse](https://learn.microsoft.com/en-us/rest/api/fabric/lakehouse/items/create-lakehouse)
- [Load Table writer](https://learn.microsoft.com/en-us/rest/api/fabric/lakehouse/tables/load-table)
- [Delete Item](https://learn.microsoft.com/en-us/rest/api/fabric/core/items/delete-item)
- [Azure CLI account commands](https://learn.microsoft.com/en-us/cli/azure/account)
- [Blob upload request](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob)
