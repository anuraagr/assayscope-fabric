#Requires -Version 7.4
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'fabric.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Deployment script has $($parseErrors.Count) PowerShell parse errors." }

# Load definitions only: the production entry point cannot authenticate or deploy in this test.
$definitions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)
. ([scriptblock]::Create(($definitions.Extent.Text -join "`n")))
$script:Results = [System.Collections.Generic.List[object]]::new()

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Assert-Throws {
    param([scriptblock]$Body, [string]$Pattern)
    try { & $Body } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected failure: $($_.Exception.Message)" }
        return
    }
    throw "Expected a failure matching: $Pattern"
}
function Reset-Fixture {
    $script:Config = @{
        tenantId='11111111-1111-4111-8111-111111111111'
        subscriptionId='22222222-2222-4222-8222-222222222222'
        workspaceId='33333333-3333-4333-8333-333333333333'
        capacityId='44444444-4444-4444-8444-444444444444'
        environment='unit-test'; expectedAccount='unit-test@example.invalid'
        lakehouseId=''; appItemId=''
        fabricAppsEnabledConfirmed=$true; functionsAvailableConfirmed=$true
        workspaceContributorConfirmed=$true; storageApplicationReadConfirmed=$true
        sqlApplicationReadConfirmed=$true
    }
    $script:Secrets = [System.Collections.Generic.List[string]]::new()
    $script:FabricToken = 'local-only-test-token'
    $script:FabricSkill = 'spark-authoring-cli'
    $script:AzCalls = [System.Collections.Generic.List[object]]::new()
    $script:AzResponse = @{
        tenantId=$script:Config.tenantId; id=$script:Config.subscriptionId
        user=@{name=$script:Config.expectedAccount}; accessToken='local-only-test-token'
        tenant=$script:Config.tenantId; subscription=$script:Config.subscriptionId
    }
    $script:HttpCalls = [System.Collections.Generic.List[object]]::new()
    $script:Responses = [System.Collections.Generic.Queue[object]]::new()
    $script:Sleeps = 0
    $script:State = @{
        tenantId=$script:Config.tenantId; workspaceId=$script:Config.workspaceId
        environment=$script:Config.environment; lakehouseId='55555555-5555-4555-8555-555555555555'
        appItemId=''; created=@()
    }
    $script:SavedStates = 0
}
function Save-State { $script:SavedStates++ }
function az {
    $script:AzCalls.Add(@($args))
    $global:LASTEXITCODE = 0
    $script:AzResponse | ConvertTo-Json -Depth 10 -Compress
}
function Invoke-WebRequest {
    param($Uri, $Method, $Headers, $TimeoutSec, [switch]$SkipHttpErrorCheck, $MaximumRedirection, $Body, $ContentType, $InFile)
    $script:HttpCalls.Add([hashtable]$PSBoundParameters)
    if (-not $script:Responses.Count) { throw 'Unexpected HTTP request; this test never permits network access.' }
    return $script:Responses.Dequeue()
}
function Start-Sleep {
    param($Seconds)
    $script:Sleeps++
}
function Add-Response {
    param([int]$Status, [object]$Body = $null, [hashtable]$Headers = @{})
    $content = if ($null -eq $Body) { '' } else { $Body | ConvertTo-Json -Depth 10 -Compress }
    $script:Responses.Enqueue([pscustomobject]@{StatusCode=$Status; Content=$content; Headers=$Headers})
}
function Test-Guard {
    param([string]$Name, [scriptblock]$Body)
    Reset-Fixture
    try {
        & $Body
        $script:Results.Add(@{name=$Name; status='Pass'})
        Write-DemoLog "LOCAL.TEST | Pass | $Name"
    } catch {
        $script:Results.Add(@{name=$Name; status='Fail'; detail=$_.Exception.Message})
        Write-DemoLog "LOCAL.TEST | Fail | $Name | $($_.Exception.Message)"
    }
}

