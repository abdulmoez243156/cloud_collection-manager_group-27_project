const sql = require('../db/db');

// Create a new collection and assign the creator as 'owner'
async function createCollection(userId, title, currency = 'EGP') {
  const result = await sql.begin(async (sql) => {
    const [collection] = await sql`
      INSERT INTO collections (title, currency)
      VALUES (${title}, ${currency})
      RETURNING id, title, currency;
    `;

    await sql`
      INSERT INTO collection_members (collection_id, user_id, role)
      VALUES (${collection.id}, ${userId}, 'owner');
    `;

    return collection;
  });

  return result;
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

// Remove a member from the collection
async function removeMember(collectionId, targetUserId) {
  const result = await sql`
    DELETE FROM collection_members 
    WHERE collection_id = ${collectionId} AND user_id = ${targetUserId}
    RETURNING user_id;
  `;
  return result[0];
}

module.exports = {
  createCollection,
  getUserRole,
  getCollectionMembers,
  addMemberByEmail,
  removeMember
};