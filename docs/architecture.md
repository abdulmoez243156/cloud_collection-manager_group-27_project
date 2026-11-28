# Collection Manager: architecture

GitHub draws the diagrams below automatically (Mermaid).

## 1. Three-layer cloud architecture (Floci, main deployment)

```mermaid
flowchart LR
  user([Collector or viewer<br/>web browser])

  subgraph floci["Floci on the laptop (local AWS, Labs 7-8)"]
    s3["Amazon S3<br/>bucket team27-collection-web<br/>HTML, CSS, JavaScript"]
    apigw["Amazon API Gateway<br/>HTTP API team27-collection-api<br/>routes per service, stage $default"]
    subgraph lambdas["AWS Lambda (Express via serverless-http)"]
      cat["team27-catalogue-api<br/>Catalogue"]
      wish["team27-wishlist-api<br/>Wishlist"]
      val["team27-valuation-api<br/>Valuation + accounts, collections"]
    end
    iam["IAM: one role per function<br/>(may write only its own logs)"]
    cw["CloudWatch Logs<br/>/aws/lambda/&lt;function&gt;"]
  end

  subgraph neon["Neon (managed Postgres)"]
    db[("users, collections, members<br/>items, valuations, wishlist")]
  end

  cf["Cloudflare Turnstile<br/>(external API)"]

  user -- "HTTP: pages" --> s3
  user -- "HTTP + JSON: fetch()<br/>Bearer token" --> apigw
  user -. "widget token" .- cf
  apigw -- "/api/items/..." --> cat
  apigw -- "/api/collections/{id}/wishlist/..." --> wish
  apigw -- "/api/auth, /api/collections,<br/>/api/valuations, /api/reports" --> val
  cat & wish & val -- "SQL over TLS<br/>DATABASE_URL" --> db
  cat -- "HTTPS siteverify<br/>secret key" --> cf
  lambdas -. "assume role" .- iam
  lambdas -- "request logs" --> cw
```

| Layer | Responsibility | Cloud service (Floci) | Talks to |
|---|---|---|---|
| Presentation | Forms, lists, loading and error messages; no secrets | Amazon S3 (static website) | API Gateway over HTTP/JSON; Turnstile widget |
| Application | Login check, role check, validation, business rules, duplicate matching, summaries | API Gateway (HTTP API) + one AWS Lambda function per service, IAM roles, CloudWatch Logs | Neon over TLS; Cloudflare siteverify over HTTPS |
| Data | Persistent records with relationships and `CHECK` rules | Neon Postgres | Reached only through the Lambda functions |

Cloud model: **public cloud services (AWS, emulated locally by Floci)** used as
**serverless / Function as a Service**: API Gateway and Lambda run the code only when a
request arrives and scale by running more copies, so there are no servers to manage.
S3 hosts the static files, IAM limits what each function may do, and CloudWatch collects
the logs. The database is **Neon, a managed PaaS database**: our data has relationships
(members, items, valuations) and `CHECK` rules, which a relational database handles better
than DynamoDB. **Turnstile is consumed as SaaS.** Nothing is stored on the functions'
temporary file system; all state is in Neon.

Each service is deployed as its own function, so it can be updated, monitored (its own log
group) and limited (its own IAM role) separately, while all three share one database and
one API address.

### Also deployed: Vercel + Neon (public copy)

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
  participant GW as API Gateway
  participant API as Lambda team27-catalogue-api
  participant DB as Neon Postgres

  Owner->>CF: Widget checks the browser
  CF-->>Owner: One-time token
  Owner->>GW: POST /api/items (JSON + Bearer token + X-Turnstile-Token)
  GW->>API: route POST /api/items -> Catalogue function
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
Browser: forms, config.js (public)  --HTTP(S)-->  API Gateway -> Lambda  --TLS-->  Neon
          Turnstile widget                      secrets in env vars:
                                                DATABASE_URL, JWT_SECRET,
                                                TURNSTILE_SECRET_KEY
```

1. The API validates every request; browser checks are only for convenience.
2. The browser never reaches the database; only the Lambda functions have `DATABASE_URL`,
   and only the Catalogue function has the Turnstile secret key.
3. Roles are decided on the server from `collection_members`, never from what the browser sends.
4. Data is shown with `textContent`, never `innerHTML`, and the Content-Security-Policy only
   allows the site's own scripts and Cloudflare's widget.
5. Errors return generic messages; details go only to the server logs (CloudWatch Logs
   on Floci, the Logs tab on Vercel).
