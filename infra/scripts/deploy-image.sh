#!/usr/bin/env bash
# Build + push to ECR, then force a new ECS deployment.
#
# Use this for normal pushes after the stack is up. For the very first push
# (before the ECS service exists), use bootstrap-ecr.sh instead.
#
# Usage: infra/scripts/deploy-image.sh [tag]
#   tag defaults to "latest"

set -euo pipefail

TAG="${1:-latest}"
PROJECT="speed-encode"
ENVIRONMENT="hackathon"
REGION="us-east-1"

# Reuse the bootstrap path for build + push.
"$(dirname "$0")/bootstrap-ecr.sh" "${TAG}"

echo ">>> force ecs redeploy"
aws ecs update-service \
  --cluster "${PROJECT}-${ENVIRONMENT}" \
  --service "${PROJECT}-${ENVIRONMENT}-api" \
  --force-new-deployment \
  --region "${REGION}" \
  --output text \
  --query 'service.deployments[0].rolloutState' \
  > /dev/null

echo ">>> deployed"
