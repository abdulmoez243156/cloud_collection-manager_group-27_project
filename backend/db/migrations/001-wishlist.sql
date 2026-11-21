CREATE TABLE IF NOT EXISTS wishlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title varchar(150) NOT NULL CHECK (length(btrim(title)) > 0),
  category varchar(100) NOT NULL CHECK (length(btrim(category)) > 0),
  priority text NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  target_budget numeric(12,2) CHECK (target_budget >= 0),
  status text NOT NULL DEFAULT 'wanted' CHECK (status IN ('wanted', 'acquired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wishlist_entries_collection_idx
  ON wishlist_entries (collection_id);
