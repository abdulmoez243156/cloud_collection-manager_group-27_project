# Collection Manager: architecture

GitHub draws the diagrams below automatically (Mermaid).

## 1. Three-layer cloud architecture

```mermaid
flowchart LR
  user([Collector or viewer<br/>web browser])

  subgraph vercelWeb["Vercel project: frontend (static hosting, CDN)"]
    pages["HTML, CSS, JavaScript<br/>index, catalogue, wishlist<br/>vercel.json security headers"]
  end

  subgraph vercelApi["Vercel project: API (serverless function)"]
    api["Node.js + Express REST API<br/>auth, rate limit, validation<br/>Catalogue, Wishlist, Valuation"]
  end

  subgraph neon["Neon (managed Postgres)"]
    db[("users, collections, members<br/>items, valuations, wishlist")]
  end

  cf["Cloudflare Turnstile<br/>(external API)"]

  user -- "HTTPS: pages" --> pages
  user -- "HTTPS + JSON: fetch()<br/>Bearer token" --> api
  user -. "widget token" .- cf
  api -- "SQL over TLS<br/>DATABASE_URL" --> db
  api -- "HTTPS siteverify<br/>secret key" --> cf
```

| Layer | Responsibility | Cloud service | Talks to |
|---|---|---|---|
| Presentation | Forms, lists, loading and error messages; no secrets | Vercel static hosting | API over HTTPS/JSON; Turnstile widget |
| Application | Login check, role check, validation, business rules, duplicate matching, summaries | Vercel Function (Express) | Neon over TLS; Cloudflare siteverify over HTTPS |
| Data | Persistent records with relationships and `CHECK` rules | Neon Postgres | Reached only through the API |

Cloud model: **public cloud, PaaS** (Vercel runs the code, Neon runs the database) with
**serverless compute** (the API runs on demand and scales automatically) and
**Turnstile consumed as SaaS**. Nothing is stored on the function's temporary file system;
all state is in Neon.

## 2. Database (entity relationship)

```mermaid
erDiagram
  USERS ||--o{ COLLECTION_MEMBERS : "belongs to"
  COLLECTIONS ||--o{ COLLECTION_MEMBERS : "has"
  COLLECTIONS ||--o{ ITEMS : "contains"
  COLLECTIONS ||--o{ WISHLIST_ENTRIES : "plans"
  ITEMS ||--o{ VALUATIONS : "is valued by"

  USERS {
    uuid id PK
    varchar name
    varchar email UK
    text password_hash
    timestamptz created_at
  }
  COLLECTIONS {
    uuid id PK
    varchar title
    char currency
    timestamptz created_at
  }
  COLLECTION_MEMBERS {
    uuid collection_id PK,FK
    uuid user_id PK,FK
    text role "owner | viewer"
    timestamptz added_at
  }
  ITEMS {
    uuid id PK
    uuid collection_id FK
    varchar title
    varchar category
    varchar description
    text condition "mint ... poor"
    date acquisition_date
    numeric acquisition_cost
    boolean is_archived
    timestamptz created_at
    timestamptz updated_at
  }
  VALUATIONS {
    uuid id PK
    uuid item_id FK
    numeric amount
    date valuation_date
    varchar note
    timestamptz recorded_timestamp
  }
  WISHLIST_ENTRIES {
    uuid id PK
    uuid collection_id FK
    varchar title
    varchar category
    text priority "high | medium | low"
    numeric target_budget
    text status "wanted | acquired"
    timestamptz created_at
  }
```

Items are archived rather than deleted, so their valuation history is kept. Archived items
are hidden by default and excluded from the collection value.

## 3. Request flow: creating a catalogue item

```mermaid
sequenceDiagram
  autonumber
  actor Owner as Owner (browser)
  participant CF as Cloudflare Turnstile
  participant API as Express API (Vercel)
  participant DB as Neon Postgres

  Owner->>CF: Widget checks the browser
  CF-->>Owner: One-time token
  Owner->>API: POST /api/items (JSON + Bearer token + X-Turnstile-Token)
  API->>API: auth middleware: verify JWT (401 if invalid)
  API->>CF: siteverify(secret, token)
  CF-->>API: success true / false (403 if false, 503 if unreachable)
  API->>API: validate fields (400), JSON only (415)
  API->>DB: role in collection? (404 not a member, 403 viewer)
  API->>DB: titles in the collection
  API->>API: duplicateCheck: same or similar title?
  alt likely duplicate and not confirmed
    API-->>Owner: 409 POSSIBLE_DUPLICATE + matching items
    Owner->>Owner: "Save anyway" or edit
  else no duplicate or confirmed
    API->>DB: INSERT INTO items ... RETURNING
    DB-->>API: stored row (id, timestamps)
    API-->>Owner: 201 Created + item
  end
```

## 4. Trust boundary

```
USER-CONTROLLED SIDE                    APPLICATION-CONTROLLED SIDE
Browser: forms, config.js (public)  --HTTPS-->  Express API  --TLS-->  Neon
          Turnstile widget                      secrets in env vars:
                                                DATABASE_URL, JWT_SECRET,
                                                TURNSTILE_SECRET_KEY
```

1. The API validates every request; browser checks are only for convenience.
2. The browser never reaches the database; only the API has `DATABASE_URL`.
3. Roles are decided on the server from `collection_members`, never from what the browser sends.
4. Data is shown with `textContent`, never `innerHTML`, and the Content-Security-Policy only
   allows the site's own scripts and Cloudflare's widget.
5. Errors return generic messages; details go only to the server logs (Vercel Logs).
