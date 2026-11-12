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
    $script:AzCalls = [System.Collections.Generic.List[object]]::new()
    $script:AzResponse = @{
        tenantId=$script:Config.tenantId; id=$script:Config.subscriptionId
        user=@{name=$script:Config.expectedAccount}; accessToken='local-only-test-token'
    }
    $script:HttpCalls = [System.Collections.Generic.List[object]]::new()
    $script:Responses = [System.Collections.Generic.Queue[object]]::new()
    $script:Sleeps = 0
}
function az {
    $script:AzCalls.Add(@($args))
    $global:LASTEXITCODE = 0
    $script:AzResponse | ConvertTo-Json -Depth 10 -Compress
}
function Invoke-WebRequest {
    param($Uri, $Method, $Headers, $TimeoutSec, [switch]$SkipHttpErrorCheck, $MaximumRedirection, $Body, $ContentType)
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
Test-Guard 'Missing token fails explicitly' {
    $script:AzResponse.accessToken = ''
    Assert-Throws { Get-DemoToken 'https://api.fabric.microsoft.com' } 'usable access token'
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
