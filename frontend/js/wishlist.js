'use strict';

const byId = id => document.getElementById(id);
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const configuredOrigin = document.querySelector('meta[name="collection-api-origin"]').content.trim();
// Integration: use the shared API address from config.js when the meta tag is empty.
const sharedOrigin = typeof API_BASE_URL === 'string' ? API_BASE_URL.replace(/\/api\/?$/, '') : '';
const origin = (configuredOrigin || sharedOrigin || (local ? 'http://localhost:3000' : location.origin)).replace(/\/$/, '');
const tokenKey = 'collection-manager.wishlist.token';
const editor = byId('editor');
const filters = byId('filters');
const planner = byId('planner');
const selection = byId('collections');
// Integration: reuse the login from the Home page (shared session in api.js).
const shared = typeof CM === 'object' ? CM : null;
let token = shared ? shared.session.token() : sessionStorage.getItem(tokenKey);
let collections = [];
let collection;
let editingId;
let busy = false;

function announce(message = '', error = false) {
  const notice = byId('notice');
  notice.textContent = message;
  notice.dataset.error = String(error);
  notice.hidden = !message;
}

async function api(path, { method = 'GET', body, authorized = true } = {}) {
  const headers = {};
  if (authorized && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}/api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 204) return;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (authorized && (response.status === 401 || payload.error?.code === 'INVALID_TOKEN')) {
      signOut();
    }
    throw new Error(payload.error?.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function wishlistPath(suffix = '') {
  return `/collections/${encodeURIComponent(collection.id)}/wishlist${suffix}`;
}

function values(form) {
  return Object.fromEntries(new FormData(form));
}

function resetEditor(entry) {
  editingId = entry?.id;
  editor.reset();
  if (entry) {
    for (const field of ['title', 'category', 'priority', 'target_budget']) {
      editor.elements.namedItem(field).value = entry[field] ?? '';
    }
  }
  byId('editor-title').textContent = entry ? 'Edit Wishlist item' : 'Add a wanted item';
  byId('save-entry').textContent = entry ? 'Save changes' : 'Add item';
  byId('cancel-edit').hidden = !entry;
}

function money(value) {
  if (value === null) return 'No target budget';
  return `${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })} ${collection.currency}`;
}

function element(tag, text) {
  const child = document.createElement(tag);
  child.textContent = text;
  return child;
}

function action(label, handler) {
  const button = element('button', label);
  button.type = 'button';
  button.className = 'secondary';
  button.addEventListener('click', handler);
  return button;
}

function renderEntries(entries) {
  const target = byId('entries');
  if (!entries.length) {
    target.replaceChildren(element('p', 'No Wishlist entries match.'));
    return;
  }
  const list = document.createElement('ul');
  list.className = 'entry-list';
  for (const entry of entries) {
    const row = document.createElement('li');
    const details = document.createElement('div');
    details.append(element('strong', entry.title), element('p',
      `${entry.category} · ${entry.priority} priority · ${entry.status} · ${money(entry.target_budget)}`));
    row.append(details);

    if (collection.role === 'owner') {
      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      const wanted = entry.status === 'wanted';
      buttons.append(
        action('Edit', () => {
          resetEditor(entry);
          editor.elements.namedItem('title').focus();
        }),
        action(wanted ? 'Mark acquired' : 'Mark wanted', () => run(async () => {
          await api(wishlistPath(`/${entry.id}`), {
            method: 'PATCH', body: { status: wanted ? 'acquired' : 'wanted' }
          });
          await refreshAfterChange('Status updated.');
        })),
        action('Remove', () => run(async () => {
          if (!window.confirm(`Remove “${entry.title}” from the Wishlist?`)) return;
          await api(wishlistPath(`/${entry.id}`), { method: 'DELETE' });
          if (editingId === entry.id) resetEditor();
          await refreshAfterChange('Item removed.');
        }))
      );
      row.append(buttons);
    }
    list.append(row);
  }
  target.replaceChildren(list);
}

async function loadEntries() {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values(filters))) {
    if (value.trim()) query.set(key, value.trim());
  }
  const result = await api(wishlistPath(`?${query}`));
  renderEntries(result.entries);
}

async function refreshAfterChange(message) {
  byId('plan-result').replaceChildren();
  await loadEntries();
  announce(message);
}

