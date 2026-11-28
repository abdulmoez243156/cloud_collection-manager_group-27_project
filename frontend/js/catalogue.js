// Catalogue page (Collection Catalogue service, owner: Abdulmoez).
//
// F1  Maintain item records: add, edit, archive and restore items
// F2  Find owned items: search, filter, sort and open item details
// F3  Duplicate detection: live warning while typing, and a confirm step when
//     the API answers 409 POSSIBLE_DUPLICATE
//
// API calls (all through CM.request in api.js):
//   GET   /api/items?collection_id=..&search=..&category=..&condition=..&archived=..&sort=..
//   GET   /api/items/categories?collection_id=..
//   GET   /api/items/duplicates?collection_id=..&title=..&category=..&exclude_id=..
//   GET   /api/items/:id
//   POST  /api/items
//   PATCH /api/items/:id
'use strict';

const CONDITION_LABELS = {
  mint: 'Mint',
  near_mint: 'Near mint',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor'
};

const DUPLICATE_REASONS = {
  same_title: 'same title',
  similar_title: 'similar title, same category'
};

const ui = {
  collectionLine: document.getElementById('collection-line'),
  itemCount: document.getElementById('item-count'),
  noCollection: document.getElementById('no-collection'),
  catalogue: document.getElementById('catalogue'),
  editorCard: document.getElementById('editor-card'),
  editorTitle: document.getElementById('editor-title'),
  form: document.getElementById('item-form'),
  saveButton: document.getElementById('save-item'),
  cancelEdit: document.getElementById('cancel-edit'),
  categoryOptions: document.getElementById('category-options'),
  duplicateHint: document.getElementById('duplicate-hint'),
  duplicateConfirm: document.getElementById('duplicate-confirm'),
  duplicateList: document.getElementById('duplicate-list'),
  confirmSave: document.getElementById('confirm-save'),
  dismissDuplicate: document.getElementById('dismiss-duplicate'),
  filters: document.getElementById('filters'),
  items: document.getElementById('items'),
  dialog: document.getElementById('item-dialog'),
  dialogTitle: document.getElementById('dialog-title'),
  dialogBody: document.getElementById('dialog-body'),
  dialogClose: document.getElementById('dialog-close')
};

const state = {
  collection: null,   // { id, title, currency, role }
  editing: null,      // the item being edited, or null when adding
  pending: null       // a save waiting for "Save anyway" after a 409
};

const isOwner = () => state.collection?.role === 'owner';
const conditionLabel = (value) => CONDITION_LABELS[value] || value;

// Loading data

function filterQuery() {
  const values = Object.fromEntries(new FormData(ui.filters));
  const query = new URLSearchParams({ collection_id: state.collection.id });
  for (const [key, value] of Object.entries(values)) {
    if (value.trim()) query.set(key, value.trim());
  }
  return query;
}

// F2: list with the current search, filters and sort.
async function loadItems() {
  try {
    const { items, count } = await CM.request(`/items?${filterQuery()}`);
    renderItems(items);
    ui.itemCount.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
    ui.itemCount.hidden = false;
  } catch (error) {
    CM.notify(`Could not load items: ${error.message}`, true);
  }
}

// Fills the category suggestions in the form and the category filter.
async function loadCategories() {
  const query = new URLSearchParams({ collection_id: state.collection.id });
  const { categories } = await CM.request(`/items/categories?${query}`);

  ui.categoryOptions.replaceChildren(...categories.map((c) => CM.el('option', { attrs: { value: c } })));

  const select = ui.filters.elements.namedItem('category');
  const current = select.value;
  select.replaceChildren(
    CM.el('option', { text: 'All categories', attrs: { value: '' } }),
    ...categories.map((c) => CM.el('option', { text: c, attrs: { value: c } })));
  if (categories.includes(current)) select.value = current;
}

// Rendering the item cards

// True when the user has typed a search or changed a filter.
function filtersInUse() {
  const fields = ui.filters.elements;
  return fields.namedItem('search').value.trim() !== ''
    || fields.namedItem('category').value !== ''
    || fields.namedItem('condition').value !== ''
    || fields.namedItem('archived').value !== 'false';
}

