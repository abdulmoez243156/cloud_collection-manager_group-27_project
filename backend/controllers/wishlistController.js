const wishlist = require('../services/wishlistService');
const { getUserRole } = require('../services/collectionService');

const priorities = ['high', 'medium', 'low'];
const statuses = ['wanted', 'acquired'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'WISHLIST_VALIDATION' });
}

function text(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.trim().length > max) {
    throw invalid(`${label} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${max} characters.`);
  }
  return value.trim();
}

function choice(value, options, label) {
  if (!options.includes(value)) throw invalid(`${label} must be ${options.join(', ')}.`);
  return value;
}

function money(value, label) {
  const decimal = typeof value === 'number' ? String(value) : value;
  if (typeof decimal !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(decimal)) {
    throw invalid(`${label} must be a nonnegative amount with up to two decimal places.`);
  }
  return decimal;
}

function entryInput(req, creating) {
  const body = req.body;
  if (!req.is('application/json')) {
    throw Object.assign(new Error('Content-Type must be application/json.'), { code: 'WISHLIST_MEDIA' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Supply a JSON object.');

  const fields = {
    title: value => text(value, 'Title', 150),
    category: value => text(value, 'Category', 100),
    priority: value => choice(value, priorities, 'Priority'),
    target_budget: value => value === null ? null : money(value, 'Target budget')
  };
  if (!creating) fields.status = value => choice(value, statuses, 'Status');

  const keys = Object.keys(body);
  if (keys.some(key => !Object.hasOwn(fields, key)) || (!creating && keys.length === 0)) {
    throw invalid('Supply supported Wishlist fields.');
  }
  const values = Object.fromEntries(keys.map(key => [key, fields[key](body[key])]));
  if (creating && (!values.title || !values.category || !values.priority)) {
    throw invalid('Title, category, and priority are required.');
  }
  if (creating) values.target_budget ??= null;
  return values;
}

function protect(ownerOnly, action) {
  return async (req, res, next) => {
    try {
      const { collectionId, id } = req.params;
      if (!uuid.test(collectionId) || (id !== undefined && !uuid.test(id))) {
        throw invalid('Invalid collection or Wishlist entry ID.');
      }

      const role = await getUserRole(collectionId, req.user.userId);
      if (role !== 'owner' && (ownerOnly || role !== 'viewer')) {
        return fail(res, 403, 'FORBIDDEN', ownerOnly ? 'Only the collection owner can change its Wishlist.' : 'Collection access is required.');
      }
      return await action(req, res, collectionId, id);
    } catch (error) {
      if (error.code === 'WISHLIST_VALIDATION') return fail(res, 400, 'VALIDATION_ERROR', error.message);
      if (error.code === 'WISHLIST_MEDIA') return fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE', error.message);
      return next(error);
    }
  };
}

const list = protect(false, async (req, res, collectionId) => {
  const { search = '', category, priority, status, max_budget } = req.query;
  const entries = await wishlist.list(collectionId, {
    search: text(search, 'Search', 150, true),
    category: category === undefined ? null : text(category, 'Category', 100),
    priority: priority === undefined ? null : choice(priority, priorities, 'Priority'),
    status: status === undefined ? null : choice(status, statuses, 'Status'),
    maxBudget: max_budget === undefined ? null : money(max_budget, 'Maximum budget')
  });
  return res.json({ entries });
});

const create = protect(true, async (req, res, collectionId) => {
  const entry = await wishlist.create(collectionId, entryInput(req, true));
  return res.status(201).json({ entry });
});

const update = protect(true, async (req, res, collectionId, id) => {
  const entry = await wishlist.update(collectionId, id, entryInput(req, false));
  if (!entry) return fail(res, 404, 'NOT_FOUND', 'Wishlist entry not found.');
  return res.json({ entry });
});

const remove = protect(true, async (req, res, collectionId, id) => {
  if (!await wishlist.remove(collectionId, id)) return fail(res, 404, 'NOT_FOUND', 'Wishlist entry not found.');
  return res.status(204).end();
});

const plan = protect(false, async (req, res, collectionId) => {
  const result = await wishlist.plan(collectionId, money(req.query.limit, 'Spending limit'));
  return res.json(result);
});

module.exports = { list, create, update, remove, plan };