async function showCollection(id) {
  collection = collections.find(item => item.id === id);
  if (shared && collection) shared.selectedCollection.set(collection); // Integration: same collection on every page
  byId('collection-content').hidden = !collection;
  byId('editor-panel').hidden = collection?.role !== 'owner';
  byId('access').textContent = collection
    ? `Access: ${collection.role} · Currency: ${collection.currency}`
    : 'Create a collection to start a Wishlist.';
  resetEditor();
  filters.reset();
  planner.reset();
  byId('entries').replaceChildren();
  byId('plan-result').replaceChildren();
  if (collection) await loadEntries();
}

async function loadCollections(preferredId) {
  ({ collections } = await api('/collections'));
  selection.replaceChildren(...collections.map(item => new Option(item.title, item.id)));
  if (collections.some(item => item.id === preferredId)) selection.value = preferredId;
  await showCollection(selection.value);
}

async function signIn() {
  if (shared) shared.renderHeader('wishlist'); // Integration: shared header with the user and navigation
  byId('account').hidden = true;
  byId('workspace').hidden = false;
  byId('sign-out').hidden = false;
  await loadCollections(shared?.selectedCollection.get()?.id); // Integration: open the selected collection
}

function signOut() {
  token = null;
  collection = undefined;
  collections = [];
  sessionStorage.removeItem(tokenKey);
  if (shared) shared.session.clear(); // Integration: sign out of the whole app
  if (shared) shared.renderHeader('wishlist'); // Integration: header without the signed-in parts
  byId('workspace').hidden = true;
  byId('account').hidden = false;
  byId('sign-out').hidden = true;
  byId('entries').replaceChildren();
  byId('plan-result').replaceChildren();
}

async function run(task) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('button:not(:disabled)')];
  buttons.forEach(button => { button.disabled = true; });
  selection.disabled = true;
  announce();
  try {
    await task();
  } catch (error) {
    announce(error.message, true);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
    selection.disabled = false;
    busy = false;
  }
}

function onSubmit(id, task) {
  byId(id).addEventListener('submit', event => {
    event.preventDefault();
    run(() => task(event.currentTarget));
  });
}

onSubmit('login', async form => {
  const result = await api('/auth/login', { method: 'POST', body: values(form), authorized: false });
  token = result.token;
  sessionStorage.setItem(tokenKey, token);
  if (shared) shared.session.save(result.token, result.user); // Integration: shared login
  form.reset();
  await signIn();
});

onSubmit('register', async form => {
  const input = values(form);
  await api('/auth/register', { method: 'POST', body: input, authorized: false });
  form.reset();
  byId('login').elements.namedItem('email').value = input.email;
  byId('login').elements.namedItem('password').focus();
  announce('Account created. Sign in to continue.');
});

onSubmit('new-collection', async form => {
  const result = await api('/collections', { method: 'POST', body: values(form) });
  form.reset();
  await loadCollections(result.collection.id);
  announce('Collection created.');
});

onSubmit('editor', async form => {
  const input = values(form);
  input.target_budget = input.target_budget || null;
  const method = editingId ? 'PATCH' : 'POST';
  await api(wishlistPath(editingId ? `/${editingId}` : ''), { method, body: input });
  resetEditor();
  await refreshAfterChange(method === 'POST' ? 'Item added.' : 'Changes saved.');
});

onSubmit('filters', loadEntries);
onSubmit('planner', async form => {
  const target = byId('plan-result');
  target.replaceChildren();
  const result = await api(wishlistPath(`/budget-plan?${new URLSearchParams(values(form))}`));
  target.append(element('p', `Planned: ${money(result.planned_total)} · Remaining: ${money(result.remaining)}`));
  for (const [title, entries] of [['Included', result.selected], ['Deferred', result.deferred]]) {
    const list = document.createElement('ul');
    for (const entry of entries) {
      const detail = entry.reason === 'over_budget' ? ' · exceeds remaining budget' : '';
      list.append(element('li', `${entry.title} · ${money(entry.target_budget)}${detail}`));
    }
    target.append(element('h3', title), entries.length ? list : element('p', 'None'));
  }
});

byId('clear-filters').addEventListener('click', () => run(async () => {
  filters.reset();
  await loadEntries();
}));
byId('cancel-edit').addEventListener('click', () => resetEditor());
byId('sign-out').addEventListener('click', () => {
  signOut();
  announce('Signed out.');
});
selection.addEventListener('change', () => run(() => showCollection(selection.value)));
if (shared) shared.renderHeader('wishlist'); // Integration: shared header on page load
if (token) run(signIn);