Test-Guard 'Configuration rejects malformed IDs and text confirmations' {
    Assert-DemoConfig $script:Config
    $script:Config.fabricAppsEnabledConfirmed = 'false'
    Assert-Throws { Assert-DemoConfig $script:Config } 'JSON boolean'
    $script:Config.fabricAppsEnabledConfirmed = $true
    $script:Config.lakehouseId = '../unrelated-item'
    Assert-Throws { Assert-DemoConfig $script:Config } 'GUID'
    $script:Config.lakehouseId = ''
    $script:Config.environment = '../outside'
    Assert-Throws { Assert-DemoConfig $script:Config } 'environment slug'
}
Test-Guard 'Azure calls require and retain the subscription guard' {
    $subscription = $script:Config.subscriptionId
    $script:Config.subscriptionId = ''
    Assert-Throws { Invoke-DemoAz @('account','show') } 'subscription guard'
    Assert-True ($script:AzCalls.Count -eq 0) 'Azure must not be called without a subscription.'
    $script:Config.subscriptionId = $subscription
    Assert-DemoAzContext
    $arguments = $script:AzCalls[0]
    $index = [Array]::IndexOf($arguments, '--subscription')
    Assert-True ($index -ge 0 -and $arguments[$index + 1] -eq $subscription) 'Azure call lost its subscription guard.'
}
Test-Guard 'Wrong account stops before token acquisition' {
    $script:AzResponse.user.name = 'different@example.invalid'
    Assert-Throws { Assert-DemoAzContext; Get-DemoToken 'https://api.fabric.microsoft.com' } 'differs from'
    Assert-True ($script:AzCalls.Count -eq 1) 'A token was requested after context mismatch.'
}
Test-Guard 'Non-JSON CLI output fails explicitly without printing token responses' {
    function az { $global:LASTEXITCODE = 0; 'Not a JSON result: opaque-token-value' }
    $output = & {
        Assert-Throws { Get-DemoToken 'https://api.fabric.microsoft.com' } 'did not return valid JSON'
    } 6>&1 | Out-String
    Assert-True ($output -notmatch 'opaque-token-value') 'Unparsed token output was disclosed.'
    Assert-Throws { Assert-DemoAzContext } 'did not return valid JSON'
}
Test-Guard 'Missing token fails explicitly' {
    $script:AzResponse.accessToken = ''
    Assert-Throws { Get-DemoToken 'https://api.fabric.microsoft.com' } 'usable access token'
}
Test-Guard 'Token requests use the guarded subscription without a conflicting tenant option' {
    Assert-DemoAzContext
    $token = Get-DemoToken 'https://api.fabric.microsoft.com'
    $arguments = $script:AzCalls[1]
    Assert-True ($token -eq 'local-only-test-token') 'Token result was not returned.'
    Assert-True ('--subscription' -in $arguments -and '--tenant' -notin $arguments) 'Azure CLI rejects simultaneous subscription and tenant options.'
    $script:AzResponse.tenant = '77777777-7777-4777-8777-777777777777'
    Assert-Throws { Get-DemoToken 'https://api.fabric.microsoft.com' } 'different tenant or subscription'
}
Test-Guard 'Logs redact registered credentials and credential query strings' {
    $secret = 'local-only-test-secret'
    $script:Secrets.Add($secret)
    $output = & { Write-DemoLog "value=$secret Bearer example-bearer sig=example-signature&access_token=example-access" } 6>&1 | Out-String
    Assert-True ($output -notmatch 'local-only-test-secret|example-bearer|example-signature|example-access') 'A credential was not redacted.'
    Assert-True ($output.Contains('[REDACTED]')) 'Redaction marker is missing.'
}
Test-Guard 'Fabric continuations remain on the exact HTTPS API origin' {
    Assert-FabricUrl 'https://api.fabric.microsoft.com/v1/operations/test'
    foreach ($url in @('http://api.fabric.microsoft.com/v1/items', 'https://example.invalid/v1/items',
                       'https://api.fabric.microsoft.com:444/v1/items', 'https://user@api.fabric.microsoft.com/v1/items',
                       'https://api.fabric.microsoft.com/v1/items#fragment')) {
        Assert-Throws { Invoke-Fabric -Path $url } 'outside the documented API origin'
    }
    Assert-Throws { Assert-FabricUrl 'not-a-url' } 'outside the documented API origin'
    Assert-True ($script:HttpCalls.Count -eq 0) 'An invalid continuation reached HTTP.'
}
Test-Guard 'Permission denial is not retried' {
    Add-Response 403
    Assert-Throws { Invoke-Fabric 'workspaces/test' } 'HTTP 403'
    Assert-True ($script:HttpCalls.Count -eq 1 -and $script:Sleeps -eq 0) 'Permission denial was retried.'
    Assert-True ($script:HttpCalls[0].MaximumRedirection -eq 0) 'Authenticated requests must not follow redirects.'
}
Test-Guard 'Transient service failures retry at most three times' {
    Add-Response 429
    Add-Response 503
    Add-Response 200 @{id='ready'}
    $result = Invoke-Fabric 'workspaces/test'
    Assert-True ($result.id -eq 'ready' -and $script:HttpCalls.Count -eq 3) 'Transient recovery failed.'
    Reset-Fixture
    1..3 | ForEach-Object { Add-Response 503 }
    Assert-Throws { Invoke-Fabric 'workspaces/test' } 'HTTP 503'
    Assert-True ($script:HttpCalls.Count -eq 3) 'Retries exceeded the bound.'
}
Test-Guard 'Long-running creation polls and retrieves the result' {
    $operation = 'https://api.fabric.microsoft.com/v1/operations/test'
    Add-Response 202 $null @{Location=@($operation)}
    Add-Response 200 @{status='Running'}
    Add-Response 200 @{status='Succeeded'}
    Add-Response 200 @{id='created-item'}
    $result = Invoke-Fabric 'workspaces/test/lakehouses' 'POST' @{displayName='unit-test'} -ReturnOperationResult
    Assert-True ($result.id -eq 'created-item' -and $script:HttpCalls.Count -eq 4) 'LRO result was not retrieved.'
    Assert-True ($script:HttpCalls[3].Uri -eq "$operation/result") 'LRO result endpoint is incorrect.'
}
Test-Guard 'Regional LRO locations use the documented operation ID on the canonical API origin' {
    $id = '77777777-7777-4777-8777-777777777777'
    Add-Response 202 $null @{Location="https://regional.example.invalid/v1/operations/$id"; 'x-ms-operation-id'=@($id); 'Retry-After'=@('15')}
    Add-Response 200 @{status='Succeeded'}
    $result = Invoke-Fabric 'workspaces/test/lakehouses/test/tables/example/load' 'POST'
    Assert-True ($result.status -eq 'Succeeded') 'Operation did not complete.'
    Assert-True ($script:HttpCalls[1].Uri -eq "https://api.fabric.microsoft.com/v1/operations/$id") 'Credentials were sent to the regional Location instead of the canonical API.'
    Reset-Fixture
    Add-Response 202 $null @{'x-ms-operation-id'='../invalid'; Location='https://api.fabric.microsoft.com/v1/operations/test'}
    Assert-Throws { Invoke-Fabric 'workspaces/test/lakehouses' 'POST' } 'invalid long-running operation ID'
    Assert-True ($script:HttpCalls.Count -eq 1) 'Invalid operation identifier reached HTTP.'
}
Test-Guard 'Redirect responses cannot look like successful empty API results' {
    Add-Response 307 $null @{Location='https://example.invalid/v1/items'}
    Assert-Throws { Invoke-Fabric 'workspaces/test' } 'unexpected redirect'
    Assert-True ($script:HttpCalls.Count -eq 1) 'Redirect was followed.'
}
Test-Guard 'Failed and cancelled operations never produce success' {
    foreach ($status in @('Failed','Cancelled')) {
        Reset-Fixture
        Add-Response 202 $null @{Location='https://api.fabric.microsoft.com/v1/operations/test'}
        Add-Response 200 @{status=$status}
        Assert-Throws { Invoke-Fabric 'workspaces/test/lakehouses' 'POST' } 'operation failed'
        Assert-True ($script:HttpCalls.Count -eq 2) 'Failed operation requested a result.'
    }
}
Test-Guard 'Long-running operations have a finite polling limit' {
    Add-Response 202 $null @{Location='https://api.fabric.microsoft.com/v1/operations/test'}
    1..120 | ForEach-Object { Add-Response 200 @{status='Running'} }
    Assert-Throws { Invoke-Fabric 'workspaces/test/lakehouses' 'POST' } 'pending after 10 minutes'
    Assert-True ($script:HttpCalls.Count -eq 121) 'LRO polling exceeded its limit.'
}
Test-Guard 'Pagination retains rows and rejects foreign continuations' {
    Add-Response 200 @{value=@(@{id='one'}); continuationUri='https://api.fabric.microsoft.com/v1/capacities?page=2'}
    Add-Response 200 @{value=@(@{id='two'})}
    $items = @(Get-FabricList 'capacities')
    Assert-True (($items.id -join ',') -eq 'one,two') 'Paginated rows were lost.'
    Reset-Fixture
    Add-Response 200 @{value=@(); continuationUri='https://example.invalid/v1/items'}
    Assert-Throws { Get-FabricList 'capacities' } 'outside the documented API origin'
    Assert-True ($script:HttpCalls.Count -eq 1) 'Foreign continuation received a request.'
}
Test-Guard 'State cannot redirect cleanup to another environment or item' {
    $state = @{
        tenantId=$script:Config.tenantId; workspaceId=$script:Config.workspaceId
        environment=$script:Config.environment; lakehouseId='55555555-5555-4555-8555-555555555555'
        appItemId=''; created=@()
    }
    Assert-DemoState $state $script:Config
    $state.environment = 'another-environment'
    Assert-Throws { Assert-DemoState $state $script:Config } 'another tenant/workspace/environment'
    $state.environment = $script:Config.environment
    $state.created = @(@{type='Capacity'; id=$state.lakehouseId; name='not-owned'})
    Assert-Throws { Assert-DemoState $state $script:Config } 'unsupported cleanup resource'
    $state.created = @(@{type='Lakehouse'; id='66666666-6666-4666-8666-666666666666'; name='not-owned'})
    Assert-Throws { Assert-DemoState $state $script:Config } 'ownership does not match'
    $state.created = @()
    $script:Config.lakehouseId = '66666666-6666-4666-8666-666666666666'
    Assert-Throws { Assert-DemoState $state $script:Config } 'conflicts with recorded'
}
Test-Guard 'Upload selection excludes generation metadata and refuses unrelated files' {
    $fixture = Join-Path $Root "test-results/deployment-fixture-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    try {
        Set-Content -LiteralPath (Join-Path $fixture 'catalog.json') -Value '{}'
        Set-Content -LiteralPath (Join-Path $fixture 'generation.json') -Value '{}'
        $files = @(Get-DemoUploadFiles $fixture)
        Assert-True ($files.Count -eq 1 -and $files[0].Name -eq 'catalog.json') 'Upload selection included generation metadata.'
        Set-Content -LiteralPath (Join-Path $fixture 'private-review.json') -Value '{}'
        Assert-Throws { Get-DemoUploadFiles $fixture } 'Unrecognized core file'
    } finally {
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
    Test-Guard 'Uploaded files are reused only when the remote object still matches its size' {
        $file = Get-Item -LiteralPath (Join-Path $Root 'config\qc.json')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        Add-Response 200 $null @{'Content-Length'=@([string]$file.Length)}
        $result = Send-DemoFile $file $Root 'https://example.invalid/Files/demo' @{} @{'config/qc.json'=$hash}
        Assert-True (-not $result.failure -and -not $result.uploaded -and $script:HttpCalls.Count -eq 1) 'Verified file was uploaded again.'
        Reset-Fixture
        Add-Response 404
        Add-Response 201
        $result = Send-DemoFile $file $Root 'https://example.invalid/Files/demo' @{} @{'config/qc.json'=$hash}
        Assert-True (-not $result.failure -and $result.uploaded -and $result.hash -eq $hash) 'Missing remote file was not restored.'
        Assert-True ($script:HttpCalls.Count -eq 2 -and $script:HttpCalls[1].Method -eq 'Put') 'Unexpected upload sequence.'
    }
    Test-Guard 'Upload permission failures stop without replacement or false checkpoint success' {
        $file = Get-Item -LiteralPath (Join-Path $Root 'config\qc.json')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        Add-Response 403
        $result = Send-DemoFile $file $Root 'https://example.invalid/Files/demo' @{} @{'config/qc.json'=$hash}
        Assert-True ($result.failure -match 'HTTP 403' -and -not $result.uploaded -and $script:HttpCalls.Count -eq 1) 'Denied read was replaced with a write.'
        Reset-Fixture
        Add-Response 403
        $result = Send-DemoFile $file $Root 'https://example.invalid/Files/demo' @{} @{}
        Assert-True ($result.failure -match 'HTTP 403' -and -not $result.uploaded) 'Denied upload looked successful.'
    }
    Test-Guard 'Reruns reuse valid installed dependencies without reinstalling' {
        function npm { $global:LASTEXITCODE = 0; '{}' }
        function Invoke-Checked { throw 'Unexpected dependency install.' }
        Restore-DemoNodeDependencies $Root
    }
    Test-Guard 'Missing dependencies trigger exact lockfile restoration' {
        function npm { $global:LASTEXITCODE = 1; '{"problems":["missing dependency"]}' }
        $script:Restored = $false
        function Invoke-Checked {
            param($Program, $Arguments, $Directory)
            Assert-True ($Program -eq 'npm' -and ($Arguments -join ' ') -eq 'ci --no-audit --no-fund' -and $Directory -eq $Root) 'Unexpected restore command.'
            $script:Restored = $true
        }
        Test-Guard 'Transitive-only lockfile changes restore even if direct dependencies still validate' {
            function npm { $global:LASTEXITCODE = 0; '{}' }
            $script:Restored = $false
            function Invoke-Checked {
                param($Program, $Arguments, $Directory)
                Assert-True ($Program -eq 'npm' -and $Arguments[0] -eq 'ci' -and $Directory -eq $Root) 'Unexpected restore command.'
                $script:Restored = $true
            }
            Restore-DemoNodeDependencies $Root -LockfileChanged
            Assert-True $script:Restored 'Changed lockfile was not installed.'
        }
        Restore-DemoNodeDependencies $Root
        Assert-True $script:Restored 'Missing dependencies were not restored.'
    }
}

