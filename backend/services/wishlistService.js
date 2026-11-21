const sql = require('../db/db');

async function list(collectionId, { search, category, priority, status, maxBudget }) {
  return sql`
    SELECT id, title, category, priority, target_budget, status
    FROM wishlist_entries
    WHERE collection_id = ${collectionId}
      AND position(lower(${search}) IN lower(title)) > 0
      AND (${category}::text IS NULL OR lower(category) = lower(${category}))
      AND (${priority}::text IS NULL OR priority = ${priority})
      AND (${status}::text IS NULL OR status = ${status})
      AND (${maxBudget}::numeric IS NULL OR target_budget <= ${maxBudget})
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             created_at, id
  `;
}

async function create(collectionId, entry) {
  const [created] = await sql`
    INSERT INTO wishlist_entries (collection_id, title, category, priority, target_budget)
    VALUES (${collectionId}, ${entry.title}, ${entry.category}, ${entry.priority}, ${entry.target_budget})
    RETURNING id, title, category, priority, target_budget, status
  `;
  return created;
}

async function update(collectionId, id, changes) {
  const [entry] = await sql`
    UPDATE wishlist_entries
    SET title = COALESCE(${changes.title ?? null}, title),
        category = COALESCE(${changes.category ?? null}, category),
        priority = COALESCE(${changes.priority ?? null}, priority),
        target_budget = CASE WHEN ${Object.hasOwn(changes, 'target_budget')}::boolean
                             THEN ${changes.target_budget ?? null}::numeric ELSE target_budget END,
        status = COALESCE(${changes.status ?? null}, status)
    WHERE collection_id = ${collectionId} AND id = ${id}
    RETURNING id, title, category, priority, target_budget, status
  `;
  return entry;
}

async function remove(collectionId, id) {
  const [entry] = await sql`
    DELETE FROM wishlist_entries WHERE collection_id = ${collectionId} AND id = ${id}
    RETURNING id
  `;
  return Boolean(entry);
}

function cents(amount) {
  const [whole, fraction = ''] = String(amount).split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

async function plan(collectionId, limit) {
  const entries = await list(collectionId, {
    search: '', category: null, priority: null, status: 'wanted', maxBudget: null
  });
  let remaining = cents(limit);
  const fixedMoney = value => (value / 100).toFixed(2);
  const selected = [];
  const deferred = [];
  for (const entry of entries) {
    if (entry.target_budget === null) {
      deferred.push({ ...entry, reason: 'missing_budget' });
      continue;
    }
    const cost = cents(entry.target_budget);
    if (cost > remaining) {
      deferred.push({ ...entry, reason: 'over_budget' });
      continue;
    }
    selected.push(entry);
    remaining -= cost;
  }
  return {
    limit: fixedMoney(cents(limit)),
    planned_total: fixedMoney(cents(limit) - remaining),
    remaining: fixedMoney(remaining),
    selected,
    deferred
  };
}

module.exports = { list, create, update, remove, plan };
