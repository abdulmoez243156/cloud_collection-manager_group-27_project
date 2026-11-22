-- Collection Manager: complete database schema (Neon Postgres)
--
-- Run this whole file once in the Neon SQL Editor on a new database.
-- Every statement uses IF NOT EXISTS, so running it again is safe and
-- does not touch tables or data that already exist.
--
-- Table order matters because of the foreign keys:
--   users -> collections -> collection_members -> items -> valuations
--                                              -> wishlist_entries
--
-- The CHECK rules repeat the API's validation inside the database, so even
-- a bug in a controller cannot store an invalid value (same idea as Lab 5).

-- gen_random_uuid() is built into Postgres 13+, which Neon uses.

-- 1. Accounts (Shared: Authentication)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(150) NOT NULL CHECK (length(btrim(name)) > 0),
  email         VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Collections (Shared: Authentication)
CREATE TABLE IF NOT EXISTS collections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      VARCHAR(150) NOT NULL CHECK (length(btrim(title)) > 0),
  currency   CHAR(3) NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Who belongs to which collection, and with which role.
-- One row per (collection, user). The role decides what the API allows.
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'viewer')),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS collection_members_user_idx
  ON collection_members (user_id);

-- 4. Catalogue items (Collection Catalogue service)
-- Items are archived, never deleted, so their valuation history is kept.
-- Archived items are hidden from the default list and excluded from totals.
CREATE TABLE IF NOT EXISTS items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title            VARCHAR(150) NOT NULL CHECK (length(btrim(title)) > 0),
  category         VARCHAR(100) NOT NULL CHECK (length(btrim(category)) > 0),
  description      VARCHAR(1000),
  condition        TEXT NOT NULL
                   CHECK (condition IN ('mint', 'near_mint', 'excellent', 'good', 'fair', 'poor')),
  acquisition_date DATE,
  acquisition_cost NUMERIC(12, 2) CHECK (acquisition_cost >= 0),
  is_archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speeds up "all active items of one collection", the most common query.
CREATE INDEX IF NOT EXISTS items_collection_idx
  ON items (collection_id, is_archived);

-- 5. Dated value estimates (Valuation and Reports service)
CREATE TABLE IF NOT EXISTS valuations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  amount             NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  valuation_date     DATE NOT NULL,
  note               VARCHAR(500),
  recorded_timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS valuations_item_idx
  ON valuations (item_id, valuation_date DESC, recorded_timestamp DESC);

-- 6. Wishlist (Wishlist and Acquisition service)
-- Same definition as backend/db/migrations/001-wishlist.sql, repeated here so
-- one file builds the whole database. Running both files is harmless.
CREATE TABLE IF NOT EXISTS wishlist_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title         VARCHAR(150) NOT NULL CHECK (length(btrim(title)) > 0),
  category      VARCHAR(100) NOT NULL CHECK (length(btrim(category)) > 0),
  priority      TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  target_budget NUMERIC(12, 2) CHECK (target_budget >= 0),
  status        TEXT NOT NULL DEFAULT 'wanted' CHECK (status IN ('wanted', 'acquired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wishlist_entries_collection_idx
  ON wishlist_entries (collection_id);
