// Catalogue controller (Collection Catalogue service, Abdulmoez).
// Built like the Lab 4 controller: each handler checks the request, checks the
// user's role in the collection, calls the service and sends the response.
//
//   F1  Maintain item records: create, edit, archive and restore items
//   F2  Find owned items: search, filter, sort and item details
//   F3  Duplicate detection: warn before saving an item that looks like one
//       already in the collection (services/duplicateCheck.js)
const itemService = require('../services/itemService');
const { getUserRole } = require('../services/collectionService');
const { findDuplicates } = require('../services/duplicateCheck');

const conditions = ['mint', 'near_mint', 'excellent', 'good', 'fair', 'poor'];
const archiveFilters = ['false', 'true', 'all'];
const sorts = ['newest', 'oldest', 'title'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONE_DAY = 24 * 60 * 60 * 1000;

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

// Each check returns an error message, or null when the value is valid.

function checkText(value, label, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    return `${label} is required.`;
  }
  if (value.trim().length > max) {
    return `${label} must be at most ${max} characters.`;
  }
  return null;
}

function checkOptionalText(value, label, max) {
  if (isEmpty(value)) return null;
  if (typeof value !== 'string') {
    return `${label} must be text.`;
  }
  if (value.trim().length > max) {
    return `${label} must be at most ${max} characters.`;
  }
  return null;
}

function checkCondition(value) {
  if (!conditions.includes(value)) {
    return `Condition must be one of: ${conditions.join(', ')}.`;
  }
  return null;
}

// Optional date 'YYYY-MM-DD': a real calendar date, not in the future.
function checkDate(value) {
  if (isEmpty(value)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'Acquisition date must use the format YYYY-MM-DD.';
  }
  // A date like 2023-02-30 does not come back unchanged, so it is not real.
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return 'Acquisition date is not a real date.';
  }
  // One day of tolerance, so a user ahead of UTC (Cairo is UTC+2) can always
  // enter today's date.
  if (date.getTime() > Date.now() + ONE_DAY) {
    return 'Acquisition date cannot be in the future.';
  }
  if (date.getUTCFullYear() < 1000) {
    return 'Acquisition date is too far in the past.';
  }
  return null;
}

// Optional amount: not negative, at most 10 digits and 2 decimals.
function checkCost(value) {
  if (isEmpty(value)) return null;
  if ((typeof value !== 'number' && typeof value !== 'string')
      || !/^\d{1,10}(\.\d{1,2})?$/.test(String(value))) {
    return 'Acquisition cost must be a non-negative amount with up to 2 decimal places.';
  }
  return null;
}

function checkCollectionId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return 'A valid collection_id is required.';
  }
  return null;
}

function checkConfirmFlag(value) {
  if (value !== undefined && typeof value !== 'boolean') {
    return 'confirm_duplicate must be true or false.';
  }
  return null;
}

// Checks the item fields in a request body. A new item needs title, category
// and condition. An edit (PATCH) only checks the fields that were sent.
function validateItem(body, creating) {
  const sent = (field) => creating || body[field] !== undefined;

  const problem =
    (sent('title') && checkText(body.title, 'Title', 150)) ||
    (sent('category') && checkText(body.category, 'Category', 100)) ||
    (sent('description') && checkOptionalText(body.description, 'Description', 1000)) ||
    (sent('condition') && checkCondition(body.condition)) ||
    (sent('acquisition_date') && checkDate(body.acquisition_date)) ||
    (sent('acquisition_cost') && checkCost(body.acquisition_cost));
  if (problem) return problem;

  if (!creating) {
    if (body.is_archived !== undefined && typeof body.is_archived !== 'boolean') {
      return 'is_archived must be true or false.';
    }
    const fields = ['title', 'category', 'description', 'condition',
      'acquisition_date', 'acquisition_cost', 'is_archived'];
    if (!fields.some((field) => body[field] !== undefined)) {
      return 'Send at least one field to change.';
    }
  }
  return null;
}

