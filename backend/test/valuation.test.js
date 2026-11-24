const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mock, test, before, after } = require('node:test');
const jwt = require('jsonwebtoken');

// Exercise the real app with a deterministic replacement for the Neon query boundary.
const dbPath = require.resolve('../db/db');
const query = mock.fn();
require.cache[dbPath] = { exports: { query } };
process.env.JWT_SECRET = 'valuation-test-secret';
process.env.RATE_LIMIT_MAX = '300';
const app = require('../server');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [owner, viewer, outsider, collection, item, valuation, missing] = [1, 2, 3, 4, 5, 6, 7].map(id);
const token = (userId, expiresIn = 60) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn });
const historyPath = `/api/items/${item}/valuations`;
const valuationPath = `/api/valuations/${valuation}`;
const combinedPath = `/api/collections/${collection}/report`;
const summaryPath = `/api/reports/summary?collection_id=${collection}`;
const categoriesPath = `/api/reports/categories?collection_id=${collection}`;
const estimate = { amount: 100, valuation_date: '2024-02-29', note: 'Estimate' };
const row = { ...estimate, amount: '100.00', id: valuation, item_id: item };
let server;

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
});
after(() => server?.close());

async function request(method, path, { auth = token(owner), body, raw } = {}) {
    const headers = {};
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers, body: raw ?? JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}

function expectError(response, status, code) {
    assert.equal(response.status, status);
    assert.equal(response.body.error.code, code);
    assert.equal(typeof response.body.error.message, 'string');
    assert.deepEqual(Object.keys(response.body), ['error']);
}

const routes = [
    ['POST', historyPath], ['GET', historyPath], ['PATCH', valuationPath],
    ['PUT', valuationPath], ['DELETE', valuationPath], ['GET', combinedPath],
    ['GET', summaryPath], ['GET', categoriesPath]
];

test('all routes reject missing and expired authentication before querying', async () => {
    query.mock.resetCalls();
    for (const [method, path] of routes) {
        expectError(await request(method, path, { auth: null }), 401, 'UNAUTHORIZED');
        expectError(await request(method, path, { auth: token(owner, -1) }), 401, 'INVALID_TOKEN');
    }
    expectError(await request('GET', summaryPath, { auth: token('invalid') }), 401, 'INVALID_TOKEN');
    assert.equal(query.mock.callCount(), 0);
});

test('create and update reject invalid fields without querying', async () => {
    query.mock.resetCalls();
    for (const amount of [null, '', '  ', -1, 'text', 'NaN', 'Infinity', '0x10', true, [], {}, 1e20, 9999999999.995]) {
        expectError(await request('POST', historyPath, { body: { ...estimate, amount } }), 400, 'VALIDATION_ERROR');
        expectError(await request('PATCH', valuationPath, { body: { amount } }), 400, 'VALIDATION_ERROR');
    }
    for (const valuation_date of [null, '', '2023-02-29', '2024-04-31', '0000-01-01', '2024-2-01', '2024-02-29T00:00:00Z']) {
        expectError(await request('POST', historyPath, { body: { ...estimate, valuation_date } }), 400, 'VALIDATION_ERROR');
        expectError(await request('PATCH', valuationPath, { body: { valuation_date } }), 400, 'VALIDATION_ERROR');
    }
    for (const body of [{}, [], { amount: 1 }, { valuation_date: estimate.valuation_date }]) {
        expectError(await request('POST', historyPath, { body }), 400, 'VALIDATION_ERROR');
    }
    expectError(await request('PATCH', valuationPath, { body: {} }), 400, 'VALIDATION_ERROR');
    expectError(await request('PUT', valuationPath, { body: { note: 'a'.repeat(501) } }), 400, 'VALIDATION_ERROR');
    expectError(await request('PATCH', valuationPath, { body: { note: 'bad\0note' } }), 400, 'VALIDATION_ERROR');
    expectError(await request('POST', historyPath, { raw: '{"amount":1e309,"valuation_date":"2024-02-29"}' }), 400, 'VALIDATION_ERROR');
    expectError(await request('POST', historyPath, { raw: '{"amount":NaN}' }), 400, 'VALIDATION_ERROR');
    assert.equal(query.mock.callCount(), 0);
});

test('all routes validate UUIDs before querying', async () => {
    query.mock.resetCalls();
    for (const [method, path] of routes) {
        const invalidPath = path.replace(/00000000-0000-4000-8000-\d{12}/, 'invalid');
        expectError(await request(method, invalidPath, { body: method === 'GET' ? undefined : estimate }), 400, 'VALIDATION_ERROR');
    }
    expectError(await request('GET', '/api/reports/summary'), 400, 'VALIDATION_ERROR');
    expectError(await request('GET', `${categoriesPath}&collection_id=${missing}`), 400, 'VALIDATION_ERROR');
    assert.equal(query.mock.callCount(), 0);
});

