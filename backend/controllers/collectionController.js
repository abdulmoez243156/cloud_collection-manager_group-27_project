const collectionService = require('../services/collectionService');

async function list(req, res, next) {
  try {
    const collections = await collectionService.listCollections(req.user.userId);
    res.status(200).json({ collections });
  } catch (error) {
    next(error);
  }
}

// Accept canonical UUIDs and positive PostgreSQL bigint IDs without number conversion.
function isValidId(value) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    || (/^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
}

function validationError(res, message) {
  return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
}

// POST /api/collections
async function create(req, res, next) {
  try {
    const { title, currency = 'EGP' } = req.body ?? {};
    const userId = req.user.userId; // Extracted from authMiddleware

    if (typeof title !== 'string' || !title.trim()) {
      return validationError(res, 'Collection title is required.');
    }

    if (typeof currency !== 'string' || !/^[a-z]{3}$/i.test(currency.trim())) {
      return validationError(res, 'Currency must be a three-letter code.');
    }

    const newCollection = await collectionService.createCollection(
      userId, title.trim(), currency.trim().toUpperCase()
    );

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

    if (!isValidId(collectionId)) {
      return validationError(res, 'Invalid collection ID.');
    }

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
    const { email } = req.body ?? {};

    if (!isValidId(collectionId)) {
      return validationError(res, 'Invalid collection ID.');
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      return validationError(res, 'A valid user email is required.');
    }

    // Verify if user is owner
    const role = await collectionService.getUserRole(collectionId, userId);
    if (role !== 'owner') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the collection owner can add members.' }
      });
    }

    // Emails are stored in lower case (see authController.register).
    const newMember = await collectionService.addMemberByEmail(collectionId, email.trim().toLowerCase(), 'viewer');

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
    // The user is already a member: the primary key (collection, user) blocks a second row.
    if (error.code === '23505') {
      return res.status(409).json({
        error: { code: 'ALREADY_MEMBER', message: 'This user already has access to the collection.' }
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

    if (!isValidId(collectionId) || !isValidId(targetUserId)) {
      return validationError(res, 'Invalid collection or user ID.');
    }

    // The service applies both role checks as part of the delete statement.
    const { authorized, removed } = await collectionService.removeMember(
      collectionId, targetUserId, currentUserId
    );
    if (!authorized) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the collection owner can remove members.' }
      });
    }

    if (!removed) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Viewer not found in this collection.' }
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  create,
  getMembers,
  addMember,
  removeMember
};
