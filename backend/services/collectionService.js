const sql = require('../db/db');

// Only return collections the authenticated user belongs to.
async function listCollections(userId) {
  return await sql`
    SELECT c.id, c.title, c.currency, cm.role
    FROM collection_members cm
    JOIN collections c ON c.id = cm.collection_id
    WHERE cm.user_id = ${userId}
    ORDER BY c.id
  `;
}

// Create a new collection and assign the creator as 'owner'
async function createCollection(userId, title, currency = 'EGP') {
  // Execute both inserts atomically in one Neon HTTP query.
  const [collection] = await sql`
    WITH new_collection AS (
      INSERT INTO collections (title, currency)
      VALUES (${title}, ${currency})
      RETURNING id, title, currency
    ), new_owner AS (
      INSERT INTO collection_members (collection_id, user_id, role)
      SELECT id, ${userId}, 'owner' FROM new_collection
      RETURNING collection_id
    )
    SELECT c.id, c.title, c.currency
    FROM new_collection c
    JOIN new_owner o ON o.collection_id = c.id
  `;
  return collection;
}

// Get the user's role in a specific collection
async function getUserRole(collectionId, userId) {
  const result = await sql`
    SELECT role FROM collection_members 
    WHERE collection_id = ${collectionId} AND user_id = ${userId};
  `;
  return result[0] ? result[0].role : null;
}

// Get all members of a collection
async function getCollectionMembers(collectionId) {
  return await sql`
    SELECT cm.user_id, u.name, u.email, cm.role 
    FROM collection_members cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.collection_id = ${collectionId};
  `;
}

// Add a member by their email as 'viewer'
async function addMemberByEmail(collectionId, email, role = 'viewer') {
  const [user] = await sql`
    SELECT id FROM users WHERE email = ${email};
  `;
  
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const [member] = await sql`
    INSERT INTO collection_members (collection_id, user_id, role)
    VALUES (${collectionId}, ${user.id}, ${role})
    RETURNING collection_id, user_id, role;
  `;

  return member;
}

async function removeMember(collectionId, targetUserId, requesterId) {
  // Authorize the request and restrict deletion to viewers in the same statement.
  const [result] = await sql`
    WITH requester AS (
      SELECT 1 FROM collection_members
      WHERE collection_id = ${collectionId}
        AND user_id = ${requesterId}
        AND role = 'owner'
    ), removed AS (
      DELETE FROM collection_members
      WHERE collection_id = ${collectionId}
        AND user_id = ${targetUserId}
        AND role = 'viewer'
        AND EXISTS (SELECT 1 FROM requester)
      RETURNING user_id
    )
    SELECT EXISTS (SELECT 1 FROM requester) AS authorized,
           EXISTS (SELECT 1 FROM removed) AS removed
  `;
  return result;
}

module.exports = {
  listCollections,
  createCollection,
  getUserRole,
  getCollectionMembers,
  addMemberByEmail,
  removeMember
};
