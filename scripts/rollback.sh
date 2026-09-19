#!/usr/bin/env bash
# Rolls RepoSherlock back to a previously uploaded Lambda package.
# Usage: ./scripts/rollback.sh deploy/<version>/lambda.zip
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <lambda-code-s3-key>" >&2
  exit 2
fi

LAMBDA_CODE_S3_KEY="$1"
REGION="${AWS_REGION:-ap-south-1}"
PROJECT_NAME="${PROJECT_NAME:-reposherlock}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_STACK="${PROJECT_NAME}-${ENVIRONMENT_NAME}-app"

echo "==> Rolling ${APP_STACK} back to ${LAMBDA_CODE_S3_KEY}"
PARAMETERS="$(aws cloudformation describe-stacks --stack-name "$APP_STACK" --region "$REGION" \
  --query "Stacks[0].Parameters[]" --output json)"

OVERRIDES=()
while IFS=$'\t' read -r key value; do
  [[ -z "$key" ]] && continue
  if [[ "$key" == "LambdaCodeS3Key" ]]; then
    OVERRIDES+=("LambdaCodeS3Key=${LAMBDA_CODE_S3_KEY}")
  else
    OVERRIDES+=("${key}=${value}")
  fi
done < <(printf '%s' "$PARAMETERS" | python3 -c 'import json,sys; [print(f"{p[\"ParameterKey\"]}\t{p.get(\"ParameterValue\",\"\")}") for p in json.load(sys.stdin)]')

aws cloudformation deploy \
  --template-file "$ROOT/infrastructure/cloudformation/app.yaml" \
  --stack-name "$APP_STACK" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${OVERRIDES[@]}"

echo "Rollback complete."
