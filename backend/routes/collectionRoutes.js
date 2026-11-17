const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/collectionController');
const authMiddleware = require('../middleware/auth');

// All collection routes require authentication
router.use(authMiddleware);

// POST /api/collections
router.post('/', collectionController.create);

// GET /api/collections/:id/members
router.get('/:id/members', collectionController.getMembers);

// POST /api/collections/:id/members
router.post('/:id/members', collectionController.addMember);

// DELETE /api/collections/:id/members/:userId
router.delete('/:id/members/:userId', collectionController.removeMember);

module.exports = router;