Test-Guard 'Notebook definition binds only the resolved existing Lakehouse and contains no outputs' {
    $template = Join-Path $Root 'notebooks\research-review.ipynb'
    $lakehouse = @{id=$script:State.lakehouseId; type='Lakehouse'; displayName='assayscope_unit_test'}
    $original = Get-FileHash -LiteralPath $template
    $result = New-DemoNotebookDefinition $template $lakehouse $script:Config.workspaceId
    $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($result.definition.parts[0].payload)) | ConvertFrom-Json -AsHashtable
    Assert-True ($decoded.metadata.dependencies.lakehouse.default_lakehouse -eq $lakehouse.id) 'Wrong Lakehouse binding.'
    Assert-True ($decoded.metadata.dependencies.lakehouse.default_lakehouse_workspace_id -eq $script:Config.workspaceId) 'Wrong workspace binding.'
    Assert-True (@($decoded.cells | Where-Object { $_.cell_type -eq 'code' -and @($_.outputs).Count }).Count -eq 0) 'Source has outputs.'
    Assert-True ((Get-FileHash -LiteralPath $template).Hash -eq $original.Hash) 'Portable notebook was changed by deployment preparation.'
    $lakehouse.id = 'not-an-item'
    Assert-Throws { New-DemoNotebookDefinition $template $lakehouse $script:Config.workspaceId } 'GUID'
}
Test-Guard 'Notebook creation records ownership and refuses unowned name collisions' {
    $template = Join-Path $Root 'notebooks\research-review.ipynb'
    $lakehouse = @{id=$script:State.lakehouseId; type='Lakehouse'; displayName='assayscope_unit_test'}
    $collision = @(@{id='66666666-6666-4666-8666-666666666666'; type='Notebook'; displayName='assayscope-unit-test-research-review'})
    Assert-Throws { Publish-DemoResearchNotebook $collision $lakehouse $template } 'same-name'
    Assert-True ($script:HttpCalls.Count -eq 0) 'Collision caused an HTTP write.'
    $id = '77777777-7777-4777-8777-777777777777'
    Add-Response 201 @{id=$id}
    Publish-DemoResearchNotebook @() $lakehouse $template
    Assert-True ($script:State.researchNotebookId -eq $id -and $script:SavedStates -eq 1) 'Created notebook was not recorded immediately.'
    Assert-True ($script:State.created[0].type -eq 'Notebook' -and $script:State.created[0].id -eq $id) 'Notebook ownership was not recorded.'
    Assert-DemoState $script:State $script:Config
}
Test-Guard 'Identical notebook reruns do not update or start Spark' {
    $template = Join-Path $Root 'notebooks\research-review.ipynb'
    $lakehouse = @{id=$script:State.lakehouseId; type='Lakehouse'; displayName='assayscope_unit_test'}
    $prepared = New-DemoNotebookDefinition $template $lakehouse $script:Config.workspaceId
    $script:State.researchNotebookId = '77777777-7777-4777-8777-777777777777'
    $script:State.researchContentHash = $prepared.hash
    $items = @(@{id=$script:State.researchNotebookId; type='Notebook'; displayName='assayscope-unit-test-research-review'})
    Add-Response 200 @{definition=$prepared.definition}
    Publish-DemoResearchNotebook $items $lakehouse $template
    Assert-True ($script:HttpCalls.Count -eq 1 -and $script:HttpCalls[0].Uri -match '/getDefinition\?format=ipynb$') 'Idempotent apply wrote or ran a notebook.'
    Assert-True ($script:SavedStates -eq 0) 'Unchanged notebook unexpectedly changed state.'
}
Test-Guard 'Notebook updates preserve external edits instead of overwriting them' {
    $template = Join-Path $Root 'notebooks\research-review.ipynb'
    $lakehouse = @{id=$script:State.lakehouseId; type='Lakehouse'; displayName='assayscope_unit_test'}
    $prepared = New-DemoNotebookDefinition $template $lakehouse $script:Config.workspaceId
    $script:State.researchNotebookId = '77777777-7777-4777-8777-777777777777'
    $script:State.researchContentHash = $prepared.hash
    $items = @(@{id=$script:State.researchNotebookId; type='Notebook'; displayName='assayscope-unit-test-research-review'})
    $edited = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($prepared.definition.parts[0].payload)) | ConvertFrom-Json -AsHashtable
    $edited.cells[0].source += 'A separate researcher added a note.'
    $prepared.definition.parts[0].payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($edited | ConvertTo-Json -Depth 40 -Compress)))
    Add-Response 200 @{definition=$prepared.definition}
    Assert-Throws { Publish-DemoResearchNotebook $items $lakehouse $template } 'edited outside'
    Assert-True ($script:HttpCalls.Count -eq 1) 'External edits were overwritten.'
}
Test-Guard 'Non-idempotent notebook creation is never automatically retried' {
    Add-Response 503
    Assert-Throws { Invoke-Fabric 'workspaces/test/notebooks' 'POST' @{} -NoRetry } 'HTTP 503'
    Assert-True ($script:HttpCalls.Count -eq 1 -and $script:Sleeps -eq 0) 'Notebook creation POST was retried.'
}
Test-Guard 'Notebook job identity is captured before polling and stays on the intended item' {
    $notebook = '77777777-7777-4777-8777-777777777777'
    $job = '88888888-8888-4888-8888-888888888888'
    $location = "https://api.fabric.microsoft.com/v1/workspaces/$($script:Config.workspaceId)/items/$notebook/jobs/instances/$job"
    Add-Response 202 $null @{Location=$location; 'Retry-After'='15'}
    Start-DemoResearchJob $notebook
    Assert-True ($script:State.researchJobId -eq $job -and $script:SavedStates -eq 1) 'Accepted job was not persisted.'
    Assert-True ($script:HttpCalls.Count -eq 1 -and $script:Sleeps -eq 1) 'Unexpected POST retry or poll.'
    Add-Response 200 @{id=$job; status='Completed'}
    $result = Wait-DemoResearchJob $notebook
    Assert-True ($result.status -eq 'Completed' -and $script:HttpCalls[1].Method -eq 'GET') 'Job did not use GET-only monitoring.'
    Reset-Fixture
    Add-Response 202 $null @{Location='https://example.invalid/v1/jobs/test'}
    Assert-Throws { Start-DemoResearchJob $notebook } 'outside the documented API'
    Assert-True ($script:HttpCalls.Count -eq 1 -and $script:SavedStates -eq 0) 'Untrusted job URL was followed or recorded.'
}
Test-Guard 'Notebook run failures and malformed saved job identities remain errors' {
    $notebook = '77777777-7777-4777-8777-777777777777'
    Add-Response 503
    Assert-Throws { Start-DemoResearchJob $notebook } 'no automatic POST retry'
    Assert-True ($script:HttpCalls.Count -eq 1) 'Job POST was retried.'
    $script:State.researchJobId = '../another-item'
    Assert-Throws { Wait-DemoResearchJob $notebook } 'valid GUIDs'
    $script:State.researchJobId = '88888888-8888-4888-8888-888888888888'
    Add-Response 200 @{status='Failed'}
    Assert-Throws { Wait-DemoResearchJob $notebook } 'ended with Failed'
}
Test-Guard 'Research receipt must identify the recorded completed notebook and valid output' {
    $notebook = '77777777-7777-4777-8777-777777777777'
    $script:State.researchJobId = '88888888-8888-4888-8888-888888888888'
    $receipt = @{
        experiment_id='spheroid-screen-001'; input_tables_sha256=('a' * 64)
        table_rows=@{assayscope_experiments=1; assayscope_acquisitions=2; assayscope_measurements=192; assayscope_qc=192; assayscope_provenance=198}
        runs=@(
            @{run_id='run1'; total_wells=96; included_wells=85; excluded_wells=11; unmeasured_wells=0; included_control_wells=22},
            @{run_id='run2'; total_wells=96; included_wells=85; excluded_wells=11; unmeasured_wells=0; included_control_wells=22}
        )
        condition_count=48; flagged_well_count=22
    }
    $detail = @{id=$script:State.researchJobId; itemId=$notebook; status='Completed'
        startTimeUtc='2026-01-01T00:00:00'; endTimeUtc='2026-01-01T00:00:30'
        properties=@{exitValue=($receipt | ConvertTo-Json -Depth 10 -Compress)}}
    Add-Response 200 $detail
    $result = Get-DemoResearchReceipt $notebook
    Assert-True ($result.result.input_tables_sha256 -eq ('a' * 64)) 'Execution receipt was not decoded.'
    $detail.itemId = '99999999-9999-4999-8999-999999999999'
    Add-Response 200 $detail
    Assert-Throws { Get-DemoResearchReceipt $notebook } 'does not match'
    $detail.itemId = $notebook
    $receipt.experiment_id = 'unrelated'
    $detail.properties.exitValue = $receipt | ConvertTo-Json -Depth 10 -Compress
    Add-Response 200 $detail
    Assert-Throws { Get-DemoResearchReceipt $notebook } 'output contract'
    $receipt.experiment_id = 'spheroid-screen-001'
    $receipt.runs[0].included_wells = 86
    $detail.properties.exitValue = $receipt | ConvertTo-Json -Depth 10 -Compress
    Add-Response 200 $detail
    Assert-Throws { Get-DemoResearchReceipt $notebook } 'inconsistent technical-well'
}

$reportDirectory = Join-Path $Root 'test-results'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
$report = @{
    executedAt=[DateTime]::UtcNow.ToString('o'); powershell=$PSVersionTable.PSVersion.ToString()
    scriptSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    network='No network: Azure, HTTP and polling delays are replaced by local test doubles.'
    cloudVerification='Not performed'; tests=@($script:Results.ToArray())
}
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportDirectory 'deployment-local.json') -Encoding utf8
if (@($script:Results | Where-Object { $_.status -ne 'Pass' }).Count) { exit 1 }
Write-DemoLog "LOCAL.TESTS | Pass | $($script:Results.Count) no-network deployment tests. Not cloud verification."
