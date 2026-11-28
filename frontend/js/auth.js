// Home page: sign in, create an account, choose or create a collection, and
// (for owners) manage who can view it. Uses the shared auth and collection
// APIs: /api/auth/*, /api/collections and /api/collections/:id/members.
'use strict';

const homeEls = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  collectionForm: document.getElementById('collection-form'),
  collectionList: document.getElementById('collection-list'),
  newCollectionBox: document.getElementById('new-collection-box'),
  servicesHint: document.getElementById('services-hint'),
  tiles: [document.getElementById('tile-catalogue'), document.getElementById('tile-wishlist')],
  membersCard: document.getElementById('members-card'),
  memberList: document.getElementById('member-list'),
  memberForm: document.getElementById('member-form'),
  welcome: document.getElementById('welcome')
};

let homeCollections = [];

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

// Runs a form action: stops the normal page reload, disables the form's
// buttons while waiting, and shows any API error message.
function handleSubmit(form, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await CM.busy(form, () => action(formValues(form)));
    } catch (error) {
      CM.notify(error.message, true);
    }
  });
}

// Signed out: login and registration
async function logIn(email, password) {
  const result = await CM.request('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false
  });
  CM.session.save(result.token, result.user);
}

handleSubmit(homeEls.loginForm, async ({ email, password }) => {
  await logIn(email.trim(), password);
  homeEls.loginForm.reset();
  await showSignedIn();
  CM.notify('Signed in.');
});

handleSubmit(homeEls.registerForm, async ({ name, email, password }) => {
  await CM.request('/auth/register', {
    method: 'POST',
    body: { name: name.trim(), email: email.trim(), password },
    auth: false
  });
  // Sign the new user straight in.
  await logIn(email.trim(), password);
  homeEls.registerForm.reset();
  await showSignedIn();
  CM.notify('Account created. Start by creating your first collection.');
});

// Signed in: collections
function renderCollections() {
  const selected = CM.selectedCollection.get();
  if (homeCollections.length === 0) {
    homeEls.collectionList.replaceChildren(
      CM.el('li', { className: 'empty', text: 'No collections yet. Create one below.' }));
    return;
  }
  homeEls.collectionList.replaceChildren(...homeCollections.map((collection) => {
    const isSelected = selected?.id === collection.id;
    const item = CM.el('li', { className: isSelected ? 'selected' : '' }, [
      CM.el('div', { className: 'collection-info' }, [
        CM.el('strong', { text: collection.title }),
        CM.el('span', { className: 'muted', text: ` ${collection.currency} ` }),
        CM.el('span', { className: `role role-${collection.role}`, text: collection.role })
      ]),
      isSelected
        ? CM.el('span', { className: 'selected-label', text: 'Selected' })
        : CM.button('Select', () => selectCollection(collection))
    ]);
    return item;
  }));
}

function updateServices() {
  const selected = CM.selectedCollection.get();
  homeEls.servicesHint.textContent = selected
    ? `Open a service for "${selected.title}".`
    : 'Select a collection to open its services.';
  for (const tile of homeEls.tiles) {
    tile.classList.toggle('tile-disabled', !selected);
    if (selected) {
      tile.removeAttribute('aria-disabled');
      tile.removeAttribute('tabindex');
    } else {
      tile.setAttribute('aria-disabled', 'true');
      tile.setAttribute('tabindex', '-1');
    }
  }
}

async function selectCollection(collection) {
  CM.selectedCollection.set(collection);
  renderCollections();
  updateServices();
  CM.renderHeader('home');
  await loadMembers();
}

async function loadCollections() {
  const { collections } = await CM.request('/collections');
  homeCollections = collections;

  // Keep the stored selection only if the user still belongs to it, and
  // refresh its title/role in case they changed.
  const stored = CM.selectedCollection.get();
  const fresh = collections.find((c) => c.id === stored?.id);
  if (fresh) CM.selectedCollection.set(fresh);
  else CM.selectedCollection.set(collections.length === 1 ? collections[0] : null);

  homeEls.newCollectionBox.open = collections.length === 0;
  renderCollections();
  updateServices();
  CM.renderHeader('home');
}

handleSubmit(homeEls.collectionForm, async ({ title, currency }) => {
  const { collection } = await CM.request('/collections', {
    method: 'POST',
    body: { title: title.trim(), currency: currency.trim().toUpperCase() }
  });
  homeEls.collectionForm.reset();
  await loadCollections();
  // The creator is the owner of the new collection.
  await selectCollection({ ...collection, role: 'owner' });
  CM.notify(`Collection "${collection.title}" created.`);
});

// Signed in: members (owner only)
async function loadMembers() {
  const selected = CM.selectedCollection.get();
  const isOwner = selected?.role === 'owner';
  homeEls.membersCard.hidden = !isOwner;
  if (!isOwner) return;

  const { members } = await CM.request(`/collections/${encodeURIComponent(selected.id)}/members`);
  homeEls.memberList.replaceChildren(...members.map((member) => CM.el('li', {}, [
    CM.el('div', {}, [
      CM.el('strong', { text: member.name }),
      CM.el('span', { className: 'muted', text: ` ${member.email} ` }),
      CM.el('span', { className: `role role-${member.role}`, text: member.role })
    ]),
    member.role === 'viewer'
      ? CM.button('Remove', () => removeMember(member), 'btn btn-danger-ghost')
      : null
  ])));
}

async function removeMember(member) {
  if (!window.confirm(`Remove ${member.name}'s access to this collection?`)) return;
  const selected = CM.selectedCollection.get();
  try {
    await CM.busy(homeEls.membersCard, () => CM.request(
      `/collections/${encodeURIComponent(selected.id)}/members/${encodeURIComponent(member.user_id)}`,
      { method: 'DELETE' }));
    await loadMembers();
    CM.notify(`${member.name} can no longer view this collection.`);
  } catch (error) {
    CM.notify(error.message, true);
  }
}

handleSubmit(homeEls.memberForm, async ({ email }) => {
  const selected = CM.selectedCollection.get();
  await CM.request(`/collections/${encodeURIComponent(selected.id)}/members`, {
    method: 'POST',
    body: { email: email.trim() }
  });
  homeEls.memberForm.reset();
  await loadMembers();
  CM.notify(`${email.trim()} can now view this collection.`);
});

// Page start
async function showSignedIn() {
  const user = CM.session.user();
  homeEls.signedOut.hidden = true;
  homeEls.signedIn.hidden = false;
  homeEls.welcome.textContent = `Welcome, ${user?.name || 'collector'}`;
  await loadCollections();
  await loadMembers();
}

function showSignedOut() {
  homeEls.signedIn.hidden = true;
  homeEls.signedOut.hidden = false;
  CM.renderHeader('home');
}

async function startPage() {
  const message = CM.takeFlash();
  if (message) CM.notify(message.message, message.isError);
  if (!CM.session.get()) {
    showSignedOut();
    return;
  }
  try {
    await showSignedIn();
  } catch (error) {
    if (!CM.session.get()) showSignedOut();
    CM.notify(error.message, true);
  }
}

startPage();
