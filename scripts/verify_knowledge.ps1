#Requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'fabric.ps1') -Action doctor -DefinitionsOnly
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'knowledge.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Knowledge deployment script does not parse.' }
$definitions = $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)
. ([scriptblock]::Create(($definitions.Extent.Text -join "`n")))
$script:Results = [Collections.Generic.List[object]]::new()
function Assert-True {
    param([bool]$Value, [string]$Message)
    if (-not $Value) { throw $Message }
}
function Assert-Throws {
    param([scriptblock]$Body, [string]$Pattern)
    try { & $Body } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected failure: $($_.Exception.Message)" }
        return
    }
    throw "Expected failure: $Pattern"
}
function Test-Knowledge {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:Results.Add(@{name=$Name; status='Pass'}); Write-DemoLog "KNOWLEDGE.TEST | Pass | $Name" }
    catch { $script:Results.Add(@{name=$Name; status='Fail'; detail=$_.Exception.Message}); Write-DemoLog "KNOWLEDGE.TEST | Fail | $Name | $($_.Exception.Message)" }
}
Test-Knowledge 'Definitions-only import performs no authentication or deployment' {
    $output = & pwsh -NoLogo -NoProfile -File (Join-Path $PSScriptRoot 'fabric.ps1') `
        -Action doctor -ConfigPath '__definitions_only_must_not_read_config__.json' -DefinitionsOnly 2>&1
    Assert-True ($LASTEXITCODE -eq 0 -and [string]::IsNullOrWhiteSpace(($output -join "`n"))) `
        'Definitions-only import executed a command or tried to read the deliberately missing config.'
}
Test-Knowledge 'Knowledge fingerprints ignore only platform-owned metadata and normalize line endings' {
    $encode = {param($text) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))}
    $one = @{parts=@(@{path='model.tmdl'; payload=(& $encode "model Example`n")}, @{path='.platform'; payload=(& $encode '{}')})}
    $two = @{parts=@(@{path='.platform'; payload=(& $encode '{"server":"metadata"}')}, @{path='model.tmdl'; payload=(& $encode "model Example`r`n")})}
    Assert-True ((Get-KnowledgeHash $one) -eq (Get-KnowledgeHash $two)) 'Line-ending/platform metadata normalization failed.'
    $two.parts[1].payload = & $encode "model Modified`n"
    Assert-True ((Get-KnowledgeHash $one) -ne (Get-KnowledgeHash $two)) 'Code edits were hidden by hashing.'
}
Test-Knowledge 'Unowned same-name knowledge items cannot be adopted or overwritten' {
    $script:State = @{ontologyId=''; knowledgeContentHashes=@{}; knowledgeDefinitionHashes=@{}}
    $script:Config = @{workspaceId='11111111-1111-4111-8111-111111111111'}
    function Invoke-Fabric { throw 'Unexpected network request.' }
    $definition = @{parts=@(@{path='database.tmdl'; payload='ZGF0YWJhc2UK'})}
    Assert-Throws { Set-KnowledgeItem 'Ontology' 'example' $definition @(@{displayName='example'; type='Ontology'}) } 'unowned same-name'
}
Test-Knowledge 'Data-agent readback rejects extra tables and foreign source bindings' {
    $script:Config = @{workspaceId='11111111-1111-4111-8111-111111111111'}
    $script:State = @{lakehouseId='22222222-2222-4222-8222-222222222222'}
    $script:KnowledgeTables = @('experiments','runs','wells','images','qc','context','conditions' | ForEach-Object { @{table="assayscope_knowledge_$_"} })
    $source = @{workspaceId=$script:Config.workspaceId; artifactId=$script:State.lakehouseId
        elements=@(@{children=@($script:KnowledgeTables | ForEach-Object { @{display_name=$_.table; is_selected=$true} })})}
    function Convert-Definition {
        param($Source)
        return @{parts=@(@{path='Files/Config/draft/lakehouse-example/datasource.json'
            payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Source | ConvertTo-Json -Depth 20 -Compress)))})}
    }
    Assert-KnowledgeReadback (Convert-Definition $source) 'DataAgent'
    $source.elements[0].children += @{display_name='ReviewDecision'; is_selected=$true}
    Assert-Throws { Assert-KnowledgeReadback (Convert-Definition $source) 'DataAgent' } 'allowlist'
    $source.artifactId = '33333333-3333-4333-8333-333333333333'
    Assert-Throws { Assert-KnowledgeReadback (Convert-Definition $source) 'DataAgent' } 'configured Lakehouse'
}
Test-Knowledge 'Externally edited definitions stop before a write' {
    $script:Config = @{workspaceId='11111111-1111-4111-8111-111111111111'}
    $script:State = @{ontologyId='22222222-2222-4222-8222-222222222222'
        knowledgeContentHashes=@{}; knowledgeDefinitionHashes=@{ontologyId='old'}}
    function Read-KnowledgeDefinition { return @{parts=@(@{path='database.tmdl'; payload='ZGF0YWJhc2UK'})} }
    function Invoke-Fabric { throw 'Unexpected write.' }
    $items = @(@{id=$script:State.ontologyId; type='Ontology'; displayName='example'})
    Assert-Throws { Set-KnowledgeItem 'Ontology' 'example' @{parts=@()} $items } 'edited externally'
}
Test-Knowledge 'Ontology and agent cleanup ownership stay restricted to exact recorded IDs' {
    $config = @{tenantId='11111111-1111-4111-8111-111111111111'; workspaceId='22222222-2222-4222-8222-222222222222'
        environment='unit-test'; lakehouseId=''; appItemId=''}
    $state = @{tenantId=$config.tenantId; workspaceId=$config.workspaceId; environment=$config.environment
        ontologyId='33333333-3333-4333-8333-333333333333'; dataAgentId='44444444-4444-4444-8444-444444444444'
        created=@(@{id='33333333-3333-4333-8333-333333333333'; type='Ontology'; name='example'})}
    Assert-DemoState $state $config
    $state.created[0].id = $state.dataAgentId
    Assert-Throws { Assert-DemoState $state $config } 'ownership does not match'
}
Test-Knowledge 'Rerunning draft apply preserves the existing published agent version' {
    $draft = @{parts=@(@{path='Files/Config/draft/stage_config.json'; payload='bmV3LWRyYWZ0'})}
    $current = @{parts=@(
        @{path='Files/Config/draft/stage_config.json'; payload='b2xkLWRyYWZ0'},
        @{path='Files/Config/published/stage_config.json'; payload='cHVibGlzaGVk'},
        @{path='Files/Config/publish_info.json'; payload='aW5mbw'}
    )}
    $merged = Merge-KnowledgeDraft $draft $current
    Assert-True ($merged.parts.Count -eq 3) 'Published agent parts were dropped.'
    Assert-True ($merged.parts[0].payload -eq 'bmV3LWRyYWZ0' -and $merged.parts[1].payload -eq 'cHVibGlzaGVk') 'Draft and published versions were conflated.'
    Assert-True ($draft.parts.Count -eq 1 -and $current.parts[0].payload -eq 'b2xkLWRyYWZ0') 'Input definitions were mutated.'
    Assert-Throws { Merge-KnowledgeDraft $current $current } 'cannot replace published'
}
$result = @{executedAt=[DateTime]::UtcNow.ToString('o'); network='None; only fixture definitions and local state.'
    tests=@($script:Results.ToArray()); cloudVerification='Not performed by this script.'}
New-Item -ItemType Directory -Path (Join-Path $Root 'test-results') -Force | Out-Null
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $Root 'test-results/knowledge-local.json') -Encoding utf8
if (@($script:Results | Where-Object { $_.status -ne 'Pass' }).Count) { exit 1 }
