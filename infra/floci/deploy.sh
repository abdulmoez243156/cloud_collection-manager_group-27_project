#!/usr/bin/env bash
# Deploys Collection Manager to Floci (Lab 7 setup, one Lambda per service).
# Run from the project folder in Git Bash:   bash infra/floci/deploy.sh
# Safe to run again: it creates what is missing and updates the rest.
#
#   S3           team27-collection-web       the website (frontend/)
#   API Gateway  team27-collection-api       one HTTP API, each service has its own routes
#   Lambda       team27-catalogue-api        Catalogue (Abdulmoez)
#                team27-wishlist-api         Wishlist (Ahmed)
#                team27-valuation-api        Valuation, accounts and collections (Abdelrahman)
#   IAM          one role per function, allowed to write only its own logs
#   CloudWatch   one log group per function
# The database stays on Neon. Its address and the secrets come from backend/.env.floci.
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1

ACCOUNT=000000000000
REGION=us-east-1
API_NAME=team27-collection-api
BUCKET=team27-collection-web
WEBSITE=http://localhost:4566
ENV_FILE=backend/.env.floci
TMP=infra/floci/.tmp

# The routes each service owns (method + path). API Gateway answers 404 to
# anything that is not on these lists, and the request never reaches Lambda.
CATALOGUE_ROUTES=(
  "GET /api/items"
  "POST /api/items"
  "GET /api/items/categories"
  "GET /api/items/duplicates"
  "GET /api/items/{id}"
  "PATCH /api/items/{id}"
)
WISHLIST_ROUTES=(
  "GET /api/collections/{id}/wishlist"
  "POST /api/collections/{id}/wishlist"
  "GET /api/collections/{id}/wishlist/budget-plan"
  "PATCH /api/collections/{id}/wishlist/{entryId}"
  "DELETE /api/collections/{id}/wishlist/{entryId}"
)
VALUATION_ROUTES=(
  "GET /api/health"
  "POST /api/auth/register"
  "POST /api/auth/login"
  "GET /api/collections"
  "POST /api/collections"
  "GET /api/collections/{id}/members"
  "POST /api/collections/{id}/members"
  "DELETE /api/collections/{id}/members/{userId}"
  "GET /api/items/{id}/valuations"
  "POST /api/items/{id}/valuations"
  "PATCH /api/valuations/{id}"
  "PUT /api/valuations/{id}"
  "DELETE /api/valuations/{id}"
  "GET /api/reports/summary"
  "GET /api/reports/categories"
  "GET /api/collections/{id}/report"
)

# ---- Checks before we start ----
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it first (docs/floci.md, step 4)."; exit 1
fi
if [ "$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" != "$ACCOUNT" ]; then
  echo "Floci is not answering on the floci profile."
  echo "Start Floci: docker compose -f infra/floci/compose.yml up -d   (docs/floci.md, steps 2 and 3)"; exit 1
fi

# Read one value from .env.floci (quotes and Windows line endings removed).
read_env() { grep "^$1=" "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d "\r\"'"; }
DATABASE_URL=$(read_env DATABASE_URL)
JWT_SECRET=$(read_env JWT_SECRET)
TURNSTILE_SECRET_KEY=$(read_env TURNSTILE_SECRET_KEY)
if [ -z "$DATABASE_URL" ] || [ -z "$JWT_SECRET" ] || [ -z "$TURNSTILE_SECRET_KEY" ]; then
  echo "$ENV_FILE needs DATABASE_URL, JWT_SECRET and TURNSTILE_SECRET_KEY."; exit 1
fi

# The environment files hold secrets, so they are deleted when the script ends.
mkdir -p $TMP
trap 'rm -rf "$TMP"' EXIT

echo "1/6 Zip the backend"
(cd backend && npm install --no-audit --no-fund --loglevel=error && npm run zip --silent) || exit 1

echo "2/6 IAM roles and CloudWatch log groups"
for SERVICE in catalogue wishlist valuation; do
  FUNCTION=team27-$SERVICE-api
  aws iam create-role --role-name $FUNCTION-role \
    --assume-role-policy-document file://infra/iam/trust-policy.json > /dev/null 2>&1
  aws iam create-policy --policy-name $FUNCTION-logs \
    --policy-document file://infra/iam/$SERVICE-policy.json > /dev/null 2>&1
  aws iam attach-role-policy --role-name $FUNCTION-role \
    --policy-arn arn:aws:iam::$ACCOUNT:policy/$FUNCTION-logs
  aws logs create-log-group --log-group-name /aws/lambda/$FUNCTION > /dev/null 2>&1
  aws logs put-retention-policy --log-group-name /aws/lambda/$FUNCTION \
    --retention-in-days 7 > /dev/null 2>&1
  echo "   $FUNCTION-role and /aws/lambda/$FUNCTION"
done

