'use strict';

const byId = (id) => document.getElementById(id);
const ui = {
  collectionLine: byId('collection-line'),
  content: byId('valuation-content'),
  item: byId('valuation-item'),
  history: byId('valuation-history'),
  historyStatus: byId('history-status'),
  workspace: byId('valuation-workspace'),
  editor: byId('valuation-editor'),
  editorTitle: byId('editor-title'),
  form: byId('valuation-form'),
  save: byId('save-valuation'),
  cancel: byId('cancel-edit'),
  summary: byId('valuation-summary'),
  summaryStatus: byId('summary-status'),
  categoryTable: byId('category-table'),
  categoryRows: byId('category-rows'),
  categoryStatus: byId('categories-status')
};

const state = { collection: null, editing: null, historyRequest: 0, saving: false };
const isOwner = () => state.collection?.role === 'owner';
const historyPath = (itemId) => `/items/${encodeURIComponent(itemId)}/valuations`;
const valuationPath = (id) => `/valuations/${encodeURIComponent(id)}`;
// Neon may serialize a database DATE as an ISO timestamp at midnight UTC.
const calendarDate = (value) => value?.slice(0, 10) ?? '';

function resetEditor(valuation = null) {
  state.editing = valuation;
  ui.form.reset();
  if (valuation) {
    ui.form.elements.namedItem('amount').value = valuation.amount;
    ui.form.elements.namedItem('valuation_date').value = calendarDate(valuation.valuation_date);
    ui.form.elements.namedItem('note').value = valuation.note ?? '';
  }
  ui.editorTitle.textContent = valuation ? 'Edit valuation' : 'Add valuation';
  ui.save.textContent = valuation ? 'Save changes' : 'Add valuation';
  ui.cancel.hidden = !valuation;
}

function renderHistory(valuations) {
  ui.history.replaceChildren(...valuations.map((valuation, index) => {
    const heading = CM.el('div', { className: 'item-head' }, [
      CM.el('strong', { text: CM.money(valuation.amount, state.collection.currency) }),
      index === 0 ? CM.el('span', { className: 'badge', text: 'Latest' }) : null
    ]);
    const date = calendarDate(valuation.valuation_date);
    const card = CM.el('li', { className: 'item-card' }, [
      heading,
      CM.el('time', { className: 'muted', text: CM.formatDate(date), attrs: { datetime: date } }),
      CM.el('p', { className: 'valuation-note', text: valuation.note || 'No note' })
    ]);
    if (isOwner()) {
      card.append(CM.el('div', { className: 'item-actions' }, [
        CM.button('Edit', () => {
          resetEditor(valuation);
          ui.form.elements.namedItem('amount').focus();
        }),
        CM.button('Delete', () => {
          if (!window.confirm(`Delete the valuation dated ${date}?`)) return;
          saveChange(() => CM.request(valuationPath(valuation.id), { method: 'DELETE' }), 'Valuation deleted.');
        }, 'btn btn-danger-ghost')
      ]));
    }
    return card;
  }));
}

async function loadHistory() {
  const itemId = ui.item.value;
  const requestId = ++state.historyRequest;
  ui.history.replaceChildren();
  ui.editor.hidden = true;
  ui.workspace.classList.add('layout-single');
  ui.historyStatus.textContent = itemId ? 'Loading valuation history…' : 'Choose an item to view its valuation history.';
  if (!itemId) return;

  try {
    const { valuations } = await CM.request(historyPath(itemId));
    // Only the most recently selected item's response can update the page.
    if (requestId !== state.historyRequest) return;
    renderHistory(valuations);
    ui.historyStatus.textContent = valuations.length ? '' : 'This item has no valuations yet.';
    ui.editor.hidden = !isOwner();
    ui.workspace.classList.toggle('layout-single', !isOwner());
  } catch (error) {
    if (requestId === state.historyRequest) {
      ui.historyStatus.textContent = `Could not load valuation history. ${error.message}`;
    }
  }
}

async function loadItems() {
  const query = new URLSearchParams({ collection_id: state.collection.id, archived: 'all', sort: 'title' });
  try {
    const { items } = await CM.request(`/items?${query}`);
    ui.item.replaceChildren(
      CM.el('option', { text: items.length ? 'Choose an item' : 'No catalogue items', attrs: { value: '' } }),
      ...items.map((item) => CM.el('option', {
        text: `${item.title} · ${item.category}${item.is_archived ? ' (archived)' : ''}`,
        attrs: { value: item.id }
      }))
    );
    ui.item.disabled = !items.length;
    if (!items.length) ui.historyStatus.textContent = 'Add an item in Catalogue to start recording valuations.';
  } catch (error) {
    ui.item.options[0].textContent = 'Catalogue items unavailable';
    ui.historyStatus.textContent = `Could not load catalogue items. ${error.message}`;
  }
}

