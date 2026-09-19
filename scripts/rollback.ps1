<#
.SYNOPSIS
  Rolls RepoSherlock back to a previously uploaded Lambda package.

.DESCRIPTION
  CloudFormation already rolls a stack back automatically when an update fails.
  This script handles the application-code case: re-point the application stack
  at an earlier `deploy/<version>/lambda.zip` and wait for the update. All
  other parameters are reused from the live stack, so nothing else changes.

  List previous packages with:
    aws s3 ls s3://<ArtifactsBucketName>/deploy/ --recursive

.EXAMPLE
  ./scripts/rollback.ps1 -LambdaCodeS3Key deploy/abc1234-20260101010101/lambda.zip
#>
param(
  [string]$Region = "ap-south-1",
  [string]$ProjectName = "reposherlock",
  [string]$EnvironmentName = "dev",
  [Parameter(Mandatory = $true)][string]$LambdaCodeS3Key
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$appStack = "$ProjectName-$EnvironmentName-app"

function Invoke-Aws([string[]]$Arguments) {
  & aws @Arguments
  if ($LASTEXITCODE -ne 0) { throw "aws $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

$parameterJson = & aws cloudformation describe-stacks --stack-name $appStack --region $Region `
  --query "Stacks[0].Parameters[]" --output json
if ($LASTEXITCODE -ne 0) { throw "Could not read parameters from $appStack" }

$overrides = ($parameterJson | ConvertFrom-Json) | ForEach-Object {
  if ($_.ParameterKey -eq "LambdaCodeS3Key") { "LambdaCodeS3Key=$LambdaCodeS3Key" }
  else { "$($_.ParameterKey)=$($_.ParameterValue)" }
}

Write-Host "==> Rolling $appStack back to $LambdaCodeS3Key"
$rollbackArgs = @(
  "cloudformation", "deploy",
  "--template-file", (Join-Path $root "infrastructure/cloudformation/app.yaml"),
  "--stack-name", $appStack,
  "--region", $Region,
  "--capabilities", "CAPABILITY_NAMED_IAM",
  "--no-fail-on-empty-changeset",
  "--parameter-overrides"
) + $overrides
Invoke-Aws $rollbackArgs

Write-Host "Rollback complete."
