// Catalogue controller (Collection Catalogue service, owner: Abdulmoez).
//
// Every handler follows the same order:
//   1. validate the input (400 / 415 on bad input)
//   2. check the caller's role in the collection (403 / 404)
//   3. call the service, which runs the SQL
//   4. answer with JSON
//
// Functionalities:
//   F1  Maintain item records - create, edit and archive/restore items with
//       category, description, condition and acquisition details
//   F2  Find owned items      - search by title/description, filter by
//       category, condition and archive state, sort, and open item details
//   F3  Duplicate detection   - warn before saving an item that looks like one
//       already in the collection (see services/duplicateCheck.js)
const itemService = require('../services/itemService');
const { getUserRole } = require('../services/collectionService');
const { findDuplicates } = require('../services/duplicateCheck');

const CONDITIONS = ['mint', 'near_mint', 'excellent', 'good', 'fair', 'poor'];
const ARCHIVE_FILTERS = ['false', 'true', 'all'];
const SORTS = ['newest', 'oldest', 'title'];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sendError(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: { code, message }, ...extra });
}

// A validation problem is thrown as an error with code VALIDATION_ERROR and
// turned into a 400 response in one place (handleErrors below).
function invalid(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

// Required text: trimmed, between min and max characters.
function requiredText(value, label, max) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} is required.`);
  const text = value.trim();
  if (text.length > max) throw invalid(`${label} must be at most ${max} characters.`);
  return text;
}

// Optional text: null or '' means "no value".
function optionalText(value, label, max) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${label} must be text.`);
  const text = value.trim();
  if (text.length > max) throw invalid(`${label} must be at most ${max} characters.`);
  return text || null;
}

function condition(value) {
  if (!CONDITIONS.includes(value)) {
    throw invalid(`Condition must be one of: ${CONDITIONS.join(', ')}.`);
  }
  return value;
}

// Optional date 'YYYY-MM-DD': must be a real calendar date and not in the future.
function acquisitionDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid('Acquisition date must use the format YYYY-MM-DD.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalid('Acquisition date is not a real date.');
  }
  // One day of tolerance, so a user in a timezone ahead of UTC (Cairo is UTC+2)
  // can always enter today's date.
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw invalid('Acquisition date cannot be in the future.');
  }
  if (year < 1000) throw invalid('Acquisition date is too far in the past.');
  return value;
}

// Optional money amount: non-negative, at most 10 digits and 2 decimals.
// Kept as a string so no rounding happens before Postgres stores it exactly.
function acquisitionCost(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) {
    throw invalid('Acquisition cost must be a non-negative amount with up to 2 decimal places.');
  }
  return text;
}

function collectionIdFrom(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw invalid('A valid collection_id is required.');
  }
  return value;
}

function requireJson(req) {
  if (!req.is('application/json')) {
    throw Object.assign(new Error('Content-Type must be application/json.'), {
      code: 'UNSUPPORTED_MEDIA_TYPE'
    });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw invalid('Request body must be a JSON object.');
  }
}

// Validates the editable fields that are present in body.
// creating = true: title, category and condition are required.
// creating = false (PATCH): only the fields sent are validated and changed.
function itemFields(body, creating) {
  const rules = {
    title: (v) => requiredText(v, 'Title', 150),
    category: (v) => requiredText(v, 'Category', 100),
    description: (v) => optionalText(v, 'Description', 1000),
    condition: (v) => condition(v),
    acquisition_date: (v) => acquisitionDate(v),
    acquisition_cost: (v) => acquisitionCost(v)
  };
  if (!creating) {
    rules.is_archived = (v) => {
      if (typeof v !== 'boolean') throw invalid('is_archived must be true or false.');
      return v;
    };
  }

  const values = {};
  for (const [field, check] of Object.entries(rules)) {
    if (creating || Object.hasOwn(body, field)) {
      values[field] = check(body[field]);
    }
  }
  // Server-owned fields (id, collection_id on edit, created_at...) are ignored.
  if (!creating && Object.keys(values).length === 0) {
    throw invalid('Send at least one field to change.');
  }
  return values;
}

function confirmFlag(body) {
  if (body.confirm_duplicate === undefined) return false;
  if (typeof body.confirm_duplicate !== 'boolean') {
    throw invalid('confirm_duplicate must be true or false.');
  }
  return body.confirm_duplicate;
}

// Readers: owner or viewer. Writers: owner only.
async function requireRole(collectionId, userId, ownerOnly) {
  const role = await getUserRole(collectionId, userId);
  if (!role) {
    return { status: 404, code: 'COLLECTION_NOT_FOUND', message: 'Collection not found.' };
  }
  if (ownerOnly && role !== 'owner') {
    return { status: 403, code: 'FORBIDDEN', message: 'Only the collection owner can change its catalogue.' };
  }
  return null;
}

// Wraps a handler so validation errors become 400/415 and anything
// unexpected goes to the central error handler in server.js (500).
function handleErrors(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR') {
        return sendError(res, 400, 'VALIDATION_ERROR', error.message);
      }
      if (error.code === 'UNSUPPORTED_MEDIA_TYPE') {
        return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', error.message);
      }
      return next(error);
    }
  };
}

