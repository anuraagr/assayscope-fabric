#Requires -Version 7.4
<#
Documented contracts and API references: docs/deployment.md.
No login, context mutation, capacity creation, tenant setting changes or role grants.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('doctor', 'plan', 'apply', 'smoke', 'cleanup')][string]$Action,
    [string]$ConfigPath = 'config/tenant.local.json',
    [switch]$Offline,
    [switch]$ConfirmCosts,
    [string]$ConfirmDelete = '',
    [switch]$WriteReview
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$script:Config = $null
$script:Secrets = [System.Collections.Generic.List[string]]::new()
$script:State = $null
$script:StatePath = $null
$script:FabricToken = ''

function Write-DemoLog {
    param([string]$Message)
    $safe = $Message
    foreach ($secret in $script:Secrets) {
        if ($secret) { $safe = $safe.Replace($secret, '[REDACTED]') }
    }
    $safe = $safe -replace '(?i)(Bearer\s+)\S+', '$1[REDACTED]'
    $safe = $safe -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED]'
    $safe = $safe -replace '(?i)(sig|access_token|refresh_token|password|client_secret)=([^&\s]+)', '$1=[REDACTED]'
    Write-Host $safe
}
function New-DemoResult {
    param([string]$Check, [ValidateSet('Pass','Fail','Warning','Manual action required','Not supported','Not selected')][string]$Status, [string]$Detail)
    Write-DemoLog "$Check | $Status | $Detail"
}
function Invoke-DemoAz {
    param([string[]]$Arguments)
    if (-not $script:Config.subscriptionId) { throw 'A subscription guard is required.' }
    $output = & az @Arguments --subscription $script:Config.subscriptionId --only-show-errors --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: $($output -join ' ')" }
    return ($output -join "`n") | ConvertFrom-Json -AsHashtable
}
function Assert-DemoAzContext {
    $account = Invoke-DemoAz -Arguments @('account','show')
    if ($account.tenantId -ne $script:Config.tenantId -or $account.id -ne $script:Config.subscriptionId -or
        $account.user.name -ne $script:Config.expectedAccount) {
        throw 'Signed-in tenant, subscription or account differs from the intended target. No context was changed.'
    }
    New-DemoResult 'AUTH.CONTEXT' 'Pass' 'Signed-in account, tenant and subscription match configuration.'
}
function Get-DemoToken {
    param([string]$Resource)
    $response = Invoke-DemoAz -Arguments @('account','get-access-token','--resource',$Resource,'--tenant',$script:Config.tenantId)
    if ($response['accessToken'] -isnot [string] -or [string]::IsNullOrWhiteSpace($response['accessToken'])) {
        throw 'Azure CLI did not return a usable access token.'
    }
    $script:Secrets.Add($response.accessToken)
    return $response.accessToken
}
function Assert-DemoConfig {
    param([hashtable]$Configuration)
    foreach ($key in @('subscriptionId','tenantId','workspaceId','capacityId','lakehouseId','appItemId')) {
        $optional = $key -in @('lakehouseId','appItemId')
        $value = $Configuration[$key]
        if ($optional -and $value -eq '') { continue }
        $parsed = [Guid]::Empty
        if ($value -isnot [string] -or -not [Guid]::TryParse($value, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
            throw "Configure a nonempty GUID for $key, or an empty string for an optional item ID."
        }
    }
    if ($Configuration.environment -isnot [string] -or $Configuration.environment -notmatch '^[a-z][a-z0-9-]{0,30}$' -or
        $Configuration.expectedAccount -isnot [string] -or [string]::IsNullOrWhiteSpace($Configuration.expectedAccount)) {
        throw 'Configure a safe environment slug and the expected signed-in account.'
    }
    foreach ($key in @('fabricAppsEnabledConfirmed','functionsAvailableConfirmed','workspaceContributorConfirmed',
                       'storageApplicationReadConfirmed','sqlApplicationReadConfirmed')) {
        if ($Configuration[$key] -isnot [bool]) { throw "$key must be a JSON boolean, not text or a number." }
    }
}
function Assert-DemoState {
    param([hashtable]$State, [hashtable]$Configuration)
    foreach ($key in @('tenantId','workspaceId','environment')) {
        if ($State[$key] -ne $Configuration[$key]) { throw 'Deployment state belongs to another tenant/workspace/environment.' }
    }
    foreach ($key in @('lakehouseId','appItemId')) {
        if ($Configuration[$key] -and $Configuration[$key] -ne $State[$key]) {
            throw "Configured $key conflicts with recorded deployment state. Review the exact target before continuing."
        }
    }
    foreach ($item in $State.created) {
        $key = switch ($item.type) {
            'Lakehouse' { 'lakehouseId' }
            'AppBackend' { 'appItemId' }
            default { throw 'Deployment state contains an unsupported cleanup resource type.' }
        }
        $parsed = [Guid]::Empty
        if (-not [Guid]::TryParse($item.id, [ref]$parsed) -or $parsed -eq [Guid]::Empty -or
            $item.id -ne $State[$key] -or [string]::IsNullOrWhiteSpace($item.name)) {
            throw 'Cleanup ownership does not match the recorded app or Lakehouse.'
        }
    }
}
function Get-DemoUploadFiles {
    param([string]$Directory)
    $resolved = (Resolve-Path -LiteralPath $Directory).Path
    $entries = @(Get-ChildItem -LiteralPath $resolved -Force -Recurse)
    $files = @()
    foreach ($entry in $entries) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Tenant upload refuses linked files or directories.'
        }
        if ($entry.PSIsContainer) { continue }
        $relative = [IO.Path]::GetRelativePath($resolved, $entry.FullName).Replace('\','/')
        if ($relative -eq 'generation.json') { continue }
        $allowed = $relative -eq 'catalog.json' -or
            $relative -match '^images/[a-zA-Z0-9_-]+\.ome\.tif$' -or
            $relative -match '^(frames|labels)/[a-zA-Z0-9_-]+-[0-5]\.bin$' -or
            $relative -match '^volume-measurements/[a-zA-Z0-9_-]+\.json$' -or
            $relative -match '^tables/(tables\.json|assayscope_(experiments|acquisitions|measurements|qc|provenance)\.parquet)$' -or
            $relative -match '^ngff/[a-zA-Z0-9_-]+\.ome\.zarr/(\.zgroup|\.zattrs|\.zmetadata|[0-2]/(\.zarray|\.zattrs|[0-9]+(\.[0-9]+){4}))$'
        if (-not $allowed) { throw "Unrecognized core file would be uploaded: $relative. Review it before applying." }
        $files += $entry
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resolved 'catalog.json') -PathType Leaf)) {
        throw 'Prepared catalog.json is required for tenant upload.'
    }
    return $files
}
function Assert-FabricUrl {
    param([string]$Url)
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri)) {
        throw 'Fabric continuation/operation URL is outside the documented API origin.'
    }
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'api.fabric.microsoft.com' -or
        $uri.Port -ne 443 -or -not $uri.AbsolutePath.StartsWith('/v1/') -or $uri.UserInfo -or $uri.Fragment) {
        throw 'Fabric continuation/operation URL is outside the documented API origin.'
    }
}
function Invoke-Fabric {
    param([string]$Path, [string]$Method = 'GET', [object]$Body = $null, [switch]$ReturnOperationResult)
    $url = if ($Path -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { $Path } else { "https://api.fabric.microsoft.com/v1/$Path" }
    Assert-FabricUrl -Url $url
    $uri = [Uri]$url
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $parameters = @{
            Uri = $url; Method = $Method; Headers = @{Authorization = "Bearer $script:FabricToken"}
            TimeoutSec = 60; SkipHttpErrorCheck = $true; MaximumRedirection = 0
        }
        if ($null -ne $Body) { $parameters.Body = $Body | ConvertTo-Json -Depth 40 -Compress; $parameters.ContentType = 'application/json' }
        $response = Invoke-WebRequest @parameters
        if ($response.StatusCode -eq 429 -or $response.StatusCode -ge 500) {
            if ($attempt -lt 2) { Start-Sleep -Seconds ([Math]::Pow(2, $attempt + 1)); continue }
        }
        if ($response.StatusCode -ge 400) { throw "Fabric returned HTTP $($response.StatusCode) for $Method $($uri.AbsolutePath). Check intended identity and permissions." }
        if ($response.StatusCode -eq 202) {
            $operation = [string]($response.Headers.Location | Select-Object -First 1)
            Assert-FabricUrl -Url $operation
            $complete = $false
            for ($poll = 0; $poll -lt 120; $poll++) {
                Start-Sleep -Seconds 5
                $state = Invoke-Fabric -Path $operation
                if ($state.status -eq 'Succeeded') { $complete = $true; break }
                if ($state.status -in @('Failed','Cancelled')) { throw 'Fabric long-running operation failed; inspect the operation in the target workspace.' }
            }
            if (-not $complete) { throw 'Fabric operation is still pending after 10 minutes; rerun to inspect state.' }
            if ($ReturnOperationResult) { return Invoke-Fabric -Path "$($operation.TrimEnd('/'))/result" }
            return @{ status = 'Succeeded' }
        }
        if ([string]::IsNullOrWhiteSpace($response.Content)) { return @{} }
        return $response.Content | ConvertFrom-Json -AsHashtable
    }
    throw 'Fabric remained unavailable after bounded retries.'
}
function Get-FabricList {
    param([string]$Path)
    $items = @()
    for ($page = 0; $page -lt 100; $page++) {
        $result = Invoke-Fabric -Path $Path
        $items += @($result.value)
        if (-not $result.ContainsKey('continuationUri') -or -not $result.continuationUri) { return $items }
        $Path = $result.continuationUri
    }
    throw 'Fabric pagination exceeded 100 pages.'
}
function Save-State {
    $script:State | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $script:StatePath -Encoding utf8
}
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments, [string]$Directory = $Root)
    Push-Location -LiteralPath $Directory
    try {
        & $Program @Arguments 2>&1 | ForEach-Object { Write-DemoLog ([string]$_) }
        if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
}
function Resolve-Python {
    $candidate = if ($IsWindows) { Join-Path $Root '.venv\Scripts\python.exe' } else { Join-Path $Root '.venv/bin/python' }
    if (-not (Test-Path -LiteralPath $candidate)) { throw 'Create the Python 3.12 virtual environment and install requirements.txt first.' }
    return $candidate
}

