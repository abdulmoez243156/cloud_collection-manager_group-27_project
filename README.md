# Collection Manager

**Introduction to Cloud Computing (25CSCI37H), Group 27**

Collectors of coins, stamps, sneakers and similar items usually keep their records in
spreadsheets, with photos, condition notes and value estimates scattered elsewhere.
Collection Manager brings them together in one cloud application: catalogue items with
their condition and acquisition details, plan missing purchases on a prioritised wishlist,
and record dated value estimates so the collection's total value can be explained.
Owners can invite other collectors as read-only viewers.

| Service | Owner | Functionalities |
|---|---|---|
| **Collection Catalogue** | Abdulmoez | F1 maintain item records (create, edit, archive/restore, with condition and acquisition details); F2 find items (search, filter, sort, item details); F3 duplicate detection |
| **Wishlist and Acquisition** | Ahmed Ramy | Manage wanted entries; search, filter and prioritise; purchase budget planner |
| **Valuation and Reports** | Abdelrahman Magdy | Record dated estimates and view history; correct or delete estimates; collection total, unvalued count and category breakdown |
| Shared: authentication and collections | Abdelrahman Magdy (lead) | Register, log in, create collections, invite and remove viewers |

## Architecture

Three layers, each on a managed cloud service (Platform as a Service, serverless compute):

