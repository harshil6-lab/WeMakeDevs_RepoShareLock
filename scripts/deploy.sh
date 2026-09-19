#!/usr/bin/env bash
# Deploys RepoSherlock (foundation + application) to AWS, repeatably.
# Mirrors scripts/deploy.ps1 for Linux/macOS/CI. See manual-setup.md for the
# manual verification checklist.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
PROJECT_NAME="${PROJECT_NAME:-reposherlock}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-dev}"
BEDROCK_MODEL_ID="${REPOSHERLOCK_BEDROCK_MODEL_ID:-nvidia.nemotron-nano-12b-v2}"
BEDROCK_MODEL_ARNS="${BEDROCK_MODEL_ARNS:-arn:aws:bedrock:ap-south-1::foundation-model/nvidia.nemotron-nano-12b-v2}"
GITHUB_TOKEN="${REPOSHERLOCK_GITHUB_TOKEN:-}"
GITHUB_SECRET_NAME="${GITHUB_SECRET_NAME:-reposherlock/github}"
BUDGET_EMAIL="${BUDGET_EMAIL:-}"
ARTIFACTS_BUCKET_NAME="${ARTIFACTS_BUCKET_NAME:-}"
FRONTEND_BUCKET_NAME="${FRONTEND_BUCKET_NAME:-}"
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-http://localhost:5173}"
LAMBDA_CODE_S3_KEY="${LAMBDA_CODE_S3_KEY:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FOUNDATION_STACK="${PROJECT_NAME}-${ENVIRONMENT_NAME}-foundation"
APP_STACK="${PROJECT_NAME}-${ENVIRONMENT_NAME}-app"

stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

if [[ -z "$LAMBDA_CODE_S3_KEY" ]]; then
  REVISION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  LAMBDA_CODE_S3_KEY="deploy/${REVISION}-$(date +%Y%m%d%H%M%S)/lambda.zip"
fi

echo "==> 1/4 Deploying foundation stack ${FOUNDATION_STACK}"
aws cloudformation deploy \
  --template-file "$ROOT/infrastructure/cloudformation/template.yaml" \
  --stack-name "$FOUNDATION_STACK" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "EnvironmentName=${ENVIRONMENT_NAME}" \
    "BedrockModelArns=${BEDROCK_MODEL_ARNS}" \
    "GitHubSecretName=${GITHUB_SECRET_NAME}" \
    "ArtifactsBucketName=${ARTIFACTS_BUCKET_NAME}" \
    "FrontendBucketName=${FRONTEND_BUCKET_NAME}"

ARTIFACTS_BUCKET="$(stack_output "$FOUNDATION_STACK" ArtifactsBucketName)"
FRONTEND_BUCKET="$(stack_output "$FOUNDATION_STACK" FrontendBucketName)"
TABLE_NAME="$(stack_output "$FOUNDATION_STACK" InvestigationsTableName)"
ROLE_ARN="$(stack_output "$FOUNDATION_STACK" LambdaExecutionRoleArn)"
API_ID="$(stack_output "$FOUNDATION_STACK" ApiId)"

echo "==> 2/4 Storing the GitHub token in Secrets Manager (${GITHUB_SECRET_NAME})"
if [[ -n "$GITHUB_TOKEN" ]]; then
  aws secretsmanager put-secret-value --secret-id "$GITHUB_SECRET_NAME" --region "$REGION" \
    --secret-string "{\"token\":\"${GITHUB_TOKEN}\"}" >/dev/null
else
  echo "WARNING: REPOSHERLOCK_GITHUB_TOKEN is not set; the application stack may fail to resolve the secret." >&2
fi

echo "==> 3/4 Building and uploading the Lambda package"
(cd "$ROOT" && npm run build:aws)
rm -f "$ROOT/dist-lambda.zip"
(cd "$ROOT/dist-lambda" && zip -r -q "$ROOT/dist-lambda.zip" .)
aws s3 cp "$ROOT/dist-lambda.zip" "s3://${ARTIFACTS_BUCKET}/${LAMBDA_CODE_S3_KEY}" --region "$REGION"

echo "==> 4/4 Deploying application stack ${APP_STACK}"
APP_PARAMS=(
  "ProjectName=${PROJECT_NAME}"
  "EnvironmentName=${ENVIRONMENT_NAME}"
  "ApiId=${API_ID}"
  "ArtifactsBucketName=${ARTIFACTS_BUCKET}"
  "FrontendBaseUrl=${FRONTEND_BASE_URL}"
  "InvestigationsTableName=${TABLE_NAME}"
  "LambdaRoleArn=${ROLE_ARN}"
  "LambdaCodeS3Key=${LAMBDA_CODE_S3_KEY}"
  "BedrockModelId=${BEDROCK_MODEL_ID}"
  "GitHubSecretName=${GITHUB_SECRET_NAME}"
)
if [[ -n "$BUDGET_EMAIL" ]]; then APP_PARAMS+=("BudgetEmail=${BUDGET_EMAIL}"); fi

aws cloudformation deploy \
  --template-file "$ROOT/infrastructure/cloudformation/app.yaml" \
  --stack-name "$APP_STACK" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${APP_PARAMS[@]}"

echo
echo "Deployment complete (CDN-free)."
echo "  API URL        : https://${API_ID}.execute-api.${REGION}.amazonaws.com"
echo "  Frontend URL   : ${FRONTEND_BASE_URL}"
echo "  Region         : ${REGION}"
echo "  Table          : ${TABLE_NAME}"
echo "  Artifacts      : ${ARTIFACTS_BUCKET}"
echo "  Frontend S3    : ${FRONTEND_BUCKET} (foundation stack, unused by this deployment)"
