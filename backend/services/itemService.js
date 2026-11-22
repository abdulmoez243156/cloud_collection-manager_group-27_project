// Catalogue service: every database operation on the items table.
// The controller validates input and checks permissions first, so this file
// only runs SQL. Values are passed with the sql tagged template, which sends
// each ${value} as a separate parameter (never as SQL text), so user input
// cannot change a query (no SQL injection).
const sql = require('../db/db');

// Dates are cast to text so the JSON always carries plain 'YYYY-MM-DD'
// strings with no timezone shift.
// latest_value / latest_valuation_date come from the Valuation service's table:
// a small subquery picks the most recent estimate for each item (newest date
// first), or gives null when the item has never been valued.

// 1. List the items of one collection, with optional search and filters.
async function listItems(collectionId, { search, category, condition, archived, sort }) {
  return sql`
    SELECT i.id, i.collection_id, i.title, i.category, i.description, i.condition,
           i.acquisition_date::text AS acquisition_date, i.acquisition_cost,
           i.is_archived, i.created_at, i.updated_at,
           (SELECT v.amount FROM valuations v
            WHERE v.item_id = i.id
            ORDER BY v.valuation_date DESC, v.recorded_timestamp DESC LIMIT 1) AS latest_value,
           (SELECT v.valuation_date::text FROM valuations v
            WHERE v.item_id = i.id
            ORDER BY v.valuation_date DESC, v.recorded_timestamp DESC LIMIT 1) AS latest_valuation_date
    FROM items i
    WHERE i.collection_id = ${collectionId}
      -- archived: 'false' = active only (default), 'true' = archived only, 'all' = both
      AND (${archived} = 'all' OR i.is_archived = (${archived} = 'true'))
      -- search matches the title or the description, ignoring upper/lower case
      AND (${search} = ''
           OR position(lower(${search}) IN lower(i.title)) > 0
           OR position(lower(${search}) IN lower(coalesce(i.description, ''))) > 0)
      AND (${category}::text IS NULL OR lower(i.category) = lower(${category}))
      AND (${condition}::text IS NULL OR i.condition = ${condition})
    ORDER BY
      CASE WHEN ${sort} = 'title' THEN lower(i.title) END ASC,
      CASE WHEN ${sort} = 'oldest' THEN i.created_at END ASC,
      i.created_at DESC,
      i.id
  `;
}

// 2. The distinct categories of a collection (fills the category filter list).
async function listCategories(collectionId) {
  const rows = await sql`
    SELECT DISTINCT category
    FROM items
    WHERE collection_id = ${collectionId}
    ORDER BY category
  `;
  return rows.map((row) => row.category);
}

// 3. One item plus the caller's role in the item's collection, in one query.
// Returns undefined when the item does not exist OR the user is not a member,
// so the API answers 404 in both cases and never reveals other collections.
async function findItemForUser(itemId, userId) {
  const [row] = await sql`
    SELECT i.id, i.collection_id, i.title, i.category, i.description, i.condition,
           i.acquisition_date::text AS acquisition_date, i.acquisition_cost,
           i.is_archived, i.created_at, i.updated_at,
           (SELECT v.amount FROM valuations v
            WHERE v.item_id = i.id
            ORDER BY v.valuation_date DESC, v.recorded_timestamp DESC LIMIT 1) AS latest_value,
           (SELECT v.valuation_date::text FROM valuations v
            WHERE v.item_id = i.id
            ORDER BY v.valuation_date DESC, v.recorded_timestamp DESC LIMIT 1) AS latest_valuation_date,
           (SELECT count(*)::int FROM valuations v WHERE v.item_id = i.id) AS valuation_count,
           cm.role
    FROM items i
    JOIN collection_members cm
      ON cm.collection_id = i.collection_id AND cm.user_id = ${userId}
    WHERE i.id = ${itemId}
  `;
  return row;
}

// 4. Create an item. The database fills in id, is_archived and the timestamps.
async function createItem(collectionId, item) {
  const [created] = await sql`
    INSERT INTO items (collection_id, title, category, description, condition,
                       acquisition_date, acquisition_cost)
    VALUES (${collectionId}, ${item.title}, ${item.category}, ${item.description},
            ${item.condition}, ${item.acquisition_date}, ${item.acquisition_cost})
    RETURNING id, collection_id, title, category, description, condition,
              acquisition_date::text AS acquisition_date, acquisition_cost,
              is_archived, created_at, updated_at
  `;
  return created;
}

// 5. Update only the fields that were sent.
// For each column: if the field was sent, use the new value (null clears an
// optional field), otherwise keep the current value.
async function updateItem(itemId, changes) {
  const has = (field) => Object.hasOwn(changes, field);
  const [updated] = await sql`
    UPDATE items SET
      title            = CASE WHEN ${has('title')}::boolean THEN ${changes.title ?? null} ELSE title END,
      category         = CASE WHEN ${has('category')}::boolean THEN ${changes.category ?? null} ELSE category END,
      description      = CASE WHEN ${has('description')}::boolean THEN ${changes.description ?? null} ELSE description END,
      condition        = CASE WHEN ${has('condition')}::boolean THEN ${changes.condition ?? null} ELSE condition END,
      acquisition_date = CASE WHEN ${has('acquisition_date')}::boolean
                              THEN ${changes.acquisition_date ?? null}::date ELSE acquisition_date END,
      acquisition_cost = CASE WHEN ${has('acquisition_cost')}::boolean
                              THEN ${changes.acquisition_cost ?? null}::numeric ELSE acquisition_cost END,
      is_archived      = CASE WHEN ${has('is_archived')}::boolean
                              THEN ${changes.is_archived ?? null}::boolean ELSE is_archived END,
      updated_at       = now()
    WHERE id = ${itemId}
    RETURNING id, collection_id, title, category, description, condition,
              acquisition_date::text AS acquisition_date, acquisition_cost,
              is_archived, created_at, updated_at
  `;
  return updated;
}

// 6. Duplicate detection: the candidates to compare against.
// Collections are small (tens to hundreds of items), so the service reads the
// titles once and the controller scores them in JavaScript, which keeps the
// matching rules easy to read, test and explain.
async function listTitles(collectionId) {
  return sql`
    SELECT id, title, category, condition, is_archived
    FROM items
    WHERE collection_id = ${collectionId}
  `;
}

module.exports = {
  listItems,
  listCategories,
  findItemForUser,
  createItem,
  updateItem,
  listTitles
};
