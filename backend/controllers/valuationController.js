const ValuationService = require('../services/valuationService');

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function fail(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}

function requireId(value, field) {
    if (typeof value !== 'string' || !uuid.test(value)) {
        throw new ValidationError(`A valid ${field} is required.`);
    }
}

class ValidationError extends Error {}

function validateFields(body, creating) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('A JSON object is required.');
    }

    const fields = {};
    if (creating || Object.hasOwn(body, 'amount')) {
        const input = typeof body.amount === 'string' ? body.amount.trim() : body.amount;
        const amount = typeof input === 'string' && decimal.test(input) ? Number(input) : input;
        if (!Number.isFinite(amount) || amount < 0) {
            throw new ValidationError('Amount must be a finite non-negative number.');
        }
        // NUMERIC(12, 2) rounds to cents before checking its precision.
        if (amount >= 9999999999.995) {
            throw new ValidationError('Amount exceeds the maximum of 9999999999.99 after rounding.');
        }
        fields.amount = amount;
    }

    if (creating || Object.hasOwn(body, 'valuation_date')) {
        const date = body.valuation_date;
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            date.startsWith('0000-') || !Number.isFinite(Date.parse(date)) ||
            new Date(date).toISOString().slice(0, 10) !== date) {
            throw new ValidationError('valuation_date must be a real calendar date in YYYY-MM-DD format.');
        }
        fields.valuation_date = date;
    }

    if (Object.hasOwn(body, 'note')) {
        const note = body.note;
        if (note !== null && (typeof note !== 'string' || note.includes('\0') ||
            /[\uD800-\uDFFF]/u.test(note) || [...note].length > 500)) {
            throw new ValidationError('Note must be null or valid text of at most 500 characters.');
        }
        fields.note = note;
    }

    return fields;
}

function handleRequest(handler) {
    return async (req, res, next) => {
        if (typeof req.user?.userId !== 'string' || !uuid.test(req.user.userId)) {
            return fail(res, 401, 'INVALID_TOKEN', 'Token is expired or invalid. Please sign in again.');
        }

        try {
            return await handler(req, res);
        } catch (error) {
            if (error instanceof ValidationError) {
                return fail(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return next(error);
        }
    };
}

const addValuation = handleRequest(async (req, res) => {
    const { itemId } = req.params;
    requireId(itemId, 'item ID');
    const { amount, valuation_date, note } = validateFields(req.body, true);
    let valuation;
    try {
        valuation = await ValuationService.addValuation(itemId, amount, valuation_date, note, req.user.userId);
    } catch (error) {
        // A concurrent collection deletion can remove the item during insertion.
        if (error.code !== '23503') throw error;
    }
    if (!valuation) {
        return fail(res, 404, 'ITEM_NOT_FOUND', 'Writable item not found.');
    }
    return res.status(201).json({ message: 'Valuation recorded successfully', valuation });
});

const getItemValuations = handleRequest(async (req, res) => {
    const { itemId } = req.params;
    requireId(itemId, 'item ID');
    const valuations = await ValuationService.getItemValuations(itemId, req.user.userId);
    if (!valuations) {
        return fail(res, 404, 'ITEM_NOT_FOUND', 'Item not found.');
    }
    return res.status(200).json({ valuations });
});

const updateValuation = handleRequest(async (req, res) => {
    const { id } = req.params;
    requireId(id, 'valuation ID');
    const fields = validateFields(req.body, false);
    if (!Object.keys(fields).length) {
        throw new ValidationError('Provide at least one of amount, valuation_date, or note.');
    }
    const valuation = await ValuationService.updateValuation(id, fields, req.user.userId);
    if (!valuation) {
        return fail(res, 404, 'VALUATION_NOT_FOUND', 'Valuation entry not found.');
    }
    return res.status(200).json({ message: 'Valuation updated successfully', valuation });
});

const deleteValuation = handleRequest(async (req, res) => {
    const { id } = req.params;
    requireId(id, 'valuation ID');
    const valuation = await ValuationService.deleteValuation(id, req.user.userId);
    if (!valuation) {
        return fail(res, 404, 'VALUATION_NOT_FOUND', 'Valuation entry not found.');
    }
    return res.status(200).json({ message: 'Valuation deleted successfully', valuation });
});

function collectionReport(section) {
    return handleRequest(async (req, res) => {
        const collectionId = req.params.collectionId ?? req.query.collection_id;
        requireId(collectionId, 'collection_id');
        const report = await ValuationService.getCollectionReport(collectionId, req.user.userId);
        if (!report) {
            return fail(res, 404, 'COLLECTION_NOT_FOUND', 'Collection not found.');
        }

        const response = { collection_id: collectionId, currency: report.currency };
        if (section !== 'categories') response.summary = report.summary;
        if (section !== 'summary') response.category_breakdown = report.category_breakdown;
        return res.status(200).json(response);
    });
}

module.exports = {
    addValuation,
    getItemValuations,
    updateValuation,
    deleteValuation,
    getCollectionReport: collectionReport(),
    getSummaryReport: collectionReport('summary'),
    getCategoriesReport: collectionReport('categories')
};