| Layer | What it is | Cloud service |
|---|---|---|
| Presentation | Static HTML, CSS and JavaScript (`frontend/`) | Vercel project (static hosting on Vercel's CDN) |
| Application | Node.js + Express REST API (`backend/`) | Vercel project (one serverless Vercel Function) |
| Data | PostgreSQL | Neon (managed serverless Postgres) |

External API: **Cloudflare Turnstile** protects catalogue item creation from bots.
Diagrams (architecture, database, request flow): [`docs/architecture.md`](docs/architecture.md).

The browser only talks to the API over HTTPS with JSON. Only the API holds the database
connection string and the secret keys; they are kept in environment variables, never in Git.

## Repository structure

```
backend/
  server.js            Express app: middleware, routes, error handling
  db/db.js             Neon connection (DATABASE_URL)
  db/schema.sql        Complete database schema (run once in Neon)
  db/migrations/       Wishlist migration (also included in schema.sql)
  middleware/          auth (JWT), turnstile, rateLimit, securityHeaders
  routes/              one router per service: URL + method -> controller
  controllers/         validation, permissions, HTTP responses
  services/            SQL queries (+ duplicateCheck.js matching rules)
frontend/
  index.html           Home: sign in, register, collections, viewers
  catalogue.html       Catalogue service page
  wishlist.html        Wishlist service page
  js/config.js         API address and Turnstile site key (the only file to edit per environment)
  js/api.js            Shared session, API request helper, header and UI helpers
  vercel.json          Security headers (Content-Security-Policy and others)
postman/               API tests (see Testing)
docs/                  Architecture, Catalogue API contract and test plan, Wishlist notes
```

## Run locally

Requirements: Node.js 20 or newer, Git, a free Neon account.

1. **Database.** Create a Neon project, open the SQL Editor, paste the whole of
   `backend/db/schema.sql` and run it. It is safe to run again.
2. **Configuration.** Copy `backend/.env.example` to `backend/.env` and fill in
   `DATABASE_URL` (Neon connection string) and `JWT_SECRET` (a long random value). Keep the
   example's `CORS_ORIGINS` and Cloudflare test key `TURNSTILE_SECRET_KEY` for local use.
3. **Backend** (terminal 1):
   ```bash
   cd backend
   npm install
   npm run dev        # or: npm start
   ```
   Check http://localhost:3000/api/health shows `"database": "connected"`.
4. **Frontend** (terminal 2):
   ```bash
   cd frontend
   npm install
   npm start
   ```
   Open http://localhost:8080. Locally, `config.js` uses the local API and Cloudflare's test
   Turnstile key, whose widget always passes.

## Deploy (Vercel + Neon, free plans)

The API and the frontend are two Vercel projects built from this one repository.

1. **API project.** In Vercel: *Add New > Project*, import this repository, set
   **Root Directory** to `backend` (framework preset: Express), and add the environment
   variables `DATABASE_URL`, `JWT_SECRET`, `TURNSTILE_SECRET_KEY` (real secret key),
   `CORS_ORIGINS` (`http://localhost:8080` for now) and `NODE_ENV=production`. Deploy, then
   open `https://<api-project>.vercel.app/api/health`.
2. **Point the frontend at the API.** Replace `YOUR-API-PROJECT` in `frontend/js/config.js`
   and in the `connect-src` part of `frontend/vercel.json` with the API domain.
3. **Turnstile.** In Cloudflare: *Turnstile > Add widget*, hostname = the frontend's Vercel
   domain (no `https://`). Put the **site key** in `config.js` (replacing
   `YOUR-TURNSTILE-SITE-KEY`); the **secret key** goes only in the API project's
   `TURNSTILE_SECRET_KEY`.
4. **Frontend project.** Import the repository again with **Root Directory** `frontend` and
   framework preset *Other*. No environment variables.
5. **Allow the frontend origin.** Add the frontend URL to the API's `CORS_ORIGINS`
   (comma-separated, no trailing slash) and redeploy the API.
6. **Verify.** Register, create a collection, add an item (the Turnstile widget appears),
   refresh, and open the site in a second browser. `curl -I https://<frontend>.vercel.app`
   shows the security headers.

Every push to `main` redeploys both projects automatically.

## Testing

`postman/Catalogue.postman_collection.json` tests the Catalogue service end to end:
56 requests and 93 checks covering F1, F2, F3, validation errors, owner/viewer/outsider
permissions, Turnstile, security headers and the integration with the Valuation service.

- **Local:** import the collection and `Catalogue-Local.postman_environment.json`, select the
  environment and run folder *1. Full API test (local)*. It creates its own users and
  collection, so it can be run repeatedly (restart the backend if the login rate limit of
  20 requests per 15 minutes is reached).
- **Deployed:** create an account, a collection and a few items on the live site, then set
  `baseUrl`, `liveEmail` and `livePassword` in `Catalogue-Production.postman_environment.json`
  and run folder *2. Live smoke test (deployed)*. Items cannot be created from Postman on
  the live site: the real Turnstile key correctly refuses test and forged tokens (checks L10, L11).
  Locally, Cloudflare's test secret key accepts any token, so only a missing token is refused there.

`postman/Collection Manager.postman_collection.json` covers authentication and collections.
The Catalogue API contract and test plan are in [`docs/catalogue-api.md`](docs/catalogue-api.md).

## Security

- Passwords hashed with bcrypt; JWT login tokens (24 h) checked by middleware on every private route.
- Owner/viewer roles checked on the server against collection membership for every request;
  users outside a collection get 404, so other collections cannot be discovered by guessing IDs.
- Server-side validation on every input, with matching `CHECK` constraints in the database.
- Parameterised SQL only (Neon tagged templates), so input can never change a query.
- Cloudflare Turnstile verified on the server before an item is created (fails closed).
- Rate limiting (429): 20 login/registration requests and 300 API requests per IP per 15 minutes.
- Security headers: strict Content-Security-Policy on the frontend (`vercel.json`) and on API responses.
- CORS allow-list, 32 KB request limit, secrets only in environment variables,
  generic error messages to clients and details only in server logs.

## API overview

All endpoints except register, login and health need `Authorization: Bearer <token>`.
Errors always have the shape `{ "error": { "code": "...", "message": "..." } }`.

| Service | Method and path | Purpose |
|---|---|---|
| System | `GET /api/health` | API and database status |
| Auth | `POST /api/auth/register`, `POST /api/auth/login` | Create an account, log in |
| Collections | `GET /api/collections`, `POST /api/collections` | My collections, create one |
| Collections | `GET/POST /api/collections/:id/members`, `DELETE /api/collections/:id/members/:userId` | Viewers (owner only) |
| Catalogue | `GET /api/items?collection_id=...` | List, search, filter, sort (F2) |
| Catalogue | `GET /api/items/:id` | Item details with latest valuation (F2) |
| Catalogue | `GET /api/items/categories?collection_id=...` | Categories for filtering (F2) |
| Catalogue | `GET /api/items/duplicates?collection_id=...&title=...&category=...` | Duplicate check (F3) |
| Catalogue | `POST /api/items` (needs `X-Turnstile-Token`) | Create item, 409 if a likely duplicate (F1, F3) |
| Catalogue | `PATCH /api/items/:id` | Edit, archive or restore (F1) |
| Wishlist | `GET/POST /api/collections/:collectionId/wishlist`, `PATCH/DELETE .../wishlist/:id` | Wishlist entries |
| Wishlist | `GET /api/collections/:collectionId/wishlist/budget-plan?limit=...` | Purchase planner |
| Valuation | `GET/POST /api/items/:itemId/valuations`, `PUT/DELETE /api/valuations/:id` | Dated estimates |
| Valuation | `GET /api/collections/:collectionId/report` | Totals and category breakdown |

## Limitations

- Value estimates are the owner's own; there are no market prices, payments or sales.
- Item photographs were dropped after Phase 1 feedback (photo upload is not a counted functionality).
- The rate limiter counts in each serverless instance's memory, so it is a speed bump rather than a global limit.
- Neon's free plan pauses an idle database after 5 minutes; the first request afterwards is slower (cold start).
