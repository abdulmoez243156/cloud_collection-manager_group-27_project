# Wishlist and Acquisition

The Wishlist has three functions for the final demonstration.

1. **Manage entries.** Owners create, edit, and remove wanted items. An owner can change the status between wanted and acquired.
2. **Find and prioritize items.** Members search titles and filter by category, priority, status, and maximum target budget. Results are sorted by priority, then oldest first.
3. **Plan purchases within a budget.** Members enter a spending limit. The API walks wanted entries in priority order, includes each priced item that fits the remaining amount, and returns the total, remaining amount, and deferred items. Unpriced entries are listed separately from entries that exceed the remaining budget.

The budget planner is the additional function permitted by the TA's feedback. Acquisition changes the Wishlist status and removes that entry from future purchase plans.

## How to run

1. Run `backend/db/migrations/001-wishlist.sql` in the Neon SQL Editor after the shared `collections` table exists. Each Wishlist entry belongs to one collection via `collection_id`. The SQL can be rerun.
2. Run `npm ci` and `npm start` from `backend`, with the shared `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS` settings configured privately. For local testing, include `http://localhost:8080` in `CORS_ORIGINS`.
3. From `frontend`, run `python -m http.server 8080` and open `http://localhost:8080/wishlist.html`. Sign in with a Collection Manager account and choose a collection. The page also links to the existing registration and collection creation APIs.
4. For the team's split cloud deployment, set the public backend origin in the `collection-api-origin` meta tag in `frontend/wishlist.html`, add the deployed frontend origin to the backend's `CORS_ORIGINS`, and open `/wishlist.html` on the deployed frontend. The meta tag holds a public hostname. Keep secrets in backend environment variables.

## API contract

The base path is `/api/collections/:collectionId/wishlist`. Requests use the shared bearer-token middleware and the shared collection membership lookup. Owners and viewers can read. Owners can write.

| Method and suffix | Input and validation | Success |
| --- | --- | --- |
| GET `/` | Optional `search` (title substring), `category`, `priority`, `status`, and `max_budget`. | 200 with `entries`. |
| POST `/` | JSON with `title` (1–150 characters), `category` (1–100), `priority` (high, medium, low), and optional nullable `target_budget`. | 201 with the created `entry` in wanted status. |
| PATCH `/:id` | A JSON object with one or more editable fields. `status` accepts wanted or acquired. A null `target_budget` clears the amount. | 200 with the updated `entry`. |
| DELETE `/:id` | Collection and entry UUIDs. | 204 with an empty body. |
| GET `/budget-plan` | Required `limit` in the collection's currency. | 200 with `limit`, `planned_total`, `remaining`, `selected`, and `deferred`. |

Amounts must be nonnegative with up to ten integer digits and two decimal places. Common errors are 400 for invalid input, 401 for a missing bearer token, 403 for a rejected token or insufficient permissions, 404 for an entry missing from the selected collection, and 415 for a write body with the wrong content type. The server calculates the plan in integer cents.

## Evidence for the final report

Local integration checks ran the Express app with an isolated PostgreSQL database. The deployed application still needs its own test results and screenshots.

| ID | Test and expected result | Local result |
| --- | --- | --- |
| WL-01 | Create and edit an entry as owner, reload the page, and find the edited entry. | Passed in browser. |
| WL-02 | Combine title, category, status, priority, and budget filters. Only matching rows appear. | Passed over HTTP. |
| WL-03 | Plan against 70.00 with budgets 60.10, 15.05, 9.85, and one unpriced entry. The first and third fit, with 69.95 planned and 0.05 remaining. | Passed over HTTP. |
| WL-04 | Mark an entry acquired. It appears in the acquired filter and drops out of the purchase plan. | Passed over HTTP. |
| WL-05 | Reject a viewer's updates and deletes with 403 and allow their reads. | Passed over HTTP and viewer controls checked in browser. |
| WL-06 | Reject invalid input with 400 and an entry ID from a different collection with 404. | Passed over HTTP. |
| WL-07 | Delete an entry and try again. The first call returns 204 and the second returns 404. | Passed over HTTP. |

Use the deployed URL, sanitized request/response captures, Neon row evidence, and the feature PR in the individual contribution statement. For the final report's integrated test and video, start with the group's main deployed scenario and show the three Wishlist functions alongside the Catalogue and Valuation services. Record the actual results from the deployed tests in the report.
