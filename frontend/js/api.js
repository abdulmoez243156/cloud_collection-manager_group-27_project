// Shared frontend code used by every page: the login session, the selected
// collection, one request helper for all API calls, and small UI helpers.
//
// Everything lives inside one object, CM, so these names can never clash with
// variables declared by other pages' scripts (all classic scripts share one
// global scope in the browser).
'use strict';

const CM = (() => {
  const SESSION_KEY = 'cm.session';        // { token, user }
  const COLLECTION_KEY = 'cm.collection';  // { id, title, currency, role }
  const FLASH_KEY = 'cm.flash';            // one-time message for the next page

  // Pages shown in the navigation bar.
  const NAV_LINKS = [
    { page: 'home', href: 'index.html', label: 'Home' },
    { page: 'catalogue', href: 'catalogue.html', label: 'Catalogue' },
    { page: 'wishlist', href: 'wishlist.html', label: 'Wishlist' },
    { page: 'valuation', href: 'valuation.html', label: 'Valuation & Reports' }
  ];

  // -------------------------------------------------------------------------
  // Browser storage (wrapped in try/catch: storage can be disabled or full)
  // -------------------------------------------------------------------------
  function read(key, storage = localStorage) {
    try {
      return JSON.parse(storage.getItem(key));
    } catch {
      return null;
    }
  }

  function write(key, value, storage = localStorage) {
    try {
      if (value === null || value === undefined) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore: the app still works for this page view.
    }
  }

  // A JWT is three base64url parts; the middle one holds "exp" (expiry time).
  // Reading it lets the page sign out an expired session before calling the API.
  // This is only a convenience: the backend still verifies every token.
  function tokenExpired(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(part));
      return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
    } catch {
      return true;
    }
  }

  const session = {
    get() {
      const saved = read(SESSION_KEY);
      if (!saved || typeof saved.token !== 'string' || tokenExpired(saved.token)) {
        if (saved) write(SESSION_KEY, null);
        return null;
      }
      return saved;
    },
    token() {
      return session.get()?.token ?? null;
    },
    user() {
      return session.get()?.user ?? null;
    },
    save(token, user) {
      write(SESSION_KEY, { token, user });
    },
    clear() {
      write(SESSION_KEY, null);
      write(COLLECTION_KEY, null);
    }
  };

  const selectedCollection = {
    get() {
      return read(COLLECTION_KEY);
    },
    set(collection) {
      write(COLLECTION_KEY, collection
        ? { id: collection.id, title: collection.title, currency: collection.currency, role: collection.role }
        : null);
    }
  };

  function flash(message, isError = false) {
    write(FLASH_KEY, { message, isError }, sessionStorage);
  }

  function takeFlash() {
    const value = read(FLASH_KEY, sessionStorage);
    write(FLASH_KEY, null, sessionStorage);
    return value;
  }

  function onHomePage() {
    const file = window.location.pathname.split('/').pop();
    return file === '' || file === 'index.html' || file === 'index';
  }

  function goHome(message, isError = false) {
    if (message) flash(message, isError);
    if (!onHomePage()) window.location.href = 'index.html';
  }

  // Pages other than Home call this first.
  function requireLogin() {
    if (session.get()) return true;
    goHome('Please sign in first.', true);
    return false;
  }

  // -------------------------------------------------------------------------
  // One helper for every API call (based on the Lab 5 apiRequest helper)
  // -------------------------------------------------------------------------
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message || `Request failed (${status}).`);
      this.status = status;
      this.code = body?.error?.code;
      this.body = body;
    }
  }

  async function request(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
    const sendHeaders = { ...headers };
    if (body !== undefined) sendHeaders['Content-Type'] = 'application/json';
    const token = session.token();
    if (auth && token) sendHeaders.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: sendHeaders,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      // fetch() only throws when no response arrives at all.
      throw new ApiError(0, {
        error: { code: 'NETWORK_ERROR', message: 'Cannot reach the API. Check your connection and try again.' }
      });
    }

    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      // A missing, expired or invalid token: end the session and go to Home.
      if (auth && (response.status === 401 || data?.error?.code === 'INVALID_TOKEN')) {
        session.clear();
        goHome('Your session has ended. Please sign in again.', true);
      }
      throw new ApiError(response.status, data);
    }
    return data;
  }

  // -------------------------------------------------------------------------
  // UI helpers. Text is always set with textContent, never innerHTML, so data
  // from the database is shown as plain text and cannot inject HTML or scripts.
  // -------------------------------------------------------------------------
  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined && options.text !== null) node.textContent = options.text;
    for (const [name, value] of Object.entries(options.attrs || {})) {
      if (value !== undefined && value !== null && value !== false) node.setAttribute(name, value);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  function button(label, onClick, className = 'btn btn-secondary') {
    const node = el('button', { className, text: label, attrs: { type: 'button' } });
    node.addEventListener('click', onClick);
    return node;
  }

  // Shows a status message in a page's notice box.
  let noticeTimer;
  function notify(message, isError = false) {
    const box = document.getElementById('notice');
    if (!box) return;
    clearTimeout(noticeTimer);
    box.textContent = message || '';
    box.classList.toggle('notice-error', isError);
    box.hidden = !message;
    if (message && !isError) noticeTimer = setTimeout(() => { box.hidden = true; }, 5000);
  }

  function money(amount, currency) {
    if (amount === null || amount === undefined) return '-';
    const formatted = Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return currency ? `${formatted} ${currency}` : formatted;
  }

  function formatDate(value) {
    if (!value) return '-';
    // 'YYYY-MM-DD' dates are shown as they are stored, with no timezone shift.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  // Disables every button in a container while a request runs, so a double
  // click cannot send the same request twice.
  async function busy(container, task) {
    const buttons = [...container.querySelectorAll('button:not(:disabled)')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      return await task();
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // The bar at the top of every page: brand, navigation, collection, user.
  function renderHeader(activePage) {
    const header = document.getElementById('app-header');
    if (!header) return;
    const user = session.user();
    const collection = selectedCollection.get();

    const brand = el('a', { className: 'brand', attrs: { href: 'index.html' } }, [
      el('span', { className: 'brand-mark', text: 'CM', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: 'Collection Manager' })
    ]);

    const parts = [brand];
    if (user) {
      const nav = el('nav', { className: 'nav', attrs: { 'aria-label': 'Main' } },
        NAV_LINKS.map((link) => el('a', {
          text: link.label,
          className: link.page === activePage ? 'active' : '',
          attrs: { href: link.href, 'aria-current': link.page === activePage ? 'page' : null }
        })));

      const signOut = button('Sign out', () => {
        session.clear();
        flash('You have signed out.');
        window.location.href = 'index.html';
      }, 'btn btn-ghost');

      const who = el('div', { className: 'header-user' }, [
        collection
          ? el('span', { className: 'chip', attrs: { title: 'Selected collection' } }, [
            el('span', { text: collection.title }),
            el('span', { className: `role role-${collection.role}`, text: collection.role })
          ])
          : null,
        el('span', { className: 'user-name', text: user.name || user.email }),
        signOut
      ]);
      parts.push(nav, who);
    }
    header.replaceChildren(el('div', { className: 'header-inner' }, parts));
  }

  return {
    session,
    selectedCollection,
    request,
    ApiError,
    requireLogin,
    flash,
    takeFlash,
    el,
    button,
    notify,
    money,
    formatDate,
    debounce,
    busy,
    renderHeader
  };
})();