test('owner can create, correct with PATCH or PUT, and delete', async () => {
    query.mock.mockImplementation(async (statement, values) => {
        assert.match(statement, /cm\.role = 'owner'/);
        if (statement.includes('INSERT INTO valuations')) {
            assert.deepEqual(values, [item, 100, estimate.valuation_date, estimate.note, owner]);
        } else if (statement.includes('UPDATE valuations')) {
            const noteOnly = values[2];
            assert.deepEqual(values, noteOnly
                ? [null, null, true, null, valuation, owner]
                : [0, null, false, null, valuation, owner]);
            return [{ ...row, ...(noteOnly ? { note: null } : { amount: '0.00' }) }];
        } else {
            assert.match(statement, /DELETE FROM valuations/);
            assert.deepEqual(values, [valuation, owner]);
        }
        return [row];
    });

    const create = await request('POST', historyPath, { body: { ...estimate, amount: '100' } });
    assert.equal(create.status, 201);
    assert.deepEqual(create.body.valuation, row);
    const patch = await request('PATCH', valuationPath, { body: { note: null } });
    assert.equal(patch.status, 200);
    assert.deepEqual(patch.body.valuation, { ...row, note: null });
    const put = await request('PUT', valuationPath, { body: { amount: 0 } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.valuation, { ...row, amount: '0.00' });
    const removal = await request('DELETE', valuationPath);
    assert.equal(removal.status, 200);
    assert.deepEqual(removal.body.valuation, row);
});

test('history distinguishes accessible empty items from missing and private items', async () => {
    const olderRow = { ...row, id: id(8), amount: '75.00' };
    query.mock.mockImplementation(async (statement, [itemId, userId]) => {
        assert.match(statement, /JOIN collection_members/);
        assert.match(statement, /ORDER BY v\.valuation_date DESC, v\.recorded_timestamp DESC/);
        if (itemId === missing || userId === outsider) return [];
        if (itemId === id(9)) return [{ id: null }];
        return [row, olderRow];
    });
    for (const user of [owner, viewer]) {
        const result = await request('GET', historyPath, { auth: token(user) });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.valuations, [row, olderRow]);
    }
    assert.deepEqual(await request('GET', historyPath.replace(item, id(9))), { status: 200, body: { valuations: [] } });
    expectError(await request('GET', historyPath, { auth: token(outsider) }), 404, 'ITEM_NOT_FOUND');
    expectError(await request('GET', historyPath.replace(item, missing)), 404, 'ITEM_NOT_FOUND');
});

test('viewer writes, cross-collection writes, and missing targets return no data', async () => {
    query.mock.mockImplementation(async (statement, values) => {
        assert.match(statement, /cm\.role = 'owner'/);
        assert.match(statement, /cm\.collection_id = i\.collection_id/);
        assert.ok(values.includes(missing) || [viewer, outsider].includes(values.at(-1)));
        return [];
    });
    for (const [method, path] of routes.filter(([method]) => method !== 'GET')) {
        const code = method === 'POST' ? 'ITEM_NOT_FOUND' : 'VALUATION_NOT_FOUND';
        const body = method === 'DELETE' ? undefined : estimate;
        for (const user of [viewer, outsider]) {
            expectError(await request(method, path, { auth: token(user), body }), 404, code);
        }
        expectError(await request(method, path.replace(method === 'POST' ? item : valuation, missing), { body }), 404, code);
    }
});

test('reports format the 350 EGP example, category counts, and empty collections', async () => {
    const latest = estimate.valuation_date;
    const totals = (total_value, item_count, valued_items_count, unvalued_items_count, latest_valuation_date) =>
        ({ total_value, item_count, valued_items_count, unvalued_items_count, latest_valuation_date });
    query.mock.mockImplementation(async (statement, [collectionId, userId]) => {
        assert.match(statement, /WHERE c\.id = \$1 AND cm\.user_id = \$2/);
        assert.match(statement, /WHERE i\.is_archived = FALSE/);
        assert.match(statement, /DISTINCT ON \(v\.item_id\)/);
        assert.match(statement, /ORDER BY v\.item_id, v\.valuation_date DESC, v\.recorded_timestamp DESC/);
        assert.doesNotMatch(statement, /wishlist_entries|target_budget|NUMERIC\(12, 2\)/i);
        if (userId === outsider || collectionId === missing) return [];
        if (collectionId === id(10)) return [{ currency: 'EGP', ...totals('0.00', 0, 0, 0, null) }];
        return [
            { currency: 'EGP', ...totals('350.00', 3, 2, 1, latest) },
            { category: 'Coins', ...totals('250.00', 1, 1, 0, latest) },
            { category: 'Stamps', ...totals('100.00', 2, 1, 1, latest) }
        ];
    });

    const combined = await request('GET', combinedPath);
    assert.equal(combined.status, 200);
    const { summary, category_breakdown } = combined.body;
    assert.equal(combined.body.currency, 'EGP');
    assert.deepEqual(summary, {
        total_collection_value: '350.00', total_items: 3,
        valued_items_count: 2, unvalued_items_count: 1, latest_valuation_date: latest
    });
    assert.deepEqual(category_breakdown, [
        { category: 'Coins', item_count: 1, valued_items_count: 1, unvalued_items_count: 0, category_total_value: '250.00', latest_valuation_date: latest },
        { category: 'Stamps', item_count: 2, valued_items_count: 1, unvalued_items_count: 1, category_total_value: '100.00', latest_valuation_date: latest }
    ]);
    for (const [path, section] of [[summaryPath, { summary }], [categoriesPath, { category_breakdown }]]) {
        assert.deepEqual(await request('GET', path, { auth: token(viewer) }),
            { status: 200, body: { collection_id: collection, currency: 'EGP', ...section } });
    }
    assert.equal((await request('GET', combinedPath, { auth: token(viewer) })).status, 200);
    for (const path of [summaryPath, categoriesPath, combinedPath]) {
        expectError(await request('GET', path, { auth: token(outsider) }), 404, 'COLLECTION_NOT_FOUND');
        expectError(await request('GET', path.replace(collection, missing)), 404, 'COLLECTION_NOT_FOUND');
    }

    const empty = await request('GET', combinedPath.replace(collection, id(10)));
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.category_breakdown, []);
    assert.deepEqual(empty.body.summary, {
        total_collection_value: '0.00', total_items: 0, valued_items_count: 0,
        unvalued_items_count: 0, latest_valuation_date: null
    });
});
