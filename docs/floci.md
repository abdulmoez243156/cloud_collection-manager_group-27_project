# Deploying Collection Manager on Floci

Floci is a free copy of AWS that runs on your laptop in Docker (Labs 7 and 8). We use it
the way Lab 7 does: S3 serves the website, API Gateway receives the requests and Lambda
runs our Express code. The difference is that **each service has its own Lambda function**,
and the data stays in **Neon Postgres** instead of DynamoDB.

```
Browser --> S3 bucket team27-collection-web          (HTML, CSS, JS)
Browser --> API Gateway team27-collection-api
              /api/items/...                   --> Lambda team27-catalogue-api  --> Neon
              /api/collections/{id}/wishlist   --> Lambda team27-wishlist-api   --> Neon
              /api/auth, /api/collections,
              /api/valuations, /api/reports    --> Lambda team27-valuation-api  --> Neon
Each Lambda: its own IAM role + its own CloudWatch log group (/aws/lambda/<name>)
Catalogue Lambda --> Cloudflare Turnstile siteverify (external API)
```

| Service | Owner | Lambda | Its AWS services |
|---|---|---|---|
| Catalogue | Abdulmoez | `team27-catalogue-api` | Lambda, API Gateway (6 routes + 4 OPTIONS), IAM role, CloudWatch Logs |
| Wishlist | Ahmed | `team27-wishlist-api` | Lambda, API Gateway (5 routes + 3 OPTIONS), IAM role, CloudWatch Logs |
| Valuation | Abdelrahman | `team27-valuation-api` | Lambda, API Gateway (16 routes + 11 OPTIONS), IAM role, CloudWatch Logs |
| Website (shared) | | | S3 |

All three functions run the same `lambda.zip`. Each starts from its own file in
`backend/lambdas/`, which loads only its own routes.

Ahmed prepared the first Floci setup (one Lambda for the whole API). It was then split into
one Lambda per service, with the script rewritten in Git Bash like the labs.

## Step 1: Tools (once)

Docker Desktop (Engine running), Git Bash, Node.js and AWS CLI v2. Check them in Git Bash:

```
docker --version
aws --version
node --version
```

## Step 2: The floci profile for the AWS CLI (once)

The same commands as the Floci quick installation guide. Paste them in Git Bash:

```
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
echo 'export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1' >> ~/.bashrc
source ~/.bashrc
```

`test` is not a secret: Floci accepts any keys.

## Step 3: Start Floci

Open Git Bash in the project folder (for example
`cd /c/Users/<you>/Documents/cloud_collection-manager_group-27_project`) and run:

```
docker compose -f infra/floci/docker-compose.yml up -d
aws sts get-caller-identity --query Account --output text
```

The second command must print `000000000000`. The first start downloads Floci and can take
a few minutes. The console (Floci Dash) is at http://localhost:4566/_floci/ui.

## Step 4: backend/.env.floci (the secrets for Lambda)

Create the file `backend/.env.floci` in VS Code with three lines:

```
DATABASE_URL=<connection string of the Neon branch floci-demo>
JWT_SECRET=<a new long random value>
TURNSTILE_SECRET_KEY=<the real Turnstile secret key from Cloudflare>
```

- Use a **separate Neon branch** (`floci-demo`), so the Floci copy never changes the Vercel data.
- Make a new JWT secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- In Cloudflare, `localhost` must be in the Turnstile widget's hostnames.
- The file is ignored by Git (`.env.*` in `.gitignore`). Never commit or share it.

## Step 5: Deploy

```
bash infra/floci/deploy.sh
```

It runs six steps: zip the backend, IAM roles and log groups, the three Lambda functions,
API Gateway (routes, stage, permissions), the website on S3 (it also writes the API address
into `frontend/js/config.js`), and a health check. Expected end:

```
6/6 Health check ...
{"status":"ok","database":"connected","environment":"production","runtime":"lambda (team27-valuation-api)"}

Website: http://localhost:4566/team27-collection-web/index.html
API:     http://<API-ID>.execute-api.localhost.floci.io:4566/api
```