function renderItems(items) {
  if (items.length === 0) {
    const filtered = filtersInUse();
    ui.items.replaceChildren(CM.el('div', { className: 'empty-state' }, [
      CM.el('p', { text: filtered ? 'No items match these filters.' : 'No items in this collection yet.' }),
      !filtered && isOwner() ? CM.el('p', { className: 'muted', text: 'Use the form to add your first item.' }) : null
    ]));
    return;
  }
  ui.items.replaceChildren(...items.map(renderItemCard));
}

function renderItemCard(item) {
  const facts = [];
  if (item.acquisition_date) facts.push(`Acquired ${CM.formatDate(item.acquisition_date)}`);
  if (item.acquisition_cost !== null) facts.push(`Paid ${CM.money(item.acquisition_cost, state.collection.currency)}`);

  const value = item.latest_value !== null
    ? CM.el('p', { className: 'item-value' }, [
      CM.el('span', { className: 'muted', text: 'Latest value ' }),
      CM.el('strong', { text: CM.money(item.latest_value, state.collection.currency) }),
      CM.el('span', { className: 'muted', text: ` | ${CM.formatDate(item.latest_valuation_date)}` })
    ])
    : CM.el('p', { className: 'item-value muted', text: 'Not valued yet' });

  const actions = [CM.button('Details', () => showDetails(item.id))];
  if (isOwner()) {
    if (!item.is_archived) actions.push(CM.button('Edit', () => startEdit(item)));
    actions.push(item.is_archived
      ? CM.button('Restore', () => setArchived(item, false))
      : CM.button('Archive', () => setArchived(item, true), 'btn btn-danger-ghost'));
  }

  return CM.el('article', { className: `item-card${item.is_archived ? ' is-archived' : ''}` }, [
    CM.el('div', { className: 'item-head' }, [
      CM.el('h3', { text: item.title }),
      CM.el('span', { className: `badge cond-${item.condition}`, text: conditionLabel(item.condition) })
    ]),
    CM.el('p', { className: 'item-category' }, [
      CM.el('span', { text: item.category }),
      item.is_archived ? CM.el('span', { className: 'badge badge-archived', text: 'Archived' }) : null
    ]),
    facts.length ? CM.el('p', { className: 'item-facts muted', text: facts.join(' | ') }) : null,
    value,
    CM.el('div', { className: 'item-actions' }, actions)
  ]);
}

// F2: item details dialog

async function showDetails(itemId) {
  try {
    const { item, your_role: role } = await CM.request(`/items/${encodeURIComponent(itemId)}`);
    const currency = state.collection.currency;
    const rows = [
      ['Category', item.category],
      ['Condition', conditionLabel(item.condition)],
      ['Description', item.description || '-'],
      ['Acquired on', CM.formatDate(item.acquisition_date)],
      ['Cost paid', CM.money(item.acquisition_cost, currency)],
      ['Latest value', item.latest_value !== null
        ? `${CM.money(item.latest_value, currency)} (${CM.formatDate(item.latest_valuation_date)})`
        : 'Not valued yet'],
      ['Valuations recorded', String(item.valuation_count)],
      ['Status', item.is_archived ? 'Archived (excluded from collection value)' : 'Active'],
      ['Added', CM.formatDate(item.created_at)],
      ['Last changed', CM.formatDate(item.updated_at)],
      ['Your access', role]
    ];
    const list = CM.el('dl', { className: 'details' });
    for (const [label, text] of rows) {
      list.append(CM.el('dt', { text: label }), CM.el('dd', { text }));
    }
    ui.dialogTitle.textContent = item.title;
    ui.dialogBody.replaceChildren(list);
    ui.dialog.showModal();
  } catch (error) {
    CM.notify(error.message, true);
  }
}

ui.dialogClose.addEventListener('click', () => ui.dialog.close());
// Clicking the dark area outside the dialog also closes it.
ui.dialog.addEventListener('click', (event) => {
  if (event.target === ui.dialog) ui.dialog.close();
});

// F1: add and edit

// Reads the form into the JSON body the API expects. Empty optional fields
// are sent as null.
function formPayload() {
  const v = Object.fromEntries(new FormData(ui.form));
  return {
    title: v.title.trim(),
    category: v.category.trim(),
    condition: v.condition,
    description: v.description.trim() || null,
    acquisition_date: v.acquisition_date || null,
    acquisition_cost: v.acquisition_cost === '' ? null : v.acquisition_cost
  };
}

