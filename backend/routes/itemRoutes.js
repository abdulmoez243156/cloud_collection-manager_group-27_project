const express = require('express');
const authMiddleware = require('../middleware/auth');
const itemController = require('../controllers/itemController');
const verifyTurnstile = require('../middleware/turnstile');

const router = express.Router();

// Every Catalogue route needs a logged-in user.
router.use(authMiddleware);

// Fixed paths come before '/:id' so "categories" is never read as an item id.
router.get('/', itemController.listItems);                    // F2 list, search, filter
router.get('/categories', itemController.listCategories);     // F2 filter options
router.get('/duplicates', itemController.checkDuplicates);    // F3 duplicate check
router.get('/:id', itemController.getItem);                   // F2 item details
// External API: Cloudflare Turnstile checks the bot-check token before an item
// is created. Express runs the functions in order: login check (router.use
// above), then verifyTurnstile, then createItem only if the check passed.
router.post('/', verifyTurnstile, itemController.createItem); // F1 + F3 create
router.patch('/:id', itemController.updateItem);              // F1 edit / archive / restore

module.exports = router;
