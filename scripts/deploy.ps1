<#
.SYNOPSIS
  Deploys RepoSherlock (foundation + application) to AWS, repeatably.

.DESCRIPTION
  Deployment order:
    1. Foundation stack  : buckets, DynamoDB table, secret, IAM, log groups, HTTP API.
    2. GitHub token      : stored in Secrets Manager (never in the repository).
    3. Lambda package    : built with `npm run build:aws`, zipped, uploaded to S3.
    4. Application stack : Lambda + API Gateway integration + Cognito + budget (CDN-free).

  Data resources use DeletionPolicy: Retain, so a stack delete never destroys
  the artifacts bucket, the frontend bucket, the table or the secret.

.EXAMPLE
  $env:REPOSHERLOCK_GITHUB_TOKEN = "ghp_..."
  ./scripts/deploy.ps1 -Region ap-south-1 -BudgetEmail you@example.com
#>
param(
  [string]$Region = "ap-south-1",
  [string]$ProjectName = "reposherlock",
  [string]$EnvironmentName = "dev",
  [string]$BedrockModelId = "nvidia.nemotron-nano-12b-v2",
  [string]$BedrockModelArns = "arn:aws:bedrock:ap-south-1::foundation-model/nvidia.nemotron-nano-12b-v2",
  [string]$GitHubToken = $env:REPOSHERLOCK_GITHUB_TOKEN,
  [string]$GitHubSecretName = "reposherlock/github",
  [string]$BudgetEmail = "",
  [string]$ArtifactsBucketName = "",
  [string]$FrontendBucketName = "",
  [string]$FrontendBaseUrl = "http://localhost:5173",
  [string]$LambdaCodeS3Key = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$foundationStack = "$ProjectName-$EnvironmentName-foundation"
$appStack = "$ProjectName-$EnvironmentName-app"
$lambdaPackageDir = Join-Path $root "dist-lambda"
$lambdaZip = Join-Path $root "dist-lambda.zip"

function Invoke-Aws([string[]]$Arguments) {
  & aws @Arguments
  if ($LASTEXITCODE -ne 0) { throw "aws $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Get-StackOutput([string]$StackName, [string]$OutputKey) {
  $value = & aws cloudformation describe-stacks --stack-name $StackName --region $Region `
    --query "Stacks[0].Outputs[?OutputKey=='$OutputKey'].OutputValue" --output text
  if ($LASTEXITCODE -ne 0) { throw "Could not read output $OutputKey from $StackName" }
  return $value.Trim()
}

Write-Host "==> RepoSherlock deploy: region=$Region project=$ProjectName env=$EnvironmentName"

if (-not $LambdaCodeS3Key) {
  $revision = (& git -C $root rev-parse --short HEAD 2>$null)
  if (-not $revision) { $revision = "nogit" }
  $LambdaCodeS3Key = "deploy/$revision-$(Get-Date -Format yyyyMMddHHmmss)/lambda.zip"
}

$foundationParameters = @(
  "ProjectName=$ProjectName",
  "EnvironmentName=$EnvironmentName",
  "BedrockModelArns=$BedrockModelArns",
  "GitHubSecretName=$GitHubSecretName",
  "ArtifactsBucketName=$ArtifactsBucketName",
  "FrontendBucketName=$FrontendBucketName"
)

Write-Host "==> 1/4 Deploying foundation stack $foundationStack"
$foundationArgs = @(
  "cloudformation", "deploy",
  "--template-file", (Join-Path $root "infrastructure/cloudformation/template.yaml"),
  "--stack-name", $foundationStack,
  "--region", $Region,
  "--capabilities", "CAPABILITY_NAMED_IAM",
  "--no-fail-on-empty-changeset",
  "--parameter-overrides"
) + $foundationParameters
Invoke-Aws $foundationArgs

$artifactsBucket = Get-StackOutput $foundationStack "ArtifactsBucketName"
$resolvedFrontendBucket = Get-StackOutput $foundationStack "FrontendBucketName"
$tableName = Get-StackOutput $foundationStack "InvestigationsTableName"
$roleArn = Get-StackOutput $foundationStack "LambdaExecutionRoleArn"
$apiId = Get-StackOutput $foundationStack "ApiId"

Write-Host "==> 2/4 Storing the GitHub token in Secrets Manager ($GitHubSecretName)"
if ($GitHubToken) {
  $secretString = '{"token":"' + $GitHubToken.Replace('"', '\"') + '"}'
  Invoke-Aws @("secretsmanager", "put-secret-value", "--secret-id", $GitHubSecretName, "--region", $Region, "--secret-string", $secretString)
} else {
  Write-Warning "No GitHub token supplied. Set `$env:REPOSHERLOCK_GITHUB_TOKEN or pass -GitHubToken, or the API stack will fail to resolve the secret."
}

Write-Host "==> 3/4 Building and uploading the Lambda package"
Push-Location $root
try {
  & npm.cmd run build:aws
  if ($LASTEXITCODE -ne 0) { throw "npm run build:aws failed" }
} finally { Pop-Location }

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $lambdaZip) { Remove-Item -LiteralPath $lambdaZip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($lambdaPackageDir, $lambdaZip)
Invoke-Aws @("s3", "cp", $lambdaZip, "s3://$artifactsBucket/$LambdaCodeS3Key", "--region", $Region)

Write-Host "==> 4/4 Deploying application stack $appStack"
$appParameters = @(
  "ProjectName=$ProjectName",
  "EnvironmentName=$EnvironmentName",
  "ApiId=$apiId",
  "ArtifactsBucketName=$artifactsBucket",
  "FrontendBaseUrl=$FrontendBaseUrl",
  "InvestigationsTableName=$tableName",
  "LambdaRoleArn=$roleArn",
  "LambdaCodeS3Key=$LambdaCodeS3Key",
  "BedrockModelId=$BedrockModelId",
  "GitHubSecretName=$GitHubSecretName"
)
if ($BudgetEmail) { $appParameters += "BudgetEmail=$BudgetEmail" }
$appArgs = @(
  "cloudformation", "deploy",
  "--template-file", (Join-Path $root "infrastructure/cloudformation/app.yaml"),
  "--stack-name", $appStack,
  "--region", $Region,
  "--capabilities", "CAPABILITY_NAMED_IAM",
  "--no-fail-on-empty-changeset",
  "--parameter-overrides"
) + $appParameters
Invoke-Aws $appArgs

$functionName = Get-StackOutput $appStack "FunctionName"

Write-Host ""
Write-Host "Deployment complete (CDN-free)."
Write-Host "  API URL        : https://$apiId.execute-api.$Region.amazonaws.com"
Write-Host "  Frontend URL   : $FrontendBaseUrl"
Write-Host "  Region         : $Region"
Write-Host "  Lambda         : $functionName"
Write-Host "  Table          : $tableName"
Write-Host "  Artifacts      : $artifactsBucket"
Write-Host "  Frontend S3    : $resolvedFrontendBucket (foundation stack, unused by this deployment)"