try {
    $schema = Get-Content -LiteralPath (Join-Path $Root 'contracts/catalog.schema.json') -Raw | ConvertFrom-Json
    if ($schema.title -ne 'Catalog') { throw 'Local contract is invalid.' }
    $configurationExists = Test-Path -LiteralPath $ConfigPath
    if (-not $configurationExists -and -not $Offline) {
        throw "Missing $ConfigPath. Copy config/tenant.example.json, supply intended identifiers and confirmations. No network request was made."
    }
    $python = Resolve-Python
    $node = (& node --version).Trim()
    $supportedNode = $node -match '^v(20|22|24)\.'
    if ($supportedNode) { New-DemoResult 'TOOLS.NODE' 'Pass' "Rayfin-supported Node $node." }
    else { New-DemoResult 'TOOLS.NODE' 'Warning' "Node $node is outside Rayfin 1.36.2 support; use Node 24 before apply." }
    New-DemoResult 'LOCAL.CONTRACT' 'Pass' 'Catalog schema and Python runtime are present.'
    $core = Join-Path $Root 'data/core'
    $bytes = if (Test-Path -LiteralPath $core) {
        (Get-ChildItem -LiteralPath $core -File -Recurse | Measure-Object -Property Length -Sum).Sum
    } else { 0 }
    New-DemoResult 'DATA.SIZE' 'Pass' "Prepared core assets: $bytes bytes. Public raw files and generator truth are excluded from tenant upload."
    if ($Offline) {
        if ($Action -notin @('doctor','plan')) { throw 'Offline mode supports doctor and plan only.' }
        New-DemoResult 'PLAN.RESOURCES' 'Warning' 'One protected Fabric AppBackend and child SQL/Functions/static services, one dedicated Lakehouse, five analytical tables, and bounded image assets. Existing capacity only.'
        New-DemoResult 'CLOUD.VERIFICATION' 'Not selected' 'Offline plan: no authentication or cloud calls. Tenant, capacity, app availability, access and costs remain unverified.'
        exit 0
    }
    $script:Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
    Assert-DemoConfig -Configuration $script:Config
    if ($Action -eq 'apply' -and (-not $ConfirmCosts -or -not $supportedNode)) {
        throw 'Apply requires supported Node 24 and --confirm-costs after reviewing the plan. No paid capacity is created.'
    }
    Assert-DemoAzContext
    $script:FabricToken = Get-DemoToken -Resource 'https://api.fabric.microsoft.com'
    $workspaceId = $script:Config.workspaceId
    $workspace = Invoke-Fabric -Path "workspaces/$workspaceId"
    if ($workspace.capacityId -ne $script:Config.capacityId) { throw 'Workspace capacity differs from the intended capacity.' }
    $capacity = @(Get-FabricList -Path 'capacities' | Where-Object { $_.id -eq $script:Config.capacityId })
    if ($capacity.Count -ne 1 -or $capacity[0].state -ne 'Active') {
        throw 'Intended capacity is inactive or cannot be verified. Ask its administrator; nothing will resume or create capacity.'
    }
    New-DemoResult 'CAPACITY.ACTIVE' 'Pass' 'Workspace is assigned to the intended active capacity.'
    foreach ($key in @('fabricAppsEnabledConfirmed','functionsAvailableConfirmed','workspaceContributorConfirmed',
                       'storageApplicationReadConfirmed','sqlApplicationReadConfirmed')) {
        if (-not $script:Config[$key]) { throw "Manual action required: confirm $key with the tenant/workspace owner. The tool will not change settings or grant permissions." }
    }
    New-DemoResult 'PREVIEW.SETTINGS' 'Manual action required' 'Operator attests Apps/Functions availability and minimum permissions. Tenant-admin settings and app-identity access still require post-deployment checks.'
    $stateDirectory = Join-Path $Root ".deployment/$($script:Config.tenantId)/$workspaceId/$($script:Config.environment)"
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $script:StatePath = Join-Path $stateDirectory 'state.json'
    $script:State = if (Test-Path -LiteralPath $script:StatePath) {
        Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json -AsHashtable
    } else {
        @{ tenantId=$script:Config.tenantId; workspaceId=$workspaceId; environment=$script:Config.environment
           created=@(); lakehouseId=$script:Config.lakehouseId; appItemId=$script:Config.appItemId; uploaded=@{} }
    }
    Assert-DemoState -State $script:State -Configuration $script:Config
    $items = @(Get-FabricList -Path "workspaces/$workspaceId/items")
    $appName = "assayscope-$($script:Config.environment)"
    $lakehouseName = "assayscope_$($script:Config.environment.Replace('-','_'))"
    if ($script:State.appItemId) {
        $existingApp = @($items | Where-Object { $_.id -eq $script:State.appItemId -and $_.type -eq 'AppBackend' })
        if ($existingApp.Count -ne 1) { throw 'Configured appItemId is not an accessible Fabric AppBackend in the intended workspace.' }
        $appName = $existingApp[0].displayName
    }
    if ($Action -eq 'cleanup') {
        foreach ($item in $script:State.created) {
            New-DemoResult 'CLEANUP.PREVIEW' 'Warning' "$($item.type): $($item.id) ($($item.name)) in workspace $workspaceId."
        }
        if ($ConfirmDelete -ne $script:Config.environment) {
            New-DemoResult 'CLEANUP.CONFIRM' 'Manual action required' "No deletion. Rerun with --confirm-delete $($script:Config.environment) after reviewing every ID."
            exit 0
        }
        foreach ($owned in @($script:State.created | Sort-Object -Property @{Expression={ if ($_.type -eq 'AppBackend') {0} else {1} }})) {
            $current = @($items | Where-Object { $_.id -eq $owned.id })
            if ($current.Count -eq 0) { continue }
            if ($current[0].type -ne $owned.type -or $current[0].displayName -ne $owned.name) {
                throw 'An owned item changed identity/name. Cleanup stopped rather than deleting an unverified resource.'
            }
            Invoke-Fabric -Path "workspaces/$workspaceId/items/$($owned.id)" -Method 'DELETE' | Out-Null
        }
        $script:State.created = @(); $script:State.lakehouseId = ''; $script:State.appItemId = ''; $script:State.uploaded = @{}
        Save-State
        New-DemoResult 'CLEANUP' 'Pass' 'Deleted only recorded demo-created items. Existing items, workspace, capacity, and local files were not deleted; soft-delete retention can continue billing.'
        exit 0
    }
    if ($Action -in @('doctor','plan')) {
        New-DemoResult 'PLAN.RESOURCES' 'Warning' "$appName (protected AppBackend) and $lakehouseName (Lakehouse); use recorded/configured IDs when present. Five per-well analytical tables; no object-level transactional dump."
        New-DemoResult 'PLAN.ACCESS' 'Warning' 'Authenticated Functions proxy only: no SAS setting or cross-origin storage access is required. App identity must read only the dedicated Lakehouse and its SQL endpoint.'
        New-DemoResult 'PLAN.COST' 'Warning' 'Capacity execution, SQL/Functions use and OneLake storage consume tenant resources. No fixed price, free-tier or duration guarantee. Apply requires --confirm-costs.'
        if ($Action -eq 'plan' -and $supportedNode) {
            $previousToken = $env:RAYFIN_TOKEN
            $env:RAYFIN_TOKEN = $script:FabricToken
            try {
                Invoke-Checked -Program 'npx' -Arguments @('--no-install','rayfin','up','--dry-run','--workspace-id',
                    $workspaceId,'--tenant',$script:Config.tenantId,'--item-name',$appName,'-y')
            } finally { $env:RAYFIN_TOKEN = $previousToken }
        }
        exit 0
    }
    if ($Action -eq 'smoke') {
        if (-not $script:State.appItemId) { throw 'No recorded deployed app. Apply first.' }
        $stage = Join-Path $stateDirectory 'project'
        if (-not (Test-Path -LiteralPath (Join-Path $stage '.env.local'))) { throw 'Deployed runtime coordinates are missing; rerun apply.' }
        $previousToken = $env:RAYFIN_TOKEN
        $env:RAYFIN_TOKEN = $script:FabricToken
        try {
            $arguments = @((Join-Path $Root 'scripts/cloud-smoke.mjs'), '--project', $stage)
            if ($WriteReview) { $arguments += '--write-review' }
            Invoke-Checked -Program 'node' -Arguments $arguments
        } finally { $env:RAYFIN_TOKEN = $previousToken }
        exit 0
    }
    if (-not $script:State.lakehouseId) {
        $existing = @($items | Where-Object { $_.displayName -eq $lakehouseName -and $_.type -eq 'Lakehouse' })
        if ($existing.Count) { throw 'A same-name Lakehouse already exists but is not in this environment state. Set its exact lakehouseId after ownership review; it will never be cleanup-owned.' }
        $created = Invoke-Fabric -Path "workspaces/$workspaceId/lakehouses" -Method 'POST' -ReturnOperationResult -Body @{
            displayName=$lakehouseName; description="AssayScope research demo; environment $($script:Config.environment)"
        }
        $script:State.lakehouseId = $created.id
        $script:State.created += @{id=$created.id; type='Lakehouse'; name=$lakehouseName}
        Save-State
    }
    $lakehouseId = $script:State.lakehouseId
    $lakehouse = Invoke-Fabric -Path "workspaces/$workspaceId/lakehouses/$lakehouseId"
    if ($lakehouse.properties.sqlEndpointProperties.provisioningStatus -ne 'Success') { throw 'Lakehouse SQL endpoint is not ready. Rerun apply when provisioning completes.' }
    $filesUri = [Uri]$lakehouse.properties.oneLakeFilesPath
    if ($filesUri.Scheme -ne 'https' -or -not $filesUri.Host.EndsWith('.dfs.fabric.microsoft.com') -or
        $filesUri.AbsolutePath.TrimEnd('/') -ne "/$workspaceId/$lakehouseId/Files") {
        throw 'OneLake file coordinates do not match the intended workspace and item.'
    }
    Invoke-Checked -Program $python -Arguments @('-m','assayscope.ingest')
    $uploadFiles = @(Get-DemoUploadFiles -Directory $core)
    $storageToken = Get-DemoToken -Resource 'https://storage.azure.com/'
    $prefix = 'assayscope/spheroid-screen-001'
    $blobRoot = $filesUri.AbsoluteUri.Replace('.dfs.', '.blob.').TrimEnd('/')
    $markerUrl = "$blobRoot/$prefix/owner.json"
    $headers = @{ Authorization="Bearer $storageToken"; 'x-ms-version'='2023-11-03'; 'x-ms-blob-type'='BlockBlob' }
    $marker = Invoke-WebRequest -Uri $markerUrl -Headers $headers -SkipHttpErrorCheck -TimeoutSec 30 -MaximumRedirection 0
    $ownedMarker = @{ tenantId=$script:Config.tenantId; workspaceId=$workspaceId; environment=$script:Config.environment }
    if ($marker.StatusCode -eq 200) {
        $old = $marker.Content | ConvertFrom-Json -AsHashtable
        if ($old.environment -ne $ownedMarker.environment -or $old.tenantId -ne $ownedMarker.tenantId -or
            $old.workspaceId -ne $ownedMarker.workspaceId) {
            throw 'The target image prefix belongs to another environment. No assets were overwritten.'
        }
    } elseif ($marker.StatusCode -eq 404) {
        Invoke-WebRequest -Uri $markerUrl -Method Put -Headers ($headers + @{'If-None-Match'='*'}) -Body ($ownedMarker | ConvertTo-Json -Compress) -ContentType 'application/json' -MaximumRedirection 0 -TimeoutSec 30 | Out-Null
    } else { throw "OneLake access denied/unavailable (HTTP $($marker.StatusCode)); verify scoped storage access." }
    foreach ($file in $uploadFiles) {
        $relative = [IO.Path]::GetRelativePath($core, $file.FullName).Replace('\','/')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if ($script:State.uploaded.ContainsKey($relative) -and $script:State.uploaded[$relative] -eq $hash) {
            $head = Invoke-WebRequest -Uri "$blobRoot/$prefix/$relative" -Method Head -Headers $headers -SkipHttpErrorCheck -TimeoutSec 30 -MaximumRedirection 0
            if ($head.StatusCode -eq 200 -and [long]($head.Headers.'Content-Length' | Select-Object -First 1) -eq $file.Length) { continue }
            if ($head.StatusCode -notin @(200,404)) { throw "OneLake read failed (HTTP $($head.StatusCode)); upload stopped." }
        }
        Invoke-WebRequest -Uri "$blobRoot/$prefix/$relative" -Method Put -Headers $headers -InFile $file.FullName -ContentType 'application/octet-stream' -TimeoutSec 120 -MaximumRedirection 0 | Out-Null
        $script:State.uploaded[$relative] = $hash
        Save-State
    }
    $tables = Get-Content -LiteralPath (Join-Path $core 'tables/tables.json') -Raw | ConvertFrom-Json
    foreach ($table in $tables) {
        Invoke-Fabric -Path "workspaces/$workspaceId/lakehouses/$lakehouseId/tables/$($table.table)/load" -Method 'POST' -Body @{
            relativePath="Files/$prefix/tables/$($table.file)"; pathType='File'; mode='Overwrite'
            formatOptions=@{format='Parquet'}
        } | Out-Null
    }
    New-DemoResult 'INGEST.TABLES' 'Pass' 'Five analytical tables loaded using the supported writer API. SQL analytics endpoint is read-only.'
    if (-not $script:State.appItemId -and @($items | Where-Object { $_.displayName -eq $appName -and $_.type -eq 'AppBackend' }).Count) {
        throw 'A same-name app already exists outside this environment state. Review its identity before adopting it.'
    }
    $stage = Join-Path $stateDirectory 'project'
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    foreach ($folder in @('src','contracts','scripts')) {
        Copy-Item -LiteralPath (Join-Path $Root $folder) -Destination $stage -Recurse -Force
    }
    foreach ($file in @('package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html')) {
        Copy-Item -LiteralPath (Join-Path $Root $file) -Destination $stage -Force
    }
    $stageRayfin = Join-Path $stage 'rayfin'
    New-Item -ItemType Directory -Path $stageRayfin -Force | Out-Null
    foreach ($folder in @('data')) { Copy-Item -LiteralPath (Join-Path $Root "rayfin/$folder") -Destination $stageRayfin -Recurse -Force }
    foreach ($file in @('rayfin.yml','tsconfig.json')) { Copy-Item -LiteralPath (Join-Path $Root "rayfin/$file") -Destination $stageRayfin -Force }
    $functionStage = Join-Path $stageRayfin 'functions'
    New-Item -ItemType Directory -Path $functionStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root 'rayfin/functions/src') -Destination $functionStage -Recurse -Force
    foreach ($file in @('package.json','package-lock.json','tsconfig.json','host.json')) {
        Copy-Item -LiteralPath (Join-Path $Root "rayfin/functions/$file") -Destination $functionStage -Force
    }
    $resolved = @{
        workspaceId=$workspaceId; lakehouseId=$lakehouseId; oneLakeFilesPath=$filesUri.AbsoluteUri
        sqlEndpoint=$lakehouse.properties.sqlEndpointProperties.connectionString
        sqlDatabase=$lakehouse.properties.sqlEndpointProperties.id; experimentId='spheroid-screen-001'
    }
    "export const target = $($resolved | ConvertTo-Json -Compress);" | Set-Content -LiteralPath (Join-Path $functionStage 'src/target.ts') -Encoding utf8
    Invoke-Checked -Program 'npm' -Arguments @('ci','--no-audit','--no-fund') -Directory $stage
    Invoke-Checked -Program 'npm' -Arguments @('ci','--no-audit','--no-fund') -Directory $functionStage
    Invoke-Checked -Program 'npm' -Arguments @('run','build') -Directory $functionStage
    $previousToken = $env:RAYFIN_TOKEN
    $env:RAYFIN_TOKEN = $script:FabricToken
    try {
        Invoke-Checked -Program 'npx' -Arguments @('--no-install','rayfin','up','--workspace-id',$workspaceId,
            '--tenant',$script:Config.tenantId,'--item-name',$appName,'--exclude-services','staticHosting','-y') -Directory $stage
        $deployed = @(Get-FabricList -Path "workspaces/$workspaceId/items" | Where-Object { $_.displayName -eq $appName -and $_.type -eq 'AppBackend' })
        if ($deployed.Count -ne 1) { throw 'Could not resolve exactly one deployed app.' }
        if (-not $script:State.appItemId) {
            $script:State.appItemId = $deployed[0].id
            $script:State.created += @{id=$deployed[0].id; type='AppBackend'; name=$appName}
            Save-State
        } elseif ($script:State.appItemId -ne $deployed[0].id) { throw 'CLI resolved an app different from the intended item ID.' }
        Invoke-Checked -Program 'npx' -Arguments @('--no-install','rayfin','env','--framework','vite') -Directory $stage
        Invoke-Checked -Program 'npx' -Arguments @('--no-install','rayfin','up','--workspace-id',$workspaceId,
            '--tenant',$script:Config.tenantId,'--item-name',$appName,'-y') -Directory $stage
        Invoke-Checked -Program 'npx' -Arguments @('--no-install','rayfin','up','status') -Directory $stage
    } finally { $env:RAYFIN_TOKEN = $previousToken }
    New-DemoResult 'DEPLOY.APPLIED' 'Warning' 'Deployment commands completed. Actual app image retrieval, SQL rows, review persistence and unauthorized-identity access still require fabric:smoke.'
} catch {
    New-DemoResult 'FABRIC.OPERATION' 'Fail' $_.Exception.Message
    exit 1
} finally {
    $script:Secrets.Clear()
    $script:FabricToken = ''
}
