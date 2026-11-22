# Catalogue service: API contract and test plan

Service owner: Abdulmoez. Base path: `/api/items`. Every request needs
`Authorization: Bearer <token>`. Owners and viewers can read; only owners can write.
Users who are not members of the collection get `404`, so other collections cannot be
discovered by guessing IDs.

| Functionality | Endpoints |
|---|---|
| F1 Maintain item records | `POST /api/items`, `PATCH /api/items/:id` (edit, archive, restore) |
| F2 Find owned items | `GET /api/items`, `GET /api/items/:id`, `GET /api/items/categories` |
| F3 Duplicate detection | `GET /api/items/duplicates`, plus the check inside `POST` and `PATCH` (409) |

## Data dictionary: Item

| Field | Type | Source | Rule |
|---|---|---|---|
| id | UUID | Server | Created by the database; immutable |
| collection_id | UUID | Client (create only) | Must be a collection the caller owns |
| title | string | Client | Required; trimmed; 1-150 characters |
| category | string | Client | Required; trimmed; 1-100 characters |
| description | string or null | Client | Optional; up to 1000 characters |
| condition | enum | Client | `mint`, `near_mint`, `excellent`, `good`, `fair`, `poor` |
| acquisition_date | `YYYY-MM-DD` or null | Client | Optional; a real date; not in the future |
| acquisition_cost | decimal string or null | Client | Optional; >= 0; up to 2 decimals |
| is_archived | boolean | Client (edit only) | `false` on create; archive/restore with `PATCH` |
| created_at, updated_at | timestamp | Server | Set by the database |
| latest_value, latest_valuation_date | decimal, date or null | Server (read only) | Latest estimate from the Valuation service |

Server-owned fields sent by a client (`id`, `is_archived` on create, timestamps) are ignored.

## Contracts

### List, search and filter (F2)
`GET /api/items?collection_id={id}&search=&category=&condition=&archived=false|true|all&sort=newest|oldest|title`

`200 OK`: `{ "items": [ Item, ... ], "count": 2 }`. `search` matches title or description,
ignoring case; `archived` defaults to `false` (active items only).
Errors: `400` (bad collection_id or filter), `401`, `404` (not a member).

