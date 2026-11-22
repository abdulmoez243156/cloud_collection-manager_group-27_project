const express = require('express');
const authenticate = require('../middleware/auth');
const wishlist = require('../controllers/wishlistController');

const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.get('/', wishlist.list);
router.get('/budget-plan', wishlist.plan);
router.post('/', wishlist.create);
router.patch('/:id', wishlist.update);
router.delete('/:id', wishlist.remove);

module.exports = router;
