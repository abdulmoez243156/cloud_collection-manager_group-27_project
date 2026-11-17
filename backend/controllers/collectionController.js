const collectionService = require('../services/collectionService');

// POST /api/collections
async function create(req, res, next) {
  try {
    const { title, currency } = req.body;
    const userId = req.user.userId; // Extracted from authMiddleware

    if (!title) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Collection title is required.' }
      });
    }

    const newCollection = await collectionService.createCollection(userId, title, currency || 'EGP');

    res.status(201).json({
      message: 'Collection created successfully',
      collection: newCollection
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/collections/:id/members
async function getMembers(req, res, next) {
  try {
    const collectionId = req.params.id;
    const userId = req.user.userId;

    // Verify if user is owner
    const role = await collectionService.getUserRole(collectionId, userId);
    if (role !== 'owner') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the collection owner can view members.' }
      });
    }

    const members = await collectionService.getCollectionMembers(collectionId);

    res.status(200).json({
      members
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/collections/:id/members
async function addMember(req, res, next) {
  try {
    const collectionId = req.params.id;
    const userId = req.user.userId;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'User email is required.' }
      });
    }

    // Verify if user is owner
    const role = await collectionService.getUserRole(collectionId, userId);
    if (role !== 'owner') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the collection owner can add members.' }
      });
    }

    const newMember = await collectionService.addMemberByEmail(collectionId, email, 'viewer');

    res.status(201).json({
      message: 'Member added successfully',
      member: newMember
    });
  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User with this email does not exist.' }
      });
    }
    next(error);
  }
}

// DELETE /api/collections/:id/members/:userId
async function removeMember(req, res, next) {
  try {
    const collectionId = req.params.id;
    const targetUserId = req.params.userId;
    const currentUserId = req.user.userId;

    // Verify if current user is owner
    const role = await collectionService.getUserRole(collectionId, currentUserId);
    if (role !== 'owner') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the collection owner can remove members.' }
      });
    }

    const removed = await collectionService.removeMember(collectionId, targetUserId);
    if (!removed) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Member not found in this collection.' }
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  create,
  getMembers,
  addMember,
  removeMember
};