// Answers 409 when likely duplicates exist and the user has not confirmed.
// Returns true when it already sent the response.
function blockDuplicates(res, duplicates, confirmed) {
  if (duplicates.length === 0 || confirmed) return false;
  sendError(res, 409, 'POSSIBLE_DUPLICATE',
    'This item looks like one already in the collection. Send confirm_duplicate: true to save it anyway.',
    { duplicates });
  return true;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// GET /api/items?collection_id=...&search=&category=&condition=&archived=&sort=
// F2: list, search and filter. Owners and viewers.
const listItems = handleErrors(async (req, res) => {
  const q = req.query;
  const collectionId = collectionIdFrom(q.collection_id);
  const filters = {
    search: q.search === undefined ? '' : optionalText(q.search, 'Search', 150) ?? '',
    category: q.category ? requiredText(q.category, 'Category', 100) : null,
    condition: q.condition ? condition(q.condition) : null,
    archived: q.archived ?? 'false',
    sort: q.sort ?? 'newest'
  };
  if (!ARCHIVE_FILTERS.includes(filters.archived)) throw invalid('archived must be false, true or all.');
  if (!SORTS.includes(filters.sort)) throw invalid('sort must be newest, oldest or title.');

  const problem = await requireRole(collectionId, req.user.userId, false);
  if (problem) return sendError(res, problem.status, problem.code, problem.message);

  const items = await itemService.listItems(collectionId, filters);
  res.status(200).json({ items, count: items.length });
});

// GET /api/items/categories?collection_id=...
// F2 helper: the categories used in the collection, for the filter dropdown.
const listCategories = handleErrors(async (req, res) => {
  const collectionId = collectionIdFrom(req.query.collection_id);
  const problem = await requireRole(collectionId, req.user.userId, false);
  if (problem) return sendError(res, problem.status, problem.code, problem.message);

  const categories = await itemService.listCategories(collectionId);
  res.status(200).json({ categories });
});

// GET /api/items/duplicates?collection_id=...&title=...&category=...&exclude_id=
// F3: check a title before saving (the form calls this as the user types).
const checkDuplicates = handleErrors(async (req, res) => {
  const q = req.query;
  const collectionId = collectionIdFrom(q.collection_id);
  const candidate = {
    title: requiredText(q.title, 'Title', 150),
    category: requiredText(q.category, 'Category', 100)
  };
  if (q.exclude_id !== undefined && !UUID.test(q.exclude_id)) throw invalid('exclude_id must be an item ID.');

  const problem = await requireRole(collectionId, req.user.userId, false);
  if (problem) return sendError(res, problem.status, problem.code, problem.message);

  const existing = await itemService.listTitles(collectionId);
  const duplicates = findDuplicates(candidate, existing, q.exclude_id ?? null);
  res.status(200).json({ duplicates, has_duplicates: duplicates.length > 0 });
});

// GET /api/items/:id
// F2: item details, including the latest valuation. Owners and viewers.
const getItem = handleErrors(async (req, res) => {
  const { id } = req.params;
  // A malformed id can never match, so it is answered like an unknown id.
  const item = UUID.test(id) ? await itemService.findItemForUser(id, req.user.userId) : undefined;
  if (!item) return sendError(res, 404, 'ITEM_NOT_FOUND', 'Item not found.');

  const { role, ...details } = item;
  res.status(200).json({ item: details, your_role: role });
});

// POST /api/items   (protected by Cloudflare Turnstile in routes/itemRoutes.js)
// F1 + F3: create an item, blocking likely duplicates unless confirmed.
const createItem = handleErrors(async (req, res) => {
  requireJson(req);
  const collectionId = collectionIdFrom(req.body.collection_id);
  const fields = itemFields(req.body, true);
  const confirmed = confirmFlag(req.body);

  const problem = await requireRole(collectionId, req.user.userId, true);
  if (problem) return sendError(res, problem.status, problem.code, problem.message);

  const existing = await itemService.listTitles(collectionId);
  const duplicates = findDuplicates(fields, existing);
  if (blockDuplicates(res, duplicates, confirmed)) return;

  const item = await itemService.createItem(collectionId, fields);
  console.log(`AUDIT ITEM_CREATED item=${item.id} collection=${collectionId} user=${req.user.userId}`);
  res.status(201).json({ message: 'Item created successfully.', item, duplicates });
});

// PATCH /api/items/:id
// F1: edit any field, or archive/restore with { "is_archived": true|false }.
// F3: a changed title or category is checked for duplicates again.
const updateItem = handleErrors(async (req, res) => {
  requireJson(req);
  const { id } = req.params;
  const current = UUID.test(id) ? await itemService.findItemForUser(id, req.user.userId) : undefined;
  if (!current) return sendError(res, 404, 'ITEM_NOT_FOUND', 'Item not found.');
  if (current.role !== 'owner') {
    return sendError(res, 403, 'FORBIDDEN', 'Only the collection owner can change its catalogue.');
  }

  const changes = itemFields(req.body, false);
  const confirmed = confirmFlag(req.body);

  if (changes.title !== undefined || changes.category !== undefined) {
    const candidate = {
      title: changes.title ?? current.title,
      category: changes.category ?? current.category
    };
    const existing = await itemService.listTitles(current.collection_id);
    const duplicates = findDuplicates(candidate, existing, current.id);
    if (blockDuplicates(res, duplicates, confirmed)) return;
  }

  const item = await itemService.updateItem(id, changes);
  const action = changes.is_archived === true ? 'ITEM_ARCHIVED'
    : changes.is_archived === false ? 'ITEM_RESTORED' : 'ITEM_UPDATED';
  console.log(`AUDIT ${action} item=${id} user=${req.user.userId}`);
  res.status(200).json({ message: 'Item updated successfully.', item });
});

module.exports = {
  listItems,
  listCategories,
  checkDuplicates,
  getItem,
  createItem,
  updateItem
};
