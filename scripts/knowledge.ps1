#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('plan','apply','publish','smoke','evaluate')][string]$Action,
    [string]$ConfigPath = 'config/tenant.local.json',
    [switch]$Offline,
    [switch]$ConfirmCosts
)
$knowledgeAction = $Action
$knowledgeConfigPath = $ConfigPath
$knowledgeOffline = $Offline
$knowledgeCosts = $ConfirmCosts
. (Join-Path $PSScriptRoot 'fabric.ps1') -Action doctor -DefinitionsOnly
$Action = $knowledgeAction
$ConfigPath = $knowledgeConfigPath
$Offline = $knowledgeOffline
$ConfirmCosts = $knowledgeCosts
$script:FabricSkill = 'fabriciq-ontology-cli'

function Get-KnowledgeHash {
    param([hashtable]$Definition)
    if ($Definition.parts.Count -gt 100) { throw 'Knowledge definition exceeds its bounded part count.' }
    $parts = @($Definition.parts | Where-Object { $_.path -ne '.platform' } | Sort-Object path | ForEach-Object {
        $content = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_.payload)).Replace("`r`n","`n")
        [ordered]@{path=$_.path; content=$content}
    })
    $json = ConvertTo-Json -InputObject $parts -Depth 20 -Compress
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json))).ToLowerInvariant()
}
function Read-KnowledgeDefinition {
    param([string]$Id, [string]$Type)
    $plural = if ($Type -eq 'Ontology') { 'ontologies' } else { 'dataAgents' }
    $result = Invoke-Fabric "workspaces/$($script:Config.workspaceId)/$plural/$Id/getDefinition" 'POST' @{} -ReturnOperationResult
    if (-not $result.definition -or -not $result.definition.parts) { throw 'Knowledge definition readback is missing.' }
    return $result.definition
}
function Assert-KnowledgeReadback {
    param([hashtable]$Definition, [string]$Type, [switch]$Published)
    $paths = @($Definition.parts.path)
    if ($Type -eq 'Ontology') {
        foreach ($required in @('database.tmdl','model.tmdl','expressions.tmdl','entityRelationships.tmdl','relationships.tmdl')) {
            if ($required -notin $paths) { throw "Ontology readback is missing $required." }
        }
        if (@($paths | Where-Object { $_ -like 'entities/*.tmdl' }).Count -ne 7 -or
            @($paths | Where-Object { $_ -like 'tables/*.tmdl' }).Count -ne 7) {
            throw 'Ontology readback does not contain all seven bound research entities.'
        }
        $expression = $Definition.parts | Where-Object { $_.path -eq 'expressions.tmdl' }
        $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($expression.payload))
        if (-not $text.Contains($script:KnowledgeTarget.sqlEndpoint) -or -not $text.Contains($script:KnowledgeTarget.sqlDatabase)) {
            throw 'Ontology is not bound to the resolved dedicated SQL endpoint.'
        }
    } else {
        $stages = if ($Published) { @('draft','published') } else { @('draft') }
        foreach ($stage in $stages) {
            $sources = @($Definition.parts | Where-Object { $_.path -like "Files/Config/$stage/*/datasource.json" })
            if ($sources.Count -ne 1) { throw 'Data agent must have exactly the selected Lakehouse source.' }
            $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sources[0].payload)) | ConvertFrom-Json -AsHashtable
            if ($source.artifactId -ne $script:State.lakehouseId -or $source.workspaceId -ne $script:Config.workspaceId) {
                throw 'Data agent source is not the configured Lakehouse.'
            }
            $selected = @($source.elements.children | Where-Object { $_.is_selected } | ForEach-Object { $_.display_name } | Sort-Object)
            if (($selected -join ',') -ne (($script:KnowledgeTables.table | Sort-Object) -join ',')) {
                throw 'Data-agent selected tables differ from the reviewed seven-table allowlist.'
            }
        }
    }
}
function Merge-KnowledgeDraft {
    param([hashtable]$Desired, [hashtable]$Current)
    if (@($Desired.parts | Where-Object { $_.path -like 'Files/Config/published/*' -or $_.path -eq 'Files/Config/publish_info.json' }).Count) {
        throw 'A draft apply cannot replace published configuration.'
    }
    $published = @($Current.parts | Where-Object { $_.path -like 'Files/Config/published/*' -or $_.path -eq 'Files/Config/publish_info.json' })
    return @{parts=@($Desired.parts) + $published}
}
function Set-KnowledgeItem {
    param([string]$Type, [string]$Name, [hashtable]$Definition, [array]$Items, [switch]$Published)
    $key = if ($Type -eq 'Ontology') { 'ontologyId' } else { 'dataAgentId' }
    $plural = if ($Type -eq 'Ontology') { 'ontologies' } else { 'dataAgents' }
    $desiredHash = Get-KnowledgeHash $Definition
    $id = $script:State[$key]
    if ($id) {
        $matches = @($Items | Where-Object { $_.id -eq $id -and $_.type -eq $Type -and $_.displayName -eq $Name })
        if ($matches.Count -ne 1) { throw 'Recorded knowledge item is missing or renamed; no overwrite was attempted.' }
        $live = Read-KnowledgeDefinition $id $Type
        $liveHash = Get-KnowledgeHash $live
        if ($liveHash -ne $script:State.knowledgeDefinitionHashes[$key]) {
            throw 'Knowledge item was edited externally. Preserve and reconcile the live definition before deploying.'
        }
        if ($Type -eq 'DataAgent' -and -not $Published) {
            $Definition = Merge-KnowledgeDraft $Definition $live
            $desiredHash = Get-KnowledgeHash $Definition
        }
        if ($desiredHash -eq $script:State.knowledgeContentHashes[$key]) {
            Assert-KnowledgeReadback $live $Type -Published:$Published
            New-DemoResult 'KNOWLEDGE.UNCHANGED' 'Pass' "$Type source and persisted readback match."
            return
        }
        Invoke-Fabric "workspaces/$($script:Config.workspaceId)/$plural/$id/updateDefinition" 'POST' @{definition=$Definition} -NoRetry | Out-Null
    } else {
        if (@($Items | Where-Object { $_.displayName -eq $Name }).Count) {
            throw 'An unowned same-name knowledge item exists. Do not adopt or duplicate it without identity review.'
        }
        $created = Invoke-Fabric "workspaces/$($script:Config.workspaceId)/$plural" 'POST' @{
            displayName=$Name; definition=$Definition
            description='Read-only simulated microscopy research evidence, QC sensitivity, provenance and fictional external-context examples.'
        } -ReturnOperationResult -NoRetry
        $id = $created.id
        $parsed = [Guid]::Empty
        if (-not [Guid]::TryParse($id, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
            throw 'Knowledge creation returned no valid ID. Inspect the existing operation and item inventory before retrying.'
        }
        $script:State[$key] = $id
        $script:State.created += @{id=$id; type=$Type; name=$Name}
        Save-State
    }
    $persisted = Read-KnowledgeDefinition $id $Type
    Assert-KnowledgeReadback $persisted $Type -Published:$Published
    $script:State.knowledgeContentHashes[$key] = $desiredHash
    $script:State.knowledgeDefinitionHashes[$key] = Get-KnowledgeHash $persisted
    Save-State
    $persisted | ConvertTo-Json -Depth 60 | Set-Content -LiteralPath (Join-Path $script:KnowledgeDirectory "$key-readback.json") -Encoding utf8
    New-DemoResult 'KNOWLEDGE.DEPLOYED' 'Pass' "$Type $id persisted with validated source bindings."
}
function Test-KnowledgeSql {
    $previous = @{
        server=$env:ASSAYSCOPE_SQL_SERVER; database=$env:ASSAYSCOPE_SQL_DATABASE; token=$env:ASSAYSCOPE_SQL_TOKEN
    }
    try {
        $env:ASSAYSCOPE_SQL_SERVER = $script:KnowledgeTarget.sqlEndpoint
        $env:ASSAYSCOPE_SQL_DATABASE = $script:KnowledgeTarget.sqlDatabase
        $env:ASSAYSCOPE_SQL_TOKEN = Get-DemoToken 'https://database.windows.net/'
        for ($attempt = 0; $attempt -lt 7; $attempt++) {
            & node (Join-Path $Root 'scripts/knowledge-sql-check.mjs') 2>&1 | ForEach-Object { Write-DemoLog ([string]$_) }
            if ($LASTEXITCODE -eq 0) { return }
            if ($LASTEXITCODE -ne 75 -or $attempt -eq 6) {
                throw 'Actual knowledge SQL verification failed; no managed item definition was deployed from unchecked data.'
            }
            Write-DemoLog 'KNOWLEDGE.SQL | Pending | Lakehouse table load completed; waiting 15 seconds for SQL metadata synchronization.'
            Start-Sleep -Seconds 15
        }
    } finally {
        $env:ASSAYSCOPE_SQL_SERVER = $previous.server
        $env:ASSAYSCOPE_SQL_DATABASE = $previous.database
        $env:ASSAYSCOPE_SQL_TOKEN = $previous.token
    }
}
function Get-KnowledgeTableInventory {
    param([string]$WorkspaceId, [string]$LakehouseId)
    $path = "workspaces/$WorkspaceId/lakehouses/$LakehouseId/tables?maxResults=100"
    $all = @()
    for ($page = 0; $page -lt 100; $page++) {
        $result = Invoke-Fabric $path
        $all += @($result.data)
        if (-not $result['continuationUri']) { return $all }
        $path = $result.continuationUri
    }
    throw 'Lakehouse table inventory exceeds its bounded page count.'
}

try {
    $python = Resolve-Python
    if ((& node --version).Trim() -notmatch '^v24\.') { throw 'Knowledge deployment uses the tested Node 24 runtime.' }
    Invoke-Checked $python @('-m','research.knowledge')
    $dataDirectory = Join-Path $Root 'data/knowledge'
    $script:KnowledgeTables = Get-Content -LiteralPath (Join-Path $dataDirectory 'tables.json') -Raw | ConvertFrom-Json -AsHashtable
    $names = @('experiments','runs','wells','images','qc','context','conditions' | ForEach-Object { "assayscope_knowledge_$_" })
    if ($script:KnowledgeTables.Count -ne 7 -or
        (($script:KnowledgeTables.table | Sort-Object) -join ',') -ne (($names | Sort-Object) -join ',')) {
        throw 'Unexpected knowledge table manifest.'
    }
    New-DemoResult 'KNOWLEDGE.PREVIEW' 'Pass' 'Seven bounded curated tables; seven ontology entities and six relationships; one read-only data agent over only these tables. External records remain fictional examples; no live LIMS, private reviews, model resource, role or policy change.'
    if ($Offline) {
        if ($Action -ne 'plan') { throw 'Offline knowledge mode only supports plan.' }
        exit 0
    }
    if ($Action -in @('apply','publish','evaluate') -and -not $ConfirmCosts) { throw 'Knowledge writes/model execution require --confirm-costs for the configured existing target.' }
    $script:Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
    Assert-DemoConfig $script:Config
    Assert-DemoAzContext
    $script:FabricToken = Get-DemoToken 'https://api.fabric.microsoft.com'
    $workspaceId = $script:Config.workspaceId
    $workspace = Invoke-Fabric "workspaces/$workspaceId"
    if ($workspace.capacityId -ne $script:Config.capacityId) { throw 'Knowledge workspace capacity does not match the approved target.' }
    $capacity = @(Get-FabricList 'capacities' | Where-Object { $_.id -eq $script:Config.capacityId -and $_.state -eq 'Active' })
    if ($capacity.Count -ne 1) { throw 'The existing target capacity is not verifiably active.' }
    $stateDirectory = Join-Path $Root ".deployment/$($script:Config.tenantId)/$workspaceId/$($script:Config.environment)"
    $script:StatePath = Join-Path $stateDirectory 'state.json'
    $script:State = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json -AsHashtable
    Assert-DemoState $script:State $script:Config
    $items = @(Get-FabricList "workspaces/$workspaceId/items")
    $lakehouse = Invoke-Fabric "workspaces/$workspaceId/lakehouses/$($script:State.lakehouseId)"
    if ($lakehouse.properties.sqlEndpointProperties.provisioningStatus -ne 'Success') { throw 'Dedicated Lakehouse SQL endpoint is not ready.' }
    $script:KnowledgeTarget = @{
        workspaceId=$workspaceId; lakehouseId=$lakehouse.id; lakehouseName=$lakehouse.displayName
        environment=$script:Config.environment
        sqlEndpoint=$lakehouse.properties.sqlEndpointProperties.connectionString
        sqlDatabase=$lakehouse.properties.sqlEndpointProperties.id
    }
    $script:KnowledgeDirectory = Join-Path $stateDirectory 'knowledge'
    New-Item -ItemType Directory -Path $script:KnowledgeDirectory -Force | Out-Null
    $targetPath = Join-Path $script:KnowledgeDirectory 'target.json'
    $script:KnowledgeTarget | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $targetPath -Encoding utf8
    $arguments = @('-m','research.knowledge','--target',$targetPath,'--definitions-out',$script:KnowledgeDirectory)
    if ($Action -eq 'publish') { $arguments += '--publish-agent' }
    Invoke-Checked $python $arguments
    if ($Action -eq 'plan') {
        New-DemoResult 'KNOWLEDGE.TARGET' 'Pass' 'Resolved existing workspace, capacity, Lakehouse and SQL endpoint. Prepared definitions are in ignored environment state. No cloud writes performed.'
        exit 0
    }
    foreach ($key in @('knowledgeUploaded','knowledgeContentHashes','knowledgeDefinitionHashes','knowledgeTableOwnership','knowledgeLoaded')) {
        if (-not $script:State.ContainsKey($key)) { $script:State[$key] = @{} }
    }
    if ($Action -eq 'apply') {
        $existingTables = @(Get-KnowledgeTableInventory $workspaceId $lakehouse.id)
        foreach ($table in $script:KnowledgeTables) {
            if (@($existingTables | Where-Object { $_.name -eq $table.table }).Count -and
                -not $script:State.knowledgeTableOwnership[$table.table]) {
                throw 'An existing curated table is not owned by this environment. No table was overwritten.'
            }
        }
        $filesUri = [Uri]$lakehouse.properties.oneLakeFilesPath
        if ($filesUri.Scheme -ne 'https' -or $filesUri.UserInfo -or $filesUri.Query -or
            -not $filesUri.Host.EndsWith('.dfs.fabric.microsoft.com') -or
            $filesUri.AbsolutePath.TrimEnd('/') -ne "/$workspaceId/$($lakehouse.id)/Files") {
            throw 'Knowledge upload refuses mismatched OneLake coordinates.'
        }
        $storage = Get-DemoToken 'https://storage.azure.com/'
        $headers = @{Authorization="Bearer $storage"; 'x-ms-version'='2023-11-03'; 'x-ms-blob-type'='BlockBlob'}
        $prefix = 'assayscope/spheroid-screen-001'
        $base = $filesUri.AbsoluteUri.Replace('.dfs.','.blob.').TrimEnd('/')
        $marker = Invoke-WebRequest -Uri "$base/$prefix/owner.json" -Headers $headers -Method Get -MaximumRedirection 0 -TimeoutSec 30 -SkipHttpErrorCheck
        if ($marker.StatusCode -ne 200) { throw 'Existing owned image-prefix marker is required; no knowledge data was uploaded.' }
        $owner = $marker.Content | ConvertFrom-Json -AsHashtable
        if ($owner.tenantId -ne $script:Config.tenantId -or $owner.workspaceId -ne $workspaceId -or $owner.environment -ne $script:Config.environment) {
            throw 'Knowledge prefix is owned by a different environment.'
        }
        foreach ($table in $script:KnowledgeTables) {
            if ($table.file -ne "$($table.table).parquet" -or $table.rows -lt 1 -or $table.rows -gt 10000) { throw 'Invalid knowledge upload manifest.' }
            $file = Get-Item -LiteralPath (Join-Path $dataDirectory $table.file)
            if ($file.Length -gt 8MB -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or
                (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $table.sha256) {
                throw 'Knowledge upload file is linked, oversized or differs from its manifest.'
            }
            $result = Send-DemoFile $file $dataDirectory "$base/$prefix/knowledge" $headers $script:State.knowledgeUploaded
            if ($result.failure) { throw $result.failure }
            $script:State.knowledgeUploaded[$result.relative] = $result.hash
            $script:State.knowledgeTableOwnership[$table.table] = $true
            Save-State
            if ($script:State.knowledgeLoaded[$table.table] -eq $table.sha256 -and
                @($existingTables | Where-Object { $_.name -eq $table.table }).Count) {
                New-DemoResult 'KNOWLEDGE.TABLE.REUSE' 'Pass' "Unchanged owned table $($table.table); actual SQL content will still be checked."
                continue
            }
            Invoke-Fabric "workspaces/$workspaceId/lakehouses/$($lakehouse.id)/tables/$($table.table)/load" 'POST' @{
                relativePath="Files/$prefix/knowledge/$($table.file)"; pathType='File'; mode='Overwrite'
                formatOptions=@{format='Parquet'}
            } | Out-Null
            $script:State.knowledgeLoaded[$table.table] = $table.sha256
            Save-State
        }
        New-DemoResult 'KNOWLEDGE.TABLES' 'Pass' 'Seven separate curated tables loaded; the original five analytical tables were not changed.'
        Test-KnowledgeSql
        $ontology = Get-Content -LiteralPath (Join-Path $script:KnowledgeDirectory 'ontology.json') -Raw | ConvertFrom-Json -AsHashtable
        Set-KnowledgeItem 'Ontology' "assayscope_$($script:Config.environment.Replace('-','_'))_ontology" $ontology.definition $items
        $agent = Get-Content -LiteralPath (Join-Path $script:KnowledgeDirectory 'data-agent.json') -Raw | ConvertFrom-Json -AsHashtable
        Set-KnowledgeItem 'DataAgent' "assayscope-$($script:Config.environment)-data-agent" $agent.definition $items
    } elseif ($Action -eq 'publish') {
        if (-not $script:State['dataAgentId']) { throw 'Deploy and verify the data-agent draft before publishing inside the tenant.' }
        Test-KnowledgeSql
        $agent = Get-Content -LiteralPath (Join-Path $script:KnowledgeDirectory 'data-agent.json') -Raw | ConvertFrom-Json -AsHashtable
        Set-KnowledgeItem 'DataAgent' "assayscope-$($script:Config.environment)-data-agent" $agent.definition $items -Published
    } else {
        Test-KnowledgeSql
        foreach ($entry in @(@{key='ontologyId'; type='Ontology'}, @{key='dataAgentId'; type='DataAgent'})) {
            if (-not $script:State[$entry.key]) { throw "No recorded $($entry.type) item." }
            $definition = Read-KnowledgeDefinition $script:State[$entry.key] $entry.type
            Assert-KnowledgeReadback $definition $entry.type
            New-DemoResult 'KNOWLEDGE.READBACK' 'Pass' "$($entry.type) definition is present with the approved bindings."
        }
        if ($Action -eq 'evaluate') {
            $agentDefinition = Read-KnowledgeDefinition $script:State.dataAgentId 'DataAgent'
            Assert-KnowledgeReadback $agentDefinition 'DataAgent' -Published
            $previous = $env:ASSAYSCOPE_FABRIC_TOKEN
            try {
                $env:ASSAYSCOPE_FABRIC_TOKEN = $script:FabricToken
                Invoke-Checked $python @((Join-Path $Root 'scripts/check_data_agent.py'), '--workspace', $workspaceId,
                    '--agent', $script:State.dataAgentId)
            } finally { $env:ASSAYSCOPE_FABRIC_TOKEN = $previous }
        } else {
            New-DemoResult 'KNOWLEDGE.RUNTIME' 'Warning' 'SQL and definition checks passed. Actual conversational data-agent responses and separate-user authorization are independent runtime gates.'
        }
    }
} catch {
    New-DemoResult 'KNOWLEDGE.OPERATION' 'Fail' $_.Exception.Message
    exit 1
} finally {
    $script:Secrets.Clear()
    $script:FabricToken = ''
}
