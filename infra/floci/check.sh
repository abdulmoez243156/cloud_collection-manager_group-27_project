#!/usr/bin/env bash
# Checks the Floci deployment (like check-lab7.sh). Run after deploy.sh:
#   bash infra/floci/check.sh
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1

API_NAME=team27-collection-api
BUCKET=team27-collection-web
WEBSITE=http://localhost:4566
PASSED=0
FAILED=0

check() {   # check "description" command...
  local name=$1
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  PASS   $name"; PASSED=$((PASSED + 1))
  else
    echo "  FAIL   $name"; FAILED=$((FAILED + 1))
  fi
}
status_is() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 40 "${@:2}")" = "$1" ]; }
body_has() { curl -s --max-time 40 "${@:2}" | grep -q "$1"; }
no_cors_header() { ! curl -s -i --max-time 40 "$@" | grep -qi '^access-control-allow-origin'; }
lambda_active() { aws lambda get-function --function-name "$1" --query Configuration.State --output text | grep -q Active; }
log_group_exists() { aws logs describe-log-groups --log-group-name-prefix "$1" --query 'logGroups[].logGroupName' --output text | grep -q "$1"; }
default_stage() { aws apigatewayv2 get-stages --api-id "$1" --query 'Items[].StageName' --output text | grep -q default; }

API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
API_URL=http://$API_ID.execute-api.localhost.floci.io:4566
echo "API: $API_URL"
echo

echo "Each service: Lambda, IAM role, CloudWatch log group"
for SERVICE in catalogue wishlist valuation; do
  FUNCTION=team27-$SERVICE-api
  check "$FUNCTION is Active" lambda_active $FUNCTION
  check "$FUNCTION-role exists" aws iam get-role --role-name $FUNCTION-role
  check "log group /aws/lambda/$FUNCTION exists" log_group_exists /aws/lambda/$FUNCTION
done

echo "API Gateway"
check "stage \$default exists" default_stage $API_ID
check "health answers from Lambda with the database connected" \
  body_has '"database":"connected"' "$API_URL/api/health"
check "Catalogue route reaches its Lambda (401 without login)" status_is 401 "$API_URL/api/items"
check "Wishlist route reaches its Lambda (401 without login)" status_is 401 "$API_URL/api/collections/x/wishlist"
check "Valuation route reaches its Lambda (401 without login)" status_is 401 "$API_URL/api/reports/summary"
check "unknown route is stopped by API Gateway (404)" status_is 404 -X DELETE "$API_URL/api/health"
check "CORS allows our website" \
  body_has "localhost:4566" -i -X OPTIONS "$API_URL/api/items" \
  -H "Origin: $WEBSITE" -H "Access-Control-Request-Method: GET"
check "CORS refuses another website" \
  no_cors_header -X OPTIONS "$API_URL/api/items" \
  -H "Origin: http://evil.example" -H "Access-Control-Request-Method: GET"

echo "Website on S3"
check "index.html is served" status_is 200 "$WEBSITE/$BUCKET/index.html"
check "the uploaded config.js points to this API" body_has "$API_ID" "$WEBSITE/$BUCKET/js/config.js"
check "no .env file in the website (404)" status_is 404 "$WEBSITE/$BUCKET/.env"

echo
echo "Result: $PASSED passed, $FAILED failed"