function resetForm() {
  state.editing = null;
  state.pending = null;
  ui.form.reset();
  ui.editorTitle.textContent = 'Add an item';
  ui.saveButton.textContent = 'Add item';
  ui.cancelEdit.hidden = true;
  document.getElementById('turnstile-widget').hidden = false;
  ui.duplicateHint.hidden = true;
  ui.duplicateConfirm.hidden = true;
  ui.form.hidden = false;
}

function startEdit(item) {
  resetForm();
  state.editing = item;
  const fields = ui.form.elements;
  fields.namedItem('title').value = item.title;
  fields.namedItem('category').value = item.category;
  fields.namedItem('condition').value = item.condition;
  fields.namedItem('description').value = item.description || '';
  fields.namedItem('acquisition_date').value = item.acquisition_date || '';
  fields.namedItem('acquisition_cost').value = item.acquisition_cost || '';
  ui.editorTitle.textContent = `Edit "${item.title}"`;
  ui.saveButton.textContent = 'Save changes';
  ui.cancelEdit.hidden = false;
  // Only creating an item needs the bot check; edits are owner-only anyway.
  document.getElementById('turnstile-widget').hidden = true;
  ui.editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  fields.namedItem('title').focus();
}

// Sends the save. confirmDuplicate = true is used after "Save anyway".
async function saveItem(payload, confirmDuplicate = false) {
  const body = { ...payload };
  if (confirmDuplicate) body.confirm_duplicate = true;

  if (state.editing) {
    await CM.request(`/items/${encodeURIComponent(state.editing.id)}`, { method: 'PATCH', body });
    return 'Changes saved.';
  }
  body.collection_id = state.collection.id;
  const { item } = await CM.request('/items', {
    method: 'POST',
    body,
    headers: botCheckHeaders()
  });
  return `"${item.title}" added to the catalogue.`;
}

// External API: Cloudflare Turnstile on item creation (Lab 5, Part O1)
// The widget gives a one-time token. It travels in the X-Turnstile-Token
// header, so the JSON body stays the same. The server checks the token with
// Cloudflare before saving (backend/middleware/turnstile.js).
let turnstileWidgetId = null;

function renderTurnstile() {
  if (window.turnstile && turnstileWidgetId === null) {
    turnstileWidgetId = window.turnstile.render('#turnstile-widget', { sitekey: TURNSTILE_SITE_KEY });
  }
}

function botCheckHeaders() {
  // If the Turnstile script could not load, send no token: the API then
  // refuses with 403 BOT_CHECK_FAILED and the message is shown.
  if (!window.turnstile || turnstileWidgetId === null) return {};
  const token = window.turnstile.getResponse(turnstileWidgetId);
  if (!token) {
    throw new Error('Please complete the bot check first.');
  }
  return { 'X-Turnstile-Token': token };
}

async function submitSave(payload, confirmDuplicate) {
  try {
    const message = await CM.busy(ui.editorCard, () => saveItem(payload, confirmDuplicate));
    resetForm();
    await Promise.all([loadItems(), loadCategories()]);
    CM.notify(message);
  } catch (error) {
    if (error.code === 'POSSIBLE_DUPLICATE') {
      showDuplicateConfirm(payload, error.body.duplicates);
    } else {
      CM.notify(error.message, true);
    }
  } finally {
    afterSaveAttempt();
  }
}

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitSave(formPayload(), false);
});

ui.cancelEdit.addEventListener('click', resetForm);

// F3: duplicate detection in the browser

function duplicateItems(duplicates) {
  return duplicates.map((d) => CM.el('li', {}, [
    CM.el('strong', { text: d.title }),
    CM.el('span', {
      className: 'muted',
      text: ` | ${d.category} | ${conditionLabel(d.condition)} | ${DUPLICATE_REASONS[d.reason] || d.reason}`
    }),
    d.is_archived ? CM.el('span', { className: 'badge badge-archived', text: 'Archived' }) : null
  ]));
}

// After a 409: hide the form and ask the owner to confirm or go back.
function showDuplicateConfirm(payload, duplicates) {
  state.pending = payload;
  ui.duplicateList.replaceChildren(...duplicateItems(duplicates));
  ui.form.hidden = true;
  ui.duplicateConfirm.hidden = false;
  ui.confirmSave.focus();
}

