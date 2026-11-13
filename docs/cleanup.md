# Stop and clean up

## Local

Stop a native `npm run dev` with Ctrl+C. A native production Uvicorn process is stopped
with Ctrl+C in its terminal. Do not kill unrelated Node/Python processes by name.

```sh
docker compose down
```

This stops the container but **preserves** `assayscope-data`, including images and reviews.
The UI's **Reset demo** deletes only synthetic review rows and restores view/QC defaults.
It preserves canonical images, generated measurements and public downloads, and is
disabled for connected tenant mode.

Only when deliberately discarding all local data and reviews in this Compose project:

```sh
docker compose down --volumes
```

That explicit operator command deletes the project's named volume. It is not run by an
assistant or reset button. Native files are under the ignored `data` directory; back up
`data/reviews.sqlite3` before removing selected generated files. No cleanup command
recursively deletes the repository or a user's home directory.

## Fabric preview, then confirmation

```sh
npm run fabric:cleanup -- --config config/tenant.local.json
```

The first invocation lists **exact demo-created item IDs, names, types and workspace**
from that tenant/environment's ignored state. It deletes nothing. Review the list.
Then explicitly confirm the configured environment slug:

```sh
npm run fabric:cleanup -- --config config/tenant.local.json --confirm-delete research-demo
```

The command rechecks each live item's identity/name and deletes recorded data-agent
and ontology items, then the research notebook and app, before its demo-created
dedicated Lakehouse. A renamed or
mismatched item stops cleanup. Review active notebook jobs and preserve any outputs
needed for evidence before confirming deletion.
It does not delete a workspace, a capacity, roles, tenant-wide settings, or adopted
pre-existing items.

**Dedicated means dedicated.** Do not put unrelated data in the demo-created Lakehouse:
deleting that explicitly previewed item also removes its files/tables. If other users
have added data, do not confirm; preserve or move it first. Soft-delete/retention can
continue storage charges; no permanent/hard delete is performed.

When using a pre-existing Lakehouse, it is intentionally not cleanup-owned. The operator
must separately review the exact `Files/assayscope/spheroid-screen-001` prefix and the five
`assayscope_*` tables before removing them. The generic cleanup will not delete files or
tables inside someone else's existing item. Likewise, adopted app items are not deleted.

If environment state is lost, the tool cannot prove ownership and will not infer it from
a name. Use the Fabric portal/resource owner to review specific IDs. Never point one
tenant's state at another tenant.

See [deployment](deployment.md) for capacity/storage drivers. This project never creates
capacity and cleanup never pauses a shared capacity.