echo "3/6 Lambda functions"
# Each function only gets the secrets it needs: only Catalogue verifies Turnstile.
write_env_file() {
  local extra=""
  if [ "$1" = "catalogue" ]; then extra=",\"TURNSTILE_SECRET_KEY\":\"$TURNSTILE_SECRET_KEY\""; fi
  printf '{"Variables":{"NODE_ENV":"production","CORS_ORIGINS":"%s","DATABASE_URL":"%s","JWT_SECRET":"%s"%s}}' \
    "$WEBSITE" "$DATABASE_URL" "$JWT_SECRET" "$extra" > $TMP/$1-env.json
}
for SERVICE in catalogue wishlist valuation; do
  FUNCTION=team27-$SERVICE-api
  write_env_file $SERVICE
  if aws lambda get-function --function-name $FUNCTION > /dev/null 2>&1; then
    aws lambda update-function-code --function-name $FUNCTION \
      --zip-file fileb://backend/lambda.zip > /dev/null
    aws lambda wait function-updated-v2 --function-name $FUNCTION
    aws lambda update-function-configuration --function-name $FUNCTION \
      --handler lambdas/$SERVICE.handler --environment file://$TMP/$SERVICE-env.json > /dev/null
    aws lambda wait function-updated-v2 --function-name $FUNCTION
  else
    aws lambda create-function --function-name $FUNCTION \
      --runtime nodejs24.x --handler lambdas/$SERVICE.handler \
      --role arn:aws:iam::$ACCOUNT:role/$FUNCTION-role \
      --zip-file fileb://backend/lambda.zip --timeout 15 --memory-size 256 \
      --environment file://$TMP/$SERVICE-env.json > /dev/null || exit 1
    aws lambda wait function-active-v2 --function-name $FUNCTION
  fi
  echo "   $FUNCTION: $(aws lambda get-function --function-name $FUNCTION --query Configuration.State --output text)"
done

echo "4/6 API Gateway"
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$(aws apigatewayv2 create-api --name $API_NAME --protocol-type HTTP --query ApiId --output text)
fi

# Connects one function to the API: integration, its routes (plus OPTIONS for
# the browser's CORS check on every path), and permission for the API to call it.
connect_service() {
  local FUNCTION=team27-$1-api
  shift
  local ARN=arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION
  local INTEGRATION_ID
  INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id $API_ID \
    --query "Items[?IntegrationUri=='$ARN'].IntegrationId | [0]" --output text)
  if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
    INTEGRATION_ID=$(aws apigatewayv2 create-integration --api-id $API_ID \
      --integration-type AWS_PROXY --payload-format-version 2.0 \
      --integration-uri $ARN --query IntegrationId --output text)
  fi
  local ROUTE ROUTE_PATH
  for ROUTE in "$@"; do
    aws apigatewayv2 create-route --api-id $API_ID --route-key "$ROUTE" \
      --target integrations/$INTEGRATION_ID > /dev/null 2>&1
  done
  for ROUTE_PATH in $(printf '%s\n' "$@" | cut -d' ' -f2 | sort -u); do
    aws apigatewayv2 create-route --api-id $API_ID --route-key "OPTIONS $ROUTE_PATH" \
      --target integrations/$INTEGRATION_ID > /dev/null 2>&1
  done
  aws lambda add-permission --function-name $FUNCTION --statement-id apigw-invoke \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*" > /dev/null 2>&1
  echo "   $FUNCTION: $# routes"
}
connect_service catalogue "${CATALOGUE_ROUTES[@]}"
connect_service wishlist "${WISHLIST_ROUTES[@]}"
connect_service valuation "${VALUATION_ROUTES[@]}"
aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy > /dev/null 2>&1
API_URL=http://$API_ID.execute-api.localhost.floci.io:4566
echo "   $API_URL"

echo "5/6 Website on S3"
# The website must know the API address: put it in config.js (Lab 7, Part 4).
sed -i "s|^const FLOCI_API = .*|const FLOCI_API = '$API_URL';|" frontend/js/config.js
aws s3 mb s3://$BUCKET > /dev/null 2>&1
aws s3 sync frontend s3://$BUCKET --exclude "package*.json" --exclude "vercel.json" \
  --exclude "node_modules/*" > /dev/null
# Make sure the browser gets the right file types (some Windows PCs guess wrongly).
aws s3 cp frontend/css s3://$BUCKET/css --recursive --content-type text/css > /dev/null
aws s3 cp frontend/js s3://$BUCKET/js --recursive --content-type text/javascript > /dev/null
echo "   $(aws s3 ls s3://$BUCKET --recursive | wc -l) files in s3://$BUCKET"

echo "6/6 Health check (the first call can take a few seconds while Lambda starts)"
curl -s --max-time 40 $API_URL/api/health; echo
echo
echo "Website: $WEBSITE/$BUCKET/index.html"
echo "API:     $API_URL/api"
echo "Next:    bash infra/floci/check.sh"