### Item details (F2)
`GET /api/items/{id}`. `200 OK`: `{ "item": { ...Item, "valuation_count": 2 }, "your_role": "owner" }`.
Errors: `401`, `404 ITEM_NOT_FOUND` (unknown, malformed or another collection's item).

### Categories (F2)
`GET /api/items/categories?collection_id={id}`. `200 OK`: `{ "categories": ["Coins", "Sneakers"] }`.

### Create (F1 + F3)
`POST /api/items`, headers `Content-Type: application/json` and `X-Turnstile-Token: <widget token>`.

```json
{
  "collection_id": "4b7c...",
  "title": "1952 Silver Pound",
  "category": "Coins",
  "condition": "excellent",
  "description": "King Farouk era",
  "acquisition_date": "2024-03-01",
  "acquisition_cost": 120.50,
  "confirm_duplicate": false
}
```

`201 Created`: `{ "message": "...", "item": Item, "duplicates": [] }`.

`409 POSSIBLE_DUPLICATE` when the title matches an existing item and `confirm_duplicate`
is not `true`:

```json
{
  "error": { "code": "POSSIBLE_DUPLICATE", "message": "This item looks like one already in the collection. ..." },
  "duplicates": [
    { "id": "9e1f...", "title": "1952 Silver Pound", "category": "Coins", "condition": "excellent",
      "is_archived": false, "reason": "same_title", "score": 1 }
  ]
}
```

Errors: `400`, `401`, `403 BOT_CHECK_FAILED`, `403 FORBIDDEN` (viewer), `404`, `409`,
`413`, `415`, `503 BOT_CHECK_UNAVAILABLE`.

### Edit, archive, restore (F1 + F3)
`PATCH /api/items/{id}` with any of the editable fields, for example
`{ "condition": "mint" }`, `{ "acquisition_cost": null }` (clears it) or `{ "is_archived": true }`.
A changed title or category is checked for duplicates again (`409` unless confirmed).
`200 OK`: `{ "message": "...", "item": Item }`. Errors: `400`, `401`, `403`, `404`, `409`, `415`.

### Duplicate check (F3)
`GET /api/items/duplicates?collection_id={id}&title=...&category=...&exclude_id={itemId}`.
`200 OK`: `{ "duplicates": [ ... ], "has_duplicates": true }`.
Used by the form while the user types; `exclude_id` skips the item being edited.

**Matching rules** (`backend/services/duplicateCheck.js`): titles are normalised (lower case,
letters and digits only, any alphabet including Arabic).

1. `same_title`: normalised titles are identical, in any category.
2. `similar_title`: same category and word overlap (Jaccard) >= 0.6, or one title contains the
   other (4+ characters).

Archived items are included, so an archived duplicate is still reported. At most 5 matches
are returned, most similar first.

## Error responses

| Status | Code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | Missing, malformed or out-of-range input |
| 401 | UNAUTHORIZED / INVALID_TOKEN | No token, or an expired or invalid token |
| 403 | FORBIDDEN | A viewer tries to change the catalogue |
| 403 | BOT_CHECK_FAILED | Turnstile token missing, invalid, expired or already used |
| 404 | ITEM_NOT_FOUND / COLLECTION_NOT_FOUND | Unknown ID, or not a member of the collection |
| 409 | POSSIBLE_DUPLICATE | Likely duplicate and `confirm_duplicate` not set |
| 413 | PAYLOAD_TOO_LARGE | Body over 32 KB |
| 415 | UNSUPPORTED_MEDIA_TYPE | Body is not JSON |
| 429 | RATE_LIMITED | Too many requests from one IP |
| 503 | BOT_CHECK_UNAVAILABLE | Cloudflare could not be reached; nothing saved |
| 500 | INTERNAL_ERROR | Unexpected server error (details only in the server log) |

## Test plan

IDs match the requests in `postman/Catalogue.postman_collection.json`
(folder *1. Full API test (local)*). Results from the Postman collection runner: local folder
56 requests, 93/93 checks passed; deployed folder (L01-L13) all passed. Screenshots are in the report.

| ID | Test | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| C01 | Owner creates an item with all fields | 201; stored values returned, cost `120.50`, not archived | 201; cost `120.50`, `is_archived` false | Pass |
| C03 | Blank title | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR "Title is required." | Pass |
| C04 | Condition `shiny` | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR | Pass |
| C05 | Negative cost | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR | Pass |
| C06 | Acquisition date in the future | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR | Pass |
| C07 | Impossible date 2023-02-30 | 400 VALIDATION_ERROR | 400 VALIDATION_ERROR "not a real date" | Pass |
| C08 | Body sent as text/plain | 415 UNSUPPORTED_MEDIA_TYPE | 415 UNSUPPORTED_MEDIA_TYPE | Pass |
| C09 | Viewer creates an item | 403 FORBIDDEN | 403 FORBIDDEN | Pass |
| C10 | Non-member creates an item | 404 | 404 COLLECTION_NOT_FOUND | Pass |
| C11 | No login token | 401 | 401 UNAUTHORIZED | Pass |
| C12 | Edit condition and description | 200; title unchanged | 200; condition `mint`, title unchanged | Pass |
| C13 | Clear the cost with `null` | 200; cost is null | 200; cost `null` | Pass |
| C14 | Viewer edits | 403 | 403 FORBIDDEN | Pass |
| C15 | Edit an unknown item | 404 ITEM_NOT_FOUND | 404 ITEM_NOT_FOUND | Pass |
| C16 | Edit with an empty body | 400 | 400 VALIDATION_ERROR | Pass |
| C17-C19 | Archive, check hidden from default list, restore | 200, not listed, 200 | 200, only the other item listed, 200 | Pass |
| S01 | List active items | 200; count 2 | 200; 2 items | Pass |
| S02 | Search `SILVER` | 200; one match (case-insensitive) | 200; 1 item (1952 Silver Pound) | Pass |
| S03 | Search a word from the description | 200; one match | 200; 1 item | Pass |
| S04 | Filter category `sneakers` | 200; only Sneakers | 200; 1 item, Sneakers | Pass |
| S05 | Filter condition `mint` | 200; only mint | 200; 1 item, mint | Pass |
| S06 | Sort by title | 200; A-Z order | 200; 1952 Silver Pound, then Air Jordan 1 Chicago | Pass |
| S08 | Invalid filter value | 400 | 400 VALIDATION_ERROR | Pass |
| S09 | Missing collection_id | 400 | 400 VALIDATION_ERROR | Pass |
| S10 / S11 | List as viewer / as non-member | 200 / 404 | 200 (2 items) / 404 | Pass |
| S12 | Categories | 200; Coins and Sneakers | 200; `["Coins","Sneakers"]` | Pass |
| S13-S15 | Details as owner / viewer / non-member | 200 role owner / 200 role viewer / 404 | 200 `your_role` owner / 200 `your_role` viewer / 404 | Pass |
| D01 | Duplicate check `1952 silver pound!` in another category | 200; `same_title` match | 200; `same_title` | Pass |
| D02 | Duplicate check excluding the item itself | 200; no duplicates | 200; `has_duplicates` false | Pass |
| D03 | Create `Air Jordan 1 Chicago 1985` in `sneakers` | 409 POSSIBLE_DUPLICATE; `similar_title` | 409 POSSIBLE_DUPLICATE; `similar_title` (score 0.8) | Pass |
| D04 | Same with `confirm_duplicate: true` | 201; warning returned | 201; matching item returned in `duplicates` | Pass |
| D05 | Same word in another category | 201 | 201 | Pass |
| D06 | Edit a title into an existing one | 409 | 409 POSSIBLE_DUPLICATE; `same_title` | Pass |
| T01 | Create without Turnstile token | 403 BOT_CHECK_FAILED | 403 BOT_CHECK_FAILED | Pass |
| T02 | Invalid login token | 401 INVALID_TOKEN | 401 INVALID_TOKEN | Pass |
| T03 | Unknown route | 404 ROUTE_NOT_FOUND | 404 ROUTE_NOT_FOUND | Pass |
| T04 | Security headers on responses | nosniff, DENY, no-store, no X-Powered-By | nosniff, DENY, no-store; no X-Powered-By | Pass |
| I01 | Record a valuation on a catalogue item | 201 (Valuation service) | 201 | Pass |
| I02 | Item details after the valuation | 200; latest_value `250.00`, valuation_count 1 | 200; `latest_value` `250.00`, `valuation_count` 1 | Pass |
| L10 | Deployed API with Cloudflare's test token | 403: real Turnstile key active | 403 BOT_CHECK_FAILED | Pass |
| L11 | Deployed API with a forged token | 403 BOT_CHECK_FAILED | 403 BOT_CHECK_FAILED | Pass |

Locally the backend uses Cloudflare's test secret key, which accepts any token, so a forged
token can only be shown failing on the deployed API with the real secret key (L10, L11).

### Browser checks (deployed site)

| ID | Check | Expected |
|---|---|---|
| B01 | Add an item, refresh, open in a second browser | Item still there (stored in Neon) |
| B02 | Type an existing title in the form | Yellow "Possible duplicate" warning appears |
| B03 | Save it anyway | "This looks like an item you already have" step, then saved |
| B04 | Sign in as a viewer | No form, no Edit/Archive buttons; items visible |
| B05 | Archive an item | Hidden from active list; excluded from the collection value |
| B06 | `curl -I` on the frontend URL | Content-Security-Policy and the other security headers present |