async function loadReport(path, content, status, render) {
  content.hidden = true;
  status.textContent = 'Loading report…';
  try {
    const query = new URLSearchParams({ collection_id: state.collection.id });
    status.textContent = render(await CM.request(`/reports/${path}?${query}`));
    content.hidden = Boolean(status.textContent);
  } catch (error) {
    status.textContent = `Could not load this report. ${error.message}`;
  }
}

function loadReports() {
  return Promise.all([
    loadReport('summary', ui.summary, ui.summaryStatus, ({ summary, currency }) => {
      byId('total-value').textContent = CM.money(summary.total_collection_value, currency);
      byId('total-items').textContent = summary.total_items;
      byId('valued-items').textContent = summary.valued_items_count;
      byId('unvalued-items').textContent = summary.unvalued_items_count;
      return '';
    }),
    loadReport('categories', ui.categoryTable, ui.categoryStatus, ({ category_breakdown, currency }) => {
      ui.categoryRows.replaceChildren(...category_breakdown.map((row) => CM.el('tr', {}, [
        CM.el('th', { text: row.category, attrs: { scope: 'row' } }),
        CM.el('td', { text: row.item_count }),
        CM.el('td', { text: row.valued_items_count }),
        CM.el('td', { text: row.unvalued_items_count }),
        CM.el('td', { text: CM.money(row.category_total_value, currency) }),
        CM.el('td', { text: CM.formatDate(calendarDate(row.latest_valuation_date)) })
      ])));
      return category_breakdown.length ? '' : 'There are no active items to report by category.';
    })
  ]);
}

async function saveChange(request, message) {
  if (state.saving || !isOwner() || !ui.item.value) return;
  state.saving = true;
  ui.item.disabled = true;
  try {
    await CM.busy(ui.workspace, async () => {
      await request();
      resetEditor();
      CM.notify(message);
      await Promise.all([loadHistory(), loadReports()]);
    });
  } catch (error) {
    CM.notify(error.message, true);
  } finally {
    ui.item.disabled = false;
    state.saving = false;
  }
}

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(ui.form));
  input.note = input.note || null;
  const valuation = state.editing;
  if (valuation) {
    const original = {
      amount: valuation.amount,
      valuation_date: calendarDate(valuation.valuation_date),
      note: valuation.note || null
    };
    // Compare numeric values so a difference in decimal formatting does not produce a change.
    const body = Object.fromEntries(Object.entries(input).filter(([key, value]) =>
      key === 'amount' ? Number(value) !== Number(original.amount) : value !== original[key]));
    if (!Object.keys(body).length) {
      CM.notify('There are no changes to save.');
      return;
    }
    saveChange(() => CM.request(valuationPath(valuation.id), { method: 'PATCH', body }), 'Valuation updated.');
  } else {
    saveChange(() => CM.request(historyPath(ui.item.value), { method: 'POST', body: input }), 'Valuation added.');
  }
});

ui.cancel.addEventListener('click', () => resetEditor());
ui.item.addEventListener('change', () => {
  resetEditor();
  CM.notify('');
  loadHistory();
});

(async () => {
  if (!CM.requireLogin()) return;
  CM.renderHeader('valuation');
  try {
    const { collections } = await CM.request('/collections');
    const selected = CM.selectedCollection.get();
    state.collection = collections.find((collection) => collection.id === selected?.id)
      || (collections.length === 1 ? collections[0] : null);
    CM.selectedCollection.set(state.collection);
    CM.renderHeader('valuation');
    if (!state.collection) {
      ui.collectionLine.textContent = '';
      byId('no-collection').hidden = false;
      return;
    }
    ui.collectionLine.textContent = `${state.collection.title} | ${isOwner() ? 'Owner' : 'View only'}`;
    byId('amount-currency').textContent = state.collection.currency;
    ui.content.hidden = false;
    await Promise.all([loadItems(), loadReports()]);
  } catch (error) {
    ui.collectionLine.textContent = '';
    CM.notify(`Could not load collections. ${error.message}`, true);
  }
})();