// The values that are saved: text is trimmed, an empty optional field is null.
function cleanText(value) {
  if (isEmpty(value)) return null;
  return value.trim() || null;
}

function cleanValue(value) {
  return isEmpty(value) ? null : String(value);
}

function sendDuplicateWarning(res, duplicates) {
  return res.status(409).json({
    error: {
      code: 'POSSIBLE_DUPLICATE',
      message: 'This item looks like one already in the collection. Send confirm_duplicate: true to save it anyway.'
    },
    duplicates
  });
}

// GET /api/items?collection_id=...&search=&category=&condition=&archived=&sort=
// F2: list, search and filter. Owners and viewers.
async function listItems(req, res, next) {
  try {
    const q = req.query;
    const problem = checkCollectionId(q.collection_id) ||
      checkOptionalText(q.search, 'Search', 150) ||
      (q.category && checkText(q.category, 'Category', 100)) ||
      (q.condition && checkCondition(q.condition));
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    const filters = {
      search: q.search ? q.search.trim() : '',
      category: q.category ? q.category.trim() : null,
      condition: q.condition || null,
      archived: q.archived || 'false',
      sort: q.sort || 'newest'
    };
    if (!archiveFilters.includes(filters.archived)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'archived must be false, true or all.');
    }
    if (!sorts.includes(filters.sort)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'sort must be newest, oldest or title.');
    }

    const role = await getUserRole(q.collection_id, req.user.userId);
    if (!role) {
      return sendError(res, 404, 'COLLECTION_NOT_FOUND', 'Collection not found.');
    }

    const items = await itemService.listItems(q.collection_id, filters);
    res.status(200).json({ items, count: items.length });
  } catch (error) {
    next(error);
  }
}

// GET /api/items/categories?collection_id=...
// F2: the categories used in the collection, for the filter list.
async function listCategories(req, res, next) {
  try {
    const collectionId = req.query.collection_id;
    const problem = checkCollectionId(collectionId);
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    const role = await getUserRole(collectionId, req.user.userId);
    if (!role) {
      return sendError(res, 404, 'COLLECTION_NOT_FOUND', 'Collection not found.');
    }

    const categories = await itemService.listCategories(collectionId);
    res.status(200).json({ categories });
  } catch (error) {
    next(error);
  }
}

// GET /api/items/duplicates?collection_id=...&title=...&category=...&exclude_id=
// F3: the form calls this while the user types a title.
async function checkDuplicates(req, res, next) {
  try {
    const q = req.query;
    let problem = checkCollectionId(q.collection_id) ||
      checkText(q.title, 'Title', 150) ||
      checkText(q.category, 'Category', 100);
    if (!problem && q.exclude_id !== undefined && !UUID_PATTERN.test(q.exclude_id)) {
      problem = 'exclude_id must be an item ID.';
    }
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    const role = await getUserRole(q.collection_id, req.user.userId);
    if (!role) {
      return sendError(res, 404, 'COLLECTION_NOT_FOUND', 'Collection not found.');
    }

    const existing = await itemService.listTitles(q.collection_id);
    const candidate = { title: q.title.trim(), category: q.category.trim() };
    const duplicates = findDuplicates(candidate, existing, q.exclude_id || null);
    res.status(200).json({ duplicates, has_duplicates: duplicates.length > 0 });
  } catch (error) {
    next(error);
  }
}

// GET /api/items/:id
// F2: item details with the latest valuation. Owners and viewers.
async function getItem(req, res, next) {
  try {
    const id = req.params.id;
    // An id that is not a UUID can never match, so it gets the same 404.
    const item = UUID_PATTERN.test(id) ? await itemService.findItemForUser(id, req.user.userId) : null;
    if (!item) {
      return sendError(res, 404, 'ITEM_NOT_FOUND', 'Item not found.');
    }

    const role = item.role;
    delete item.role;
    res.status(200).json({ item, your_role: role });
  } catch (error) {
    next(error);
  }
}

