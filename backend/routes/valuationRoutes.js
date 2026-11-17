const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const ValuationController = require('../controllers/valuationController');

// 1. Record a new valuation & View history for a specific item
router.post('/items/:itemId/valuations', authMiddleware, ValuationController.addValuation);
router.get('/items/:itemId/valuations', authMiddleware, ValuationController.getItemValuations);

// 2. Correct (update) or Delete a valuation entry
router.put('/valuations/:id', authMiddleware, ValuationController.updateValuation);
router.delete('/valuations/:id', authMiddleware, ValuationController.deleteValuation);

// 3. Collection valuation report (totals, unvalued counts, category breakdown)
router.get('/collections/:collectionId/report', authMiddleware, ValuationController.getCollectionReport);

module.exports = router;