const sql = require('../db/db');
const bcrypt = require('bcryptjs');

async function registerUser({ name, email, password }) {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const result = await sql`
    INSERT INTO users (name, email, password_hash)
    VALUES (${name}, ${email}, ${passwordHash})
    RETURNING id, name, email, created_at;
  `;
  return result[0];
}


async function findUserByEmail(email) {
  const result = await sql`
    SELECT * FROM users WHERE email = ${email};
  `;
  return result[0];
}

module.exports = {
  registerUser,
  findUserByEmail
};