ui.confirmSave.addEventListener('click', () => {
  if (state.pending) submitSave(state.pending, true);
});

ui.dismissDuplicate.addEventListener('click', () => {
  state.pending = null;
  ui.duplicateConfirm.hidden = true;
  ui.form.hidden = false;
  ui.form.elements.namedItem('title').focus();
});

// Live hint: shortly after the user stops typing a title and category, ask
// the API whether a similar item exists. The final decision is still made by
// the server when the item is saved.
const checkTitleAsTyped = CM.debounce(async () => {
  const title = ui.form.elements.namedItem('title').value.trim();
  const category = ui.form.elements.namedItem('category').value.trim();
  if (!title || !category) {
    ui.duplicateHint.hidden = true;
    return;
  }
  const query = new URLSearchParams({ collection_id: state.collection.id, title, category });
  if (state.editing) query.set('exclude_id', state.editing.id);
  try {
    const { duplicates } = await CM.request(`/items/duplicates?${query}`);
    if (duplicates.length === 0) {
      ui.duplicateHint.hidden = true;
      return;
    }
    ui.duplicateHint.replaceChildren(
      CM.el('p', { text: 'Possible duplicate of:' }),
      CM.el('ul', { className: 'dup-list' }, duplicateItems(duplicates)));
    ui.duplicateHint.hidden = false;
  } catch {
    ui.duplicateHint.hidden = true; // the hint is optional; saving still checks
  }
}, 450);

ui.form.elements.namedItem('title').addEventListener('input', checkTitleAsTyped);
ui.form.elements.namedItem('category').addEventListener('input', checkTitleAsTyped);

// F1: archive and restore

async function setArchived(item, archived) {
  if (archived && !window.confirm(`Archive "${item.title}"? It will be hidden and excluded from the collection value. You can restore it later.`)) {
    return;
  }
  try {
    await CM.busy(ui.items, () => CM.request(`/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: { is_archived: archived }
    }));
    if (state.editing?.id === item.id) resetForm();
    await loadItems();
    CM.notify(archived ? `"${item.title}" archived.` : `"${item.title}" restored.`);
  } catch (error) {
    CM.notify(error.message, true);
  }
}

// Filters

const reloadAfterTyping = CM.debounce(loadItems, 300);
ui.filters.addEventListener('submit', (event) => {
  event.preventDefault();
  loadItems();
});
ui.filters.addEventListener('input', (event) => {
  if (event.target.name === 'search') reloadAfterTyping();
});
ui.filters.addEventListener('change', (event) => {
  if (event.target.name !== 'search') loadItems();
});
// "Clear": the form resets first, then the list reloads.
ui.filters.addEventListener('reset', () => setTimeout(loadItems, 0));

// Page start

// A Turnstile token works only once, so ask the widget for a fresh one after
// every attempt to create an item, whether it succeeded or failed.
function afterSaveAttempt() {
  if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
}

async function chooseCollection() {
  const { collections } = await CM.request('/collections');
  const stored = CM.selectedCollection.get();
  const collection = collections.find((c) => c.id === stored?.id)
    || (collections.length === 1 ? collections[0] : null);
  CM.selectedCollection.set(collection);
  return collection;
}

async function startPage() {
  if (!CM.requireLogin()) return;
  try {
    state.collection = await chooseCollection();
    CM.renderHeader('catalogue');
    if (!state.collection) {
      ui.noCollection.hidden = false;
      return;
    }

    ui.collectionLine.textContent = isOwner()
      ? `${state.collection.title} | you are the owner`
      : `${state.collection.title} | view only: you can browse but not change items`;
    ui.editorCard.hidden = !isOwner();
    if (isOwner()) renderTurnstile();
    ui.catalogue.classList.toggle('layout-single', !isOwner());
    ui.catalogue.hidden = false;
    // Acquisition dates cannot be in the future: today's date is the maximum.
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    ui.form.elements.namedItem('acquisition_date').max = `${now.getFullYear()}-${month}-${day}`;

    await Promise.all([loadCategories(), loadItems()]);
  } catch (error) {
    CM.renderHeader('catalogue');
    CM.notify(error.message, true);
  }
}

startPage();