// POST /api/items   (routes/itemRoutes.js runs the Turnstile check first)
// F1 + F3: create an item, unless it looks like a duplicate and was not confirmed.
async function createItem(req, res, next) {
  try {
    if (!req.is('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
    }

    const body = req.body;
    const problem = checkCollectionId(body.collection_id) ||
      validateItem(body, true) ||
      checkConfirmFlag(body.confirm_duplicate);
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    const role = await getUserRole(body.collection_id, req.user.userId);
    if (!role) {
      return sendError(res, 404, 'COLLECTION_NOT_FOUND', 'Collection not found.');
    }
    if (role !== 'owner') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the collection owner can change its catalogue.');
    }

    const newItem = {
      title: body.title.trim(),
      category: body.category.trim(),
      description: cleanText(body.description),
      condition: body.condition,
      acquisition_date: cleanValue(body.acquisition_date),
      acquisition_cost: cleanValue(body.acquisition_cost)
    };

    const existing = await itemService.listTitles(body.collection_id);
    const duplicates = findDuplicates(newItem, existing);
    if (duplicates.length > 0 && body.confirm_duplicate !== true) {
      return sendDuplicateWarning(res, duplicates);
    }

    const item = await itemService.createItem(body.collection_id, newItem);
    console.log(`AUDIT ITEM_CREATED item=${item.id} collection=${body.collection_id} user=${req.user.userId}`);
    res.status(201).json({ message: 'Item created successfully.', item, duplicates });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/items/:id
// F1: edit fields, or archive / restore with { "is_archived": true | false }.
// F3: a changed title or category is checked for duplicates again.
async function updateItem(req, res, next) {
  try {
    if (!req.is('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
    }

    const id = req.params.id;
    const current = UUID_PATTERN.test(id) ? await itemService.findItemForUser(id, req.user.userId) : null;
    if (!current) {
      return sendError(res, 404, 'ITEM_NOT_FOUND', 'Item not found.');
    }
    if (current.role !== 'owner') {
      return sendError(res, 403, 'FORBIDDEN', 'Only the collection owner can change its catalogue.');
    }

    const body = req.body;
    const problem = validateItem(body, false) || checkConfirmFlag(body.confirm_duplicate);
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    // Start from the saved item and change only the fields that were sent.
    // Other fields in the body (id, collection_id, created_at...) are ignored.
    const item = {
      title: current.title,
      category: current.category,
      description: current.description,
      condition: current.condition,
      acquisition_date: current.acquisition_date,
      acquisition_cost: current.acquisition_cost,
      is_archived: current.is_archived
    };
    if (body.title !== undefined) item.title = body.title.trim();
    if (body.category !== undefined) item.category = body.category.trim();
    if (body.description !== undefined) item.description = cleanText(body.description);
    if (body.condition !== undefined) item.condition = body.condition;
    if (body.acquisition_date !== undefined) item.acquisition_date = cleanValue(body.acquisition_date);
    if (body.acquisition_cost !== undefined) item.acquisition_cost = cleanValue(body.acquisition_cost);
    if (body.is_archived !== undefined) item.is_archived = body.is_archived;

    if (body.title !== undefined || body.category !== undefined) {
      const existing = await itemService.listTitles(current.collection_id);
      const duplicates = findDuplicates(item, existing, current.id);
      if (duplicates.length > 0 && body.confirm_duplicate !== true) {
        return sendDuplicateWarning(res, duplicates);
      }
    }

    const updated = await itemService.updateItem(id, item);

    let action = 'ITEM_UPDATED';
    if (body.is_archived === true) action = 'ITEM_ARCHIVED';
    if (body.is_archived === false) action = 'ITEM_RESTORED';
    console.log(`AUDIT ${action} item=${id} user=${req.user.userId}`);

    res.status(200).json({ message: 'Item updated successfully.', item: updated });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listItems,
  listCategories,
  checkDuplicates,
  getItem,
  createItem,
  updateItem
};
