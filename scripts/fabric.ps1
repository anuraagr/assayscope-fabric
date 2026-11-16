#Requires -Version 7.4
<#
Documented contracts and API references: docs/deployment.md.
No login, context mutation, capacity creation, tenant setting changes or role grants.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('doctor', 'plan', 'apply', 'smoke', 'cleanup',
        'research-plan', 'research-apply', 'research-run', 'research-status')][string]$Action,
    [string]$ConfigPath = 'config/tenant.local.json',
    [switch]$Offline,
    [switch]$ConfirmCosts,
    [string]$ConfirmDelete = '',
    [switch]$WriteReview,
    [switch]$DefinitionsOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$script:Config = $null
$script:Secrets = [System.Collections.Generic.List[string]]::new()
$script:State = $null
$script:StatePath = $null
$script:FabricToken = ''
$script:FabricSkill = if ($Action.StartsWith('research-')) { 'spark-authoring-cli' } else { '' }

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
    try {
        return ($output -join "`n") | ConvertFrom-Json -AsHashtable
    } catch {
        if ('get-access-token' -notin $Arguments) {
            $diagnostic = $output -join "`n"
            Write-DemoLog ("AZURE.OUTPUT | Invalid JSON | " + $diagnostic.Substring(0, [Math]::Min(2048, $diagnostic.Length)))
        }
        throw 'Azure CLI did not return valid JSON. No identity, token or deployment success was inferred.'
    }
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
    $response = Invoke-DemoAz -Arguments @('account','get-access-token','--resource',$Resource)
    if ($response['accessToken'] -isnot [string] -or [string]::IsNullOrWhiteSpace($response['accessToken'])) {
        throw 'Azure CLI did not return a usable access token.'
    }
    $script:Secrets.Add($response.accessToken)
    if ($response['tenant'] -ne $script:Config.tenantId -or $response['subscription'] -ne $script:Config.subscriptionId) {
        throw 'Azure CLI returned a token for a different tenant or subscription.'
    }
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
            'Notebook' { 'researchNotebookId' }
            'Ontology' { 'ontologyId' }
            'DataAgent' { 'dataAgentId' }
            default { throw 'Deployment state contains an unsupported cleanup resource type.' }
        }
        $parsed = [Guid]::Empty
        if (-not [Guid]::TryParse($item.id, [ref]$parsed) -or $parsed -eq [Guid]::Empty -or
            $item.id -ne $State[$key] -or [string]::IsNullOrWhiteSpace($item.name)) {
            throw 'Cleanup ownership does not match the recorded resource.'
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
function Send-DemoFile {
    param([IO.FileInfo]$File, [string]$Core, [string]$PrefixUrl, [hashtable]$Headers, [hashtable]$Uploaded)
    $ErrorActionPreference = 'Stop'
    $relative = [IO.Path]::GetRelativePath($Core, $File.FullName).Replace('\','/')
    $hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
    try {
        if ($Uploaded.ContainsKey($relative) -and $Uploaded[$relative] -eq $hash) {
            $head = Invoke-WebRequest -Uri "$PrefixUrl/$relative" -Method Head -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 30 -MaximumRedirection 0
            if ($head.StatusCode -eq 200 -and [long]($head.Headers.'Content-Length' | Select-Object -First 1) -eq $File.Length) {
                return @{relative=$relative; hash=$hash; uploaded=$false; failure=$null}
            }
            if ($head.StatusCode -notin @(200,404)) { throw "OneLake read failed (HTTP $($head.StatusCode)); upload stopped." }
        }
        $result = Invoke-WebRequest -Uri "$PrefixUrl/$relative" -Method Put -Headers $Headers -InFile $File.FullName -ContentType 'application/octet-stream' -TimeoutSec 120 -MaximumRedirection 0 -SkipHttpErrorCheck
        if ($result.StatusCode -notin @(200,201)) { throw "OneLake upload failed (HTTP $($result.StatusCode))." }
        return @{relative=$relative; hash=$hash; uploaded=$true; failure=$null}
    } catch {
        return @{relative=$relative; hash=$hash; uploaded=$false; failure="Upload failed for ${relative}: $($_.Exception.Message)"}
    }
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
    param([string]$Path, [string]$Method = 'GET', [object]$Body = $null,
          [switch]$ReturnOperationResult, [switch]$NoRetry)
    $url = if ($Path -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { $Path } else { "https://api.fabric.microsoft.com/v1/$Path" }
    Assert-FabricUrl -Url $url
    $uri = [Uri]$url
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $parameters = @{
            Uri = $url; Method = $Method; Headers = @{Authorization = "Bearer $script:FabricToken"}
            TimeoutSec = 60; SkipHttpErrorCheck = $true; MaximumRedirection = 0
        }
        if ($script:FabricSkill) { $parameters.Headers['x-ms-fabric-skill'] = $script:FabricSkill }
        if ($null -ne $Body) { $parameters.Body = $Body | ConvertTo-Json -Depth 40 -Compress; $parameters.ContentType = 'application/json' }
        $response = Invoke-WebRequest @parameters
        if ($response.StatusCode -eq 429 -or $response.StatusCode -ge 500) {
            if (-not $NoRetry -and $attempt -lt 2) { Start-Sleep -Seconds ([Math]::Pow(2, $attempt + 1)); continue }
        }
        if ($response.StatusCode -ge 400) { throw "Fabric returned HTTP $($response.StatusCode) for $Method $($uri.AbsolutePath). Check intended identity and permissions." }
        if ($response.StatusCode -ge 300) { throw "Fabric returned an unexpected redirect (HTTP $($response.StatusCode)); credentials were not forwarded." }
        if ($response.StatusCode -eq 202) {
            $operationId = [string]($response.Headers['x-ms-operation-id'] | Select-Object -First 1)
            if ($operationId) {
                $parsed = [Guid]::Empty
                if (-not [Guid]::TryParse($operationId, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
                    throw 'Fabric returned an invalid long-running operation ID.'
                }
                $operation = "https://api.fabric.microsoft.com/v1/operations/$parsed"
            } else {
                $operation = [string]($response.Headers['Location'] | Select-Object -First 1)
            }
            Assert-FabricUrl -Url $operation
            $wait = 5
            $retryAfter = [string]($response.Headers['Retry-After'] | Select-Object -First 1)
            if ($retryAfter -and (-not [int]::TryParse($retryAfter, [ref]$wait) -or $wait -lt 1 -or $wait -gt 600)) {
                throw 'Fabric Retry-After is outside the bounded 10-minute operation wait.'
            }
            Write-DemoLog "FABRIC.LRO | Pending | $operation"
            $deadline = [DateTime]::UtcNow.AddMinutes(10)
            $complete = $false
            for ($poll = 0; $poll -lt 120 -and [DateTime]::UtcNow -lt $deadline; $poll++) {
                Start-Sleep -Seconds $wait
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
function Restore-DemoNodeDependencies {
    param([string]$Directory, [switch]$LockfileChanged)
    Push-Location -LiteralPath $Directory
    try {
        $check = & npm ls --depth=0 --json 2>&1
        if ($LASTEXITCODE -eq 0 -and -not $LockfileChanged) {
            Write-DemoLog 'DEPENDENCIES | Pass | Existing installed packages satisfy the staged manifest.'
            return
        }
        Write-DemoLog ($check -join "`n")
        Write-DemoLog 'DEPENDENCIES | Restore | Lockfile changed or installed dependencies are missing/inconsistent; restoring the exact lockfile.'
        Invoke-Checked -Program 'npm' -Arguments @('ci','--no-audit','--no-fund') -Directory $Directory
    } finally { Pop-Location }
}
function Resolve-Python {
    $candidate = if ($IsWindows) { Join-Path $Root '.venv\Scripts\python.exe' } else { Join-Path $Root '.venv/bin/python' }
    if (-not (Test-Path -LiteralPath $candidate)) { throw 'Create the Python 3.12 virtual environment and install requirements.txt first.' }
    return $candidate
}
function Get-DemoNotebookHash {
    param([hashtable]$Notebook)
    $cells = @($Notebook.cells | ForEach-Object {
        [ordered]@{type=$_.cell_type; source=($_.source -join '')}
    })
    $content = [ordered]@{
        cells=$cells
        lakehouse=$Notebook.metadata.dependencies.lakehouse.default_lakehouse
        workspace=$Notebook.metadata.dependencies.lakehouse.default_lakehouse_workspace_id
    } | ConvertTo-Json -Depth 40 -Compress
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($content))).ToLowerInvariant()
}
function New-DemoNotebookDefinition {
    param([string]$Path, [hashtable]$Lakehouse, [string]$WorkspaceId)
    if ((Get-Item -LiteralPath $Path).Length -gt 2MB) { throw 'Research notebook exceeds the 2 MiB source bound.' }
    $notebook = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
    if ($notebook.nbformat -ne 4 -or -not $notebook.metadata.assayscope.read_only -or
        $notebook.metadata.ContainsKey('dependencies')) {
        throw 'Research notebook must be an unbound, read-only source template.'
    }
    foreach ($cell in $notebook.cells) {
        if ($cell.cell_type -eq 'code' -and (@($cell.outputs).Count -or $null -ne $cell.execution_count)) {
            throw 'Notebook source must not contain execution outputs.'
        }
    }
    foreach ($value in @($WorkspaceId, $Lakehouse.id)) {
        $parsed = [Guid]::Empty
        if (-not [Guid]::TryParse($value, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
            throw 'Notebook binding requires verified workspace and Lakehouse GUIDs.'
        }
    }
    if ($Lakehouse.type -ne 'Lakehouse' -or [string]::IsNullOrWhiteSpace($Lakehouse.displayName)) {
        throw 'Notebook binding requires a resolved Lakehouse.'
    }
    $notebook.metadata.dependencies = @{
        lakehouse=@{
            default_lakehouse=$Lakehouse.id
            default_lakehouse_name=$Lakehouse.displayName
            default_lakehouse_workspace_id=$WorkspaceId
            known_lakehouses=@(@{id=$Lakehouse.id})
        }
    }
    $json = $notebook | ConvertTo-Json -Depth 40 -Compress
    return @{
        hash=(Get-DemoNotebookHash $notebook)
        definition=@{
            format='ipynb'
            parts=@(@{path='notebook-content.ipynb'; payloadType='InlineBase64'
                payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))})
        }
    }
}
function Read-DemoResearchNotebook {
    param([string]$NotebookId)
    $live = Invoke-Fabric "workspaces/$($script:Config.workspaceId)/notebooks/$NotebookId/getDefinition?format=ipynb" 'POST' @{} -ReturnOperationResult
    $parts = @($live.definition.parts | Where-Object { $_.path -like '*.ipynb' })
    if ($parts.Count -ne 1) { throw 'Could not read the recorded notebook definition before updating or executing.' }
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[0].payload)) | ConvertFrom-Json -AsHashtable
}
function Publish-DemoResearchNotebook {
    param([array]$Items, [hashtable]$Lakehouse, [string]$TemplatePath)
    $workspaceId = $script:Config.workspaceId
    $name = "assayscope-$($script:Config.environment)-research-review"
    $prepared = New-DemoNotebookDefinition $TemplatePath $Lakehouse $workspaceId
    $id = $script:State['researchNotebookId']
    if ($id) {
        $current = @($Items | Where-Object { $_.id -eq $id -and $_.type -eq 'Notebook' })
        if ($current.Count -ne 1 -or $current[0].displayName -ne $name) {
            throw 'Recorded research notebook is missing or renamed; no item was overwritten.'
        }
        $decoded = Read-DemoResearchNotebook $id
        $liveHash = Get-DemoNotebookHash $decoded
        if ($liveHash -eq $prepared.hash) {
            New-DemoResult 'RESEARCH.CONTENT' 'Pass' 'The existing notebook matches source and its intended Lakehouse binding.'
            return
        }
        if ($liveHash -ne $script:State['researchContentHash']) {
            throw 'Notebook was edited outside this source deployment. Preserve and reconcile those edits before applying.'
        }
        Invoke-Fabric "workspaces/$workspaceId/notebooks/$id/updateDefinition" 'POST' @{definition=$prepared.definition} -NoRetry | Out-Null
    } else {
        if (@($Items | Where-Object { $_.displayName -eq $name }).Count) {
            throw 'A same-name notebook exists without recorded ownership. No duplicate or overwrite was attempted.'
        }
        $created = Invoke-Fabric "workspaces/$workspaceId/notebooks" 'POST' @{
            displayName=$name
            description='Read-only control dispersion, QC sensitivity, technical replication and source lineage for the simulated AssayScope assay.'
            definition=$prepared.definition
        } -ReturnOperationResult -NoRetry
        $parsed = [Guid]::Empty
        if (-not [Guid]::TryParse($created.id, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
            throw 'Notebook creation did not return an item GUID. Inspect the workspace; do not retry creation blindly.'
        }
        $script:State.researchNotebookId = $created.id
        $script:State.created += @{id=$created.id; type='Notebook'; name=$name}
    }
    $script:State.researchContentHash = $prepared.hash
    Save-State
    New-DemoResult 'RESEARCH.DEPLOYED' 'Pass' "Read-only notebook $($script:State.researchNotebookId) is attached to the existing Lakehouse. Spark was not started."
}
function Start-DemoResearchJob {
    param([string]$NotebookId)
    $workspaceId = $script:Config.workspaceId
    $url = "https://api.fabric.microsoft.com/v1/workspaces/$workspaceId/items/$NotebookId/jobs/RunNotebook/instances"
    $response = Invoke-WebRequest -Uri $url -Method POST -Headers @{Authorization="Bearer $script:FabricToken"; 'x-ms-fabric-skill'='spark-authoring-cli'} `
        -ContentType 'application/json' -Body '{}' -TimeoutSec 60 -MaximumRedirection 0 -SkipHttpErrorCheck
    if ($response.StatusCode -ne 202) {
        throw "Notebook run returned HTTP $($response.StatusCode). Check recent jobs before any retry; no automatic POST retry was made."
    }
    $location = [string]($response.Headers['Location'] | Select-Object -First 1)
    Assert-FabricUrl $location
    $expected = "^https://api\.fabric\.microsoft\.com/v1/workspaces/$workspaceId/items/$NotebookId/jobs/instances/([0-9a-fA-F-]{36})$"
    if ($location -notmatch $expected) {
        throw 'Notebook job location does not match the intended item. Inspect recent jobs before retrying.'
    }
    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParse($Matches[1], [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
        throw 'Notebook job returned an invalid instance ID.'
    }
    $script:State.researchJobId = $parsed.ToString()
    $script:State.researchJobSubmittedAt = [DateTime]::UtcNow.ToString('o')
    Save-State
    $wait = 15
    $header = [string]($response.Headers['Retry-After'] | Select-Object -First 1)
    if ($header -and (-not [int]::TryParse($header, [ref]$wait) -or $wait -lt 1 -or $wait -gt 600)) {
        throw 'Notebook job Retry-After is outside the bounded wait. The recorded job must be monitored, not resubmitted.'
    }
    Write-DemoLog "RESEARCH.JOB | Submitted | $($script:State.researchJobId)"
    Start-Sleep -Seconds $wait
}
function Wait-DemoResearchJob {
    param([string]$NotebookId, [switch]$Once)
    $jobId = $script:State['researchJobId']
    if (-not $jobId) { throw 'No research job is recorded. Apply the notebook, then explicitly run it.' }
    foreach ($value in @($NotebookId, $jobId)) {
        $parsed = [Guid]::Empty
        if (-not [Guid]::TryParse($value, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
            throw 'Research notebook/job identities must be valid GUIDs.'
        }
    }
    $path = "workspaces/$($script:Config.workspaceId)/items/$NotebookId/jobs/instances/$jobId"
    $deadline = [DateTime]::UtcNow.AddMinutes(15)
    for ($poll = 0; $poll -lt 60 -and [DateTime]::UtcNow -lt $deadline; $poll++) {
        $job = Invoke-Fabric $path
        $script:State.researchJobStatus = $job.status
        Save-State
        Write-DemoLog "RESEARCH.JOB | $($job.status) | $jobId"
        if ($job.status -eq 'Completed') { return $job }
        if ($job.status -in @('Failed','Cancelled','Deduped')) {
            throw "Notebook job $jobId ended with $($job.status). Inspect its Fabric run output; source data was not modified."
        }
        if ($job.status -notin @('NotStarted','InProgress')) { throw 'Unknown notebook job state; do not resubmit.' }
        if ($Once) { return $job }
        Start-Sleep -Seconds 15
    }
    throw "Notebook job $jobId is still pending. Use fabric:research:status; do not submit another run."
}
function Get-DemoResearchReceipt {
    param([string]$NotebookId)
    $jobId = $script:State.researchJobId
    $detail = Invoke-Fabric "workspaces/$($script:Config.workspaceId)/notebooks/$NotebookId/jobs/execute/instances/$jobId`?beta=true"
    if ($detail.id -ne $jobId -or $detail.itemId -ne $NotebookId -or $detail.status -ne 'Completed') {
        throw 'Notebook execution receipt does not match the recorded completed job.'
    }
    $raw = $detail.properties.exitValue
    if ($raw -isnot [string] -or $raw.Length -gt 65536) {
        throw 'The completed notebook did not return a bounded research receipt.'
    }
    $receipt = $raw | ConvertFrom-Json -AsHashtable
    if ($receipt.experiment_id -ne 'spheroid-screen-001' -or
        $receipt.input_tables_sha256 -isnot [string] -or $receipt.input_tables_sha256 -notmatch '^[a-f0-9]{64}$' -or
        $receipt.table_rows -isnot [hashtable] -or $receipt.table_rows.Count -ne 5 -or
        @($receipt.runs).Count -lt 1 -or @($receipt.runs).Count -gt 10000) {
        throw 'The notebook receipt does not match the registered research output contract.'
    }
    foreach ($table in @('experiments','acquisitions','measurements','qc','provenance')) {
        $count = $receipt.table_rows["assayscope_$table"]
        if (($count -isnot [int] -and $count -isnot [long]) -or $count -lt 1 -or $count -gt 10000) {
            throw 'The notebook receipt has missing or unbounded analytical table counts.'
        }
    }
    $total = 0
    foreach ($run in $receipt.runs) {
        foreach ($key in @('total_wells','included_wells','excluded_wells','unmeasured_wells','included_control_wells')) {
            $count = $run[$key]
            if (($count -isnot [int] -and $count -isnot [long]) -or $count -lt 0 -or $count -gt 10000) {
                throw 'The notebook receipt has invalid technical-well counts.'
            }
        }
        if ($run.total_wells -ne ($run.included_wells + $run.excluded_wells + $run.unmeasured_wells) -or
            $run.included_control_wells -gt $run.included_wells) {
            throw 'The notebook receipt has inconsistent technical-well accounting.'
        }
        $total += $run.total_wells
    }
    if ($total -ne $receipt.table_rows.assayscope_measurements) {
        throw 'Notebook run counts disagree with measurement-table rows.'
    }
    foreach ($key in @('condition_count','flagged_well_count')) {
        $count = $receipt[$key]
        if (($count -isnot [int] -and $count -isnot [long]) -or $count -lt 0 -or $count -gt 10000) {
            throw 'The notebook receipt has invalid research summary counts.'
        }
    }
    return @{jobId=$jobId; status=$detail.status; startTimeUtc=$detail.startTimeUtc
        endTimeUtc=$detail.endTimeUtc; result=$receipt}
}

if ($DefinitionsOnly) { return }

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
        if ($Action -notin @('doctor','plan','research-plan')) { throw 'Offline mode supports doctor, plan and research-plan only.' }
        if ($Action -eq 'research-plan') {
            Invoke-Checked -Program $python -Arguments @('-m','scripts.build_research_notebook','--check')
            New-DemoResult 'RESEARCH.PLAN' 'Pass' 'One optional read-only notebook attached to the existing Lakehouse. Apply does not start Spark; an explicit run consumes existing capacity. No new capacity, model, schedule, data writes or permissions.'
            exit 0
        }
        New-DemoResult 'PLAN.RESOURCES' 'Warning' 'One protected Fabric AppBackend and child SQL/Functions/static services, one dedicated Lakehouse, five analytical tables, and bounded image assets. Existing capacity only.'
        New-DemoResult 'CLOUD.VERIFICATION' 'Not selected' 'Offline plan: no authentication or cloud calls. Tenant, capacity, app availability, access and costs remain unverified.'
        exit 0
    }
    $script:Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
    Assert-DemoConfig -Configuration $script:Config
    if ($Action -eq 'apply' -and (-not $ConfirmCosts -or -not $supportedNode)) {
        throw 'Apply requires supported Node 24 and --confirm-costs after reviewing the plan. No paid capacity is created.'
    }
    if ($Action -in @('research-apply','research-run') -and -not $ConfirmCosts) {
        throw 'Research deployment/execution requires --confirm-costs and the configured existing target.'
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
        foreach ($owned in @($script:State.created | Sort-Object -Property @{Expression={ switch ($_.type) { 'DataAgent' {0} 'Ontology' {1} 'Notebook' {2} 'AppBackend' {3} default {4} } }})) {
            $current = @($items | Where-Object { $_.id -eq $owned.id })
            if ($current.Count -eq 0) { continue }
            if ($current[0].type -ne $owned.type -or $current[0].displayName -ne $owned.name) {
                throw 'An owned item changed identity/name. Cleanup stopped rather than deleting an unverified resource.'
            }
            Invoke-Fabric -Path "workspaces/$workspaceId/items/$($owned.id)" -Method 'DELETE' | Out-Null
        }
        $script:State.created = @(); $script:State.lakehouseId = ''; $script:State.appItemId = ''; $script:State.uploaded = @{}
        foreach ($key in @('researchNotebookId','researchContentHash','researchJobId','researchJobStatus','researchJobSubmittedAt')) {
            $script:State.Remove($key)
        }
        foreach ($key in @('ontologyId','dataAgentId','knowledgeContentHashes','knowledgeDefinitionHashes','knowledgeUploaded','knowledgeTableOwnership','knowledgeLoaded')) {
            $script:State.Remove($key)
        }
        Save-State
        New-DemoResult 'CLEANUP' 'Pass' 'Deleted only recorded demo-created items. Existing items, workspace, capacity, and local files were not deleted; soft-delete retention can continue billing.'
        exit 0
    }
    if ($Action.StartsWith('research-')) {
        if (-not $script:State.lakehouseId) { throw 'Deploy or explicitly configure the existing analytical Lakehouse first.' }
        $lakehouses = @($items | Where-Object { $_.id -eq $script:State.lakehouseId -and $_.type -eq 'Lakehouse' })
        if ($lakehouses.Count -ne 1) { throw 'The recorded Lakehouse is not accessible in the intended workspace.' }
        Invoke-Checked -Program $python -Arguments @('-m','scripts.build_research_notebook','--check')
        New-DemoResult 'RESEARCH.PLAN' 'Pass' 'One read-only research notebook; existing Lakehouse and capacity. No table writes, schedules, model service, policy changes or additional capacity.'
        if ($Action -eq 'research-plan') { exit 0 }
        if ($Action -eq 'research-apply') {
            Publish-DemoResearchNotebook -Items $items -Lakehouse $lakehouses[0] -TemplatePath (Join-Path $Root 'notebooks/research-review.ipynb')
            exit 0
        }
        $notebookId = $script:State['researchNotebookId']
        if (-not $notebookId -or @($items | Where-Object { $_.id -eq $notebookId -and $_.type -eq 'Notebook' }).Count -ne 1) {
            throw 'No accessible recorded research notebook; apply it first.'
        }
        if ($Action -eq 'research-run') {
            $prepared = New-DemoNotebookDefinition (Join-Path $Root 'notebooks/research-review.ipynb') $lakehouses[0] $workspaceId
            $liveHash = Get-DemoNotebookHash (Read-DemoResearchNotebook $notebookId)
            if ($liveHash -ne $prepared.hash) {
                throw 'The deployed notebook differs from reviewed source. Reconcile/apply before executing; no job was submitted.'
            }
            $jobs = @(Get-FabricList "workspaces/$workspaceId/items/$notebookId/jobs/instances")
            $recent = @($jobs | Where-Object {
                $_.status -in @('NotStarted','InProgress') -or
                [DateTime]::Parse($_.startTimeUtc).ToUniversalTime() -ge [DateTime]::UtcNow.AddMinutes(-5)
            } | Sort-Object startTimeUtc -Descending)
            if ($recent.Count) {
                $script:State.researchJobId = $recent[0].id
                Save-State
                New-DemoResult 'RESEARCH.REUSE' 'Pass' 'Monitoring an active/recent notebook job instead of creating a duplicate.'
            } else {
                Start-DemoResearchJob $notebookId
            }
        }
        $job = Wait-DemoResearchJob $notebookId -Once:($Action -eq 'research-status')
        $job | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stateDirectory 'research-job.json') -Encoding utf8
        if ($job.status -eq 'Completed') {
            $receipt = Get-DemoResearchReceipt $notebookId
            $receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stateDirectory 'research-receipt.json') -Encoding utf8
            New-DemoResult 'RESEARCH.RECEIPT' 'Pass' "Actual notebook output: $($receipt.result.condition_count) condition/run rows; $($receipt.result.flagged_well_count) flagged wells. See research-receipt.json in this environment's state directory."
        }
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
                Invoke-Checked -Program 'npx' -Arguments @('--offline','--no-install','rayfin','up','--dry-run','--workspace-id',
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
    $processedFiles = 0
    $uploadWorker = ${function:Send-DemoFile}.ToString()
    $priorUploads = $script:State.uploaded.Clone()
    $prefixUrl = "$blobRoot/$prefix"
    $uploadFiles | ForEach-Object -Parallel {
        $worker = [scriptblock]::Create($using:uploadWorker)
        & $worker -File $_ -Core $using:core -PrefixUrl $using:prefixUrl -Headers $using:headers -Uploaded $using:priorUploads
    } -ThrottleLimit 4 | ForEach-Object {
        if ($_.failure) { throw $_.failure }
        $script:State.uploaded[$_.relative] = $_.hash
        Save-State
        $processedFiles++
        if ($processedFiles % 100 -eq 0 -or $processedFiles -eq $uploadFiles.Count) {
            Write-DemoLog "INGEST.FILES | Progress | $processedFiles/$($uploadFiles.Count) files verified or uploaded."
        }
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
    $stageLock = Join-Path $stage 'package-lock.json'
    $stageLockBefore = if (Test-Path -LiteralPath $stageLock) { (Get-FileHash -LiteralPath $stageLock -Algorithm SHA256).Hash } else { '' }
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
    $functionLock = Join-Path $functionStage 'package-lock.json'
    $functionLockBefore = if (Test-Path -LiteralPath $functionLock) { (Get-FileHash -LiteralPath $functionLock -Algorithm SHA256).Hash } else { '' }
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
    Restore-DemoNodeDependencies -Directory $stage -LockfileChanged:($stageLockBefore -ne (Get-FileHash -LiteralPath $stageLock -Algorithm SHA256).Hash)
    Restore-DemoNodeDependencies -Directory $functionStage -LockfileChanged:($functionLockBefore -ne (Get-FileHash -LiteralPath $functionLock -Algorithm SHA256).Hash)
    Invoke-Checked -Program 'npm' -Arguments @('run','build') -Directory $functionStage
    $previousToken = $env:RAYFIN_TOKEN
    $env:RAYFIN_TOKEN = $script:FabricToken
    try {
        Invoke-Checked -Program 'npx' -Arguments @('--offline','--no-install','rayfin','up','--workspace-id',$workspaceId,
            '--tenant',$script:Config.tenantId,'--item-name',$appName,'--exclude-services','staticHosting','-y') -Directory $stage
        $deployed = @(Get-FabricList -Path "workspaces/$workspaceId/items" | Where-Object { $_.displayName -eq $appName -and $_.type -eq 'AppBackend' })
        if ($deployed.Count -ne 1) { throw 'Could not resolve exactly one deployed app.' }
        if (-not $script:State.appItemId) {
            $script:State.appItemId = $deployed[0].id
            $script:State.created += @{id=$deployed[0].id; type='AppBackend'; name=$appName}
            Save-State
        } elseif ($script:State.appItemId -ne $deployed[0].id) { throw 'CLI resolved an app different from the intended item ID.' }
        Invoke-Checked -Program 'npx' -Arguments @('--offline','--no-install','rayfin','env','--framework','vite') -Directory $stage
        Invoke-Checked -Program 'npx' -Arguments @('--offline','--no-install','rayfin','up','--workspace-id',$workspaceId,
            '--tenant',$script:Config.tenantId,'--item-name',$appName,'-y') -Directory $stage
        Invoke-Checked -Program 'npx' -Arguments @('--offline','--no-install','rayfin','up','status') -Directory $stage
    } finally { $env:RAYFIN_TOKEN = $previousToken }
    New-DemoResult 'DEPLOY.APPLIED' 'Warning' 'Deployment commands completed. Actual app image retrieval, SQL rows, review persistence and unauthorized-identity access still require fabric:smoke.'
} catch {
    New-DemoResult 'FABRIC.OPERATION' 'Fail' $_.Exception.Message
    exit 1
} finally {
    $script:Secrets.Clear()
    $script:FabricToken = ''
}