Run it again after any code change. It updates what already exists.

## Step 6: Check everything

```
bash infra/floci/check.sh
```

Expected: `Result: 20 passed, 0 failed`. It checks each function, role and log group,
the stage, that each service's routes reach their own Lambda, that unknown routes are stopped
by API Gateway, CORS for our website and for another website, and the S3 files.

## Step 7: Use the app

To fill the demo database with ready-made data first (three accounts, six collections,
66 items with valuation history, and wishlist entries), run:

```
node backend/scripts/seed-demo.js
```

It only uses `backend/.env.floci`, so the Vercel data is never touched, and it can be run again
to reset the demo collections. It prints the demo logins: `team27.owner@demo.com` owns five
collections, `team27.viewer@demo.com` can only view, and `mona.hassan@demo.com` owns one
collection that the owner account can only view.

Open http://localhost:4566/team27-collection-web/index.html (type `localhost`, not
`127.0.0.1`). The Neon branch is a copy of the live data, so the existing accounts work.
Run the full scenario: Wishlist, then Catalogue (Turnstile check, duplicate warning), then
Valuation and the report, then the viewer account.

## Step 8: Evidence for the report

Floci Dash cannot show HTTP APIs (Lab 7 note), so API Gateway evidence comes from Git Bash.

```
aws lambda list-functions --query "Functions[].[FunctionName,Handler,Runtime,State]" --output table
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='team27-collection-api'].ApiId | [0]" --output text)
aws apigatewayv2 get-routes --api-id $API_ID --query "Items[].RouteKey" --output table
aws iam list-roles --query "Roles[?starts_with(RoleName,'team27')].RoleName" --output table
aws s3 ls s3://team27-collection-web --recursive
aws logs tail /aws/lambda/team27-catalogue-api --since 30m --format short
aws logs tail /aws/lambda/team27-wishlist-api --since 30m --format short
aws logs tail /aws/lambda/team27-valuation-api --since 30m --format short
```

Screenshots to take:

- [ ] Floci Dash: Lambda > Functions (the three functions)
- [ ] Git Bash: `list-functions` table and `get-routes` table
- [ ] Git Bash: IAM roles table
- [ ] Floci Dash: S3 > team27-collection-web
- [ ] Floci Dash: CloudWatch Logs, one log group per function
- [ ] Git Bash: `check.sh` result
- [ ] The website on Floci (address bar visible): Catalogue, Wishlist and Valuation pages
- [ ] DevTools Network: OPTIONS 204 then POST 201 to the API Gateway address
- [ ] Postman: Floci smoke test result (Step 9)

## Step 9: Postman on Floci

Import `postman/Catalogue-Floci.postman_environment.json`, set `baseUrl` to the API address
printed by `deploy.sh` (without `/api`), and set `liveEmail` and `livePassword`. Run folder
*2. Live smoke test (deployed)*. The real Turnstile key refuses test and forged tokens there
(checks L10 and L11), as on Vercel.

## Step 10: Stop and start again

```
docker compose -f infra/floci/docker-compose.yml down     # stop (everything is kept)
docker compose -f infra/floci/docker-compose.yml up -d    # start again later
```

## If something goes wrong

| Problem | Fix |
|---|---|
| `Floci is not answering on the floci profile` | Docker Desktop must show Engine running. Run Step 3, and Step 2 if the account is not `000000000000`. |
| `Missing backend/.env.floci` | Do Step 4. |
| Health check shows `database: disconnected` | Check `DATABASE_URL` in `.env.floci` (the floci-demo branch), then run `deploy.sh` again. |
| The website says it cannot reach the API | Run `deploy.sh` again, then press Ctrl + F5 so the browser loads the new `config.js`. |
| The Turnstile box does not appear | Add `localhost` to the widget's hostnames in Cloudflare. |
| `{"message":"Not Found"}` | That 404 comes from API Gateway: the method and path are not in the route list in `deploy.sh`. |
| Details of an error | `aws logs tail /aws/lambda/<function name> --since 15m --format short` |
