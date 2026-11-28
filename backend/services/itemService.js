// Catalogue service: every database operation on the items table.
// The controller validates input and checks permissions first, so this file
// only runs SQL. Values are passed with the sql tagged template, which sends
// each ${value} as a separate parameter (never as SQL text), so user input
// cannot change a query (no SQL injection).
const sql = require('../db/db');

// Dates are cast to text so the JSON carries plain 'YYYY-MM-DD' strings with no
// timezone shift. latest_value and latest_valuation_date come from the
// Valuation service's table: the subquery takes the newest estimate of each
// item, or null when the item has never been valued.

// 1. List the items of one collection, with optional search and filters.
async function listItems(collectionId, { search, category, condition, archived, sort }) {
  const pattern = `%${search}%`;
  const showArchived = archived === 'true';
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
      AND (${archived} = 'all' OR i.is_archived = ${showArchived})
      -- search matches the title or the description (ILIKE ignores upper/lower case)
      AND (${search} = '' OR i.title ILIKE ${pattern} OR i.description ILIKE ${pattern})
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
// Returns undefined when the item does not exist or the user is not a member,
// so the API answers 404 in both cases and never shows other collections.
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

// 5. Save an edited item. The controller sends the whole item: the fields that
// were changed plus the current values of the others.
async function updateItem(itemId, item) {
  const [updated] = await sql`
    UPDATE items
    SET title = ${item.title},
        category = ${item.category},
        description = ${item.description},
        condition = ${item.condition},
        acquisition_date = ${item.acquisition_date},
        acquisition_cost = ${item.acquisition_cost},
        is_archived = ${item.is_archived},
        updated_at = now()
    WHERE id = ${itemId}
    RETURNING id, collection_id, title, category, description, condition,
              acquisition_date::text AS acquisition_date, acquisition_cost,
              is_archived, created_at, updated_at
  `;
  return updated;
}

// 6. Duplicate detection: the items to compare a new title with. Collections
// are small, so the titles are read once and compared in JavaScript
// (services/duplicateCheck.js).
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
