// Fills the Floci demo database (Neon branch floci-demo) with demo data:
// three accounts, six collections, 66 items with valuation history, and
// wishlist entries.
//
// Run from the project folder:   node backend/scripts/seed-demo.js
//
// It always uses backend/.env.floci, never backend/.env, so it cannot touch the
// database behind the Vercel site. Safe to run again: it deletes the demo
// collections it made last time and creates them fresh. Other data is kept.
const path = require('path');
const fs = require('fs');

const envFile = path.join(__dirname, '..', '.env.floci');
if (!fs.existsSync(envFile)) {
  console.error('Missing backend/.env.floci (see docs/floci.md, step 4).');
  process.exit(1);
}
require('dotenv').config({ path: envFile, override: true, quiet: true });

const bcrypt = require('bcryptjs');
const sql = require('../db/db');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Team27-demo!';
const OWNER = { name: 'Team 27 Demo', email: 'team27.owner@demo.com' };
const VIEWER = { name: 'Team 27 Viewer', email: 'team27.viewer@demo.com' };
const MONA = { name: 'Mona Hassan', email: 'mona.hassan@demo.com' };

// Items: [title, category, condition, acquired on, cost paid, description, archived]
// Wishlist: [title, category, priority, target budget, status]
// owner: who owns the collection. viewers: who can only look at it.
const COLLECTIONS = [
  {
    title: 'Egyptian Coins', currency: 'EGP', owner: OWNER, viewers: [VIEWER, MONA],
    items: [
      ['1952 Silver Pound', 'Coins', 'excellent', '2021-04-10', 1200, 'King Farouk silver pound, sharp portrait, light toning.'],
      ['King Farouk 10 Piastres 1937', 'Coins', 'good', '2022-01-15', 350, 'Silver, some wear on the high points.'],
      ['Ottoman 20 Kurush 1293', 'Coins', 'fair', '2019-09-20', 2100, 'Abdul Hamid II, minted in Egypt. Small knock on the edge.'],
      ['1960 UAR Half Pound Gold', 'Gold', 'mint', '2023-03-03', 18500, 'Gold commemorative for the Aswan High Dam.'],
      ['King Fuad 5 Piastres 1923', 'Coins', 'excellent', '2020-06-18', 280, 'Silver, Heaton mint mark, bright surfaces.'],
      ['1955 Republic Pound Gold', 'Gold', 'near_mint', '2022-08-30', 24000, 'Third anniversary of the revolution, original case.'],
      ['Sultan Hussein Kamel 2 Piastres 1917', 'Coins', 'good', '2018-11-03', 190, 'Copper-nickel with an even brown patina.'],
      ['1970 Nasser Memorial Pound', 'Coins', 'mint', '2023-10-12', 650, 'Silver memorial pound, still in the bank capsule.'],
      ['Egypt 1 Pound Note 1967', 'Banknotes', 'near_mint', '2020-07-08', 600, 'Tutankhamun design, crisp paper, no folds.'],
      ['Egypt 5 Piastres Note 1940', 'Banknotes', 'fair', '2018-02-14', 250, 'King Farouk portrait, two folds and a small tear.'],
      ['Egypt 10 Pounds Note 1952', 'Banknotes', 'good', '2021-12-01', 1400, 'Last royal-era 10 pound note, light handling.'],
      ['Egypt 50 Piastres Note 1961', 'Banknotes', 'excellent', '2022-05-25', 320, 'Tutankhamun mask, signature of Abdel Hakim El-Rifai.'],
      ['Suez Canal Medal 1956', 'Medals', 'excellent', '2022-11-11', 900, 'Bronze commemorative medal with original ribbon.'],
      ['October War Medal 1973', 'Medals', 'near_mint', '2023-04-06', 1100, 'Military medal with its presentation box.'],
      ['Alexandria Library Medal 2002', 'Medals', 'mint', '2024-02-17', 450, 'Bibliotheca Alexandrina opening medal.'],
      ['Damaged 1 Millieme 1917', 'Coins', 'poor', '2017-05-05', 20, 'Heavily worn, kept only as a filler.', true]
    ],
    wishlist: [
      ['1964 Silver Pound', 'Coins', 'high', 1800, 'wanted'],
      ['1953 Republic 5 Piastres', 'Coins', 'medium', 300, 'wanted'],
      ['Egypt 100 Pounds Note 1978', 'Banknotes', 'low', 950, 'wanted'],
      ['King Farouk Gold Pound 1938', 'Gold', 'high', 30000, 'wanted'],
      ['Ottoman 10 Kurush 1277', 'Coins', 'medium', 1500, 'wanted'],
      ['Suez Canal Medal 1956', 'Medals', 'high', 1000, 'acquired'],
      ['October War Medal 1973', 'Medals', 'medium', 1200, 'acquired']
    ]
  },
  {
    title: 'Stamps of the World', currency: 'GBP', owner: OWNER, viewers: [VIEWER],
    items: [
      ['Penny Black 1840', 'Great Britain', 'fair', '2020-09-09', 220, 'Four margins, red Maltese cross cancellation.'],
      ['Two Penny Blue 1840', 'Great Britain', 'good', '2021-05-20', 480, 'Plate 2, light cancellation.'],
      ['Penny Red Plate 120', 'Great Britain', 'excellent', '2022-03-14', 18, 'Perforated, well centred.'],
      ['Queen Victoria 1 Shilling Green', 'Great Britain', 'good', '2019-10-02', 65, 'Plate 4, small thin on the back.'],
      ['Egypt King Fuad 1923 Set', 'Egypt', 'near_mint', '2022-10-01', 140, 'Complete set of 13, hinged.'],
      ['Egypt First Issue 1866 1 Piastre', 'Egypt', 'good', '2021-08-08', 85, 'Watermark pyramid and star, used.'],
      ['Egypt King Farouk Wedding 1938', 'Egypt', 'mint', '2023-02-11', 40, 'Royal wedding issue, never hinged.'],
      ['Suez Canal Opening 1869 Cover', 'Egypt', 'excellent', '2019-12-02', 900, 'Envelope with the canal opening postmark.'],
      ['US Inverted Jenny Reprint', 'USA', 'mint', '2023-01-12', 35, 'Official 2013 reprint, never hinged.'],
      ['US Pan-American Expo 1901 Set', 'USA', 'good', '2020-04-19', 120, 'Set of six, mixed centring.'],
      ['France Ceres 1849 20c Black', 'France', 'fair', '2018-07-21', 60, 'Four margins, grid cancellation, one short corner.'],
      ['France Sower 1906 Pair', 'France', 'excellent', '2022-12-09', 25, 'Horizontal pair, original gum.']
    ],
    wishlist: [
      ['Penny Red Plate 77', 'Great Britain', 'low', 5000, 'wanted'],
      ['Egypt First Issue 1866 5 Piastres', 'Egypt', 'high', 250, 'wanted'],
      ['US Columbian Exposition 1893 1c', 'USA', 'medium', 40, 'wanted'],
      ['France Napoleon III 1862 Set', 'France', 'medium', 180, 'wanted'],
      ['Queen Victoria 5 Shilling Rose', 'Great Britain', 'high', 350, 'wanted'],
      ['Egypt King Fuad 1923 Set', 'Egypt', 'medium', 150, 'acquired']
    ]
  },
  {
    title: 'Sneaker Vault', currency: 'USD', owner: OWNER, viewers: [VIEWER],
    items: [
      ['Air Jordan 1 Chicago 2015', 'Jordan', 'near_mint', '2023-06-01', 1600, 'Size 43, worn twice, original box.'],
      ['Air Jordan 4 Bred 2019', 'Jordan', 'excellent', '2022-02-26', 350, 'Size 42.5, light creasing.'],
      ['Air Jordan 11 Concord 2018', 'Jordan', 'good', '2021-12-15', 320, 'Size 43, patent leather has small scuffs.'],
      ['Air Jordan 3 White Cement 2023', 'Jordan', 'mint', '2024-03-02', 210, 'Deadstock, size 44.'],
      ['Nike Dunk Low Panda', 'Nike', 'good', '2023-09-09', 110, 'Size 43, everyday pair.'],
      ['Nike Air Max 1 Patta Waves', 'Nike', 'excellent', '2021-11-11', 420, 'Size 43, with extra laces.'],
      ['Nike SB Dunk Low Pigeon', 'Nike', 'near_mint', '2022-07-30', 900, 'Size 42, original box and receipt.'],
      ['Nike Air Force 1 Off-White', 'Nike', 'fair', '2019-05-25', 1100, 'Size 43, yellowed midsole.'],
      ['Adidas Yeezy 350 Zebra', 'Adidas', 'mint', '2024-01-20', 260, 'Deadstock, size 44.'],
      ['Adidas Samba OG', 'Adidas', 'excellent', '2024-05-05', 100, 'Size 43, worn a few times.'],
      ['New Balance 990v3 JJJJound', 'New Balance', 'near_mint', '2023-08-19', 480, 'Size 43, grey suede.'],
      ['New Balance 550 White Green', 'New Balance', 'poor', '2021-04-04', 120, 'Size 43, torn lining. Kept for parts.', true]
    ],
    wishlist: [
      ['Air Jordan 3 Black Cement', 'Jordan', 'high', 300, 'wanted'],
      ['Nike SB Dunk Low Travis Scott', 'Nike', 'low', 1500, 'wanted'],
      ['Air Jordan 1 Travis Scott Mocha', 'Jordan', 'medium', 1300, 'wanted'],
      ['New Balance 2002R Protection Pack', 'New Balance', 'medium', 220, 'wanted'],
      ['Adidas Gazelle Indoor', 'Adidas', 'low', 130, 'wanted'],
      ['Adidas Samba OG', 'Adidas', 'medium', 120, 'acquired']
    ]
  },
  {
    title: 'Football Shirts', currency: 'EGP', owner: OWNER, viewers: [VIEWER],
    items: [
      ['Al Ahly Home 2006 Aboutrika', 'Al Ahly', 'excellent', '2020-03-01', 3500, 'Match-style shirt, number 22, CAF Champions League season.'],
      ['Al Ahly Away 2012', 'Al Ahly', 'good', '2021-01-20', 1200, 'White away shirt, slight fading on the print.'],
      ['Zamalek Home 2002', 'Zamalek', 'good', '2019-08-14', 1800, 'Classic white shirt with red stripes.'],
      ['Zamalek Home 2024', 'Zamalek', 'mint', '2024-07-10', 1600, 'Super Cup season, tags attached.'],
      ['Egypt Home 2010 Africa Cup', 'Egypt national team', 'near_mint', '2022-02-02', 2800, 'Third Africa Cup in a row, red home shirt.'],
      ['Egypt Home 2018 Salah', 'Egypt national team', 'excellent', '2023-05-15', 2200, 'World Cup 2018, number 10.'],
      ['Egypt Away 1990 World Cup', 'Egypt national team', 'fair', '2018-06-20', 4500, 'Original 1990 shirt, a few loose threads.'],
      ['Liverpool Home 2019 Salah', 'European clubs', 'excellent', '2022-09-09', 2600, 'Champions League winning season.'],
      ['Real Madrid Home 2017', 'European clubs', 'good', '2021-10-10', 1900, 'Ronaldo number 7, small mark on the sleeve.'],
      ['Arsenal Home 2004 Invincibles', 'European clubs', 'near_mint', '2023-12-12', 5200, 'Unbeaten season, Henry number 14.']
    ],
    wishlist: [
      ['Al Ahly Home 2001 Club World Cup', 'Al Ahly', 'high', 4000, 'wanted'],
      ['Zamalek Away 2016', 'Zamalek', 'low', 900, 'wanted'],
      ['Egypt Home 2006 Africa Cup', 'Egypt national team', 'high', 3500, 'wanted'],
      ['AC Milan Home 2007', 'European clubs', 'medium', 2400, 'wanted'],
      ['Liverpool Home 2019 Salah', 'European clubs', 'medium', 2500, 'acquired']
    ]
  },
  {
    title: 'Vintage Watches', currency: 'USD', owner: OWNER, viewers: [],
    items: [
      ['Omega Seamaster 1968', 'Omega', 'excellent', '2021-03-18', 1900, 'Automatic, cal. 565, serviced in 2023.'],
      ['Omega Speedmaster 145.022', 'Omega', 'good', '2020-10-05', 4200, 'Manual wind, cal. 861, faded bezel.'],
      ['Seiko 6139 Pogue', 'Seiko', 'good', '2022-06-06', 650, 'Early automatic chronograph, original yellow dial.'],
      ['Seiko King Seiko 4502', 'Seiko', 'near_mint', '2023-01-28', 900, 'Hi-beat, polished case, original crown.'],
      ['Casio F-91W 1991', 'Casio', 'mint', '2024-04-01', 40, 'New old stock, still in the box.'],
      ['Casio G-Shock DW-5000C', 'Casio', 'fair', '2019-02-22', 700, 'The first G-Shock model, new strap.'],
      ['Rolex Oyster Precision 6426', 'Rolex', 'excellent', '2022-11-30', 4800, 'Manual wind, 34 mm, papers included.'],
      ['Tissot Visodate 1960', 'Tissot', 'good', '2021-07-07', 550, 'Automatic, small dial spots.']
    ],
    wishlist: [
      ['Omega Constellation Pie Pan', 'Omega', 'high', 2800, 'wanted'],
      ['Seiko 62MAS', 'Seiko', 'medium', 3200, 'wanted'],
      ['Rolex Datejust 1601', 'Rolex', 'low', 7500, 'wanted'],
      ['Casio Casiotron 1974', 'Casio', 'medium', 600, 'wanted']
    ]
  },
  {
    title: 'Arabic Vinyl Records', currency: 'EGP', owner: MONA, viewers: [OWNER],
    items: [
      ['Umm Kulthum - Enta Omri', 'Umm Kulthum', 'good', '2020-05-05', 1500, 'Sono Cairo pressing, 1964.'],
      ['Umm Kulthum - Al Atlal', 'Umm Kulthum', 'excellent', '2021-09-09', 1800, 'Original gatefold sleeve.'],
      ['Abdel Halim Hafez - Qariat al Fingan', 'Abdel Halim', 'near_mint', '2022-04-04', 1300, 'Live recording, 1976.'],
      ['Abdel Halim Hafez - Ahwak', 'Abdel Halim', 'fair', '2019-01-15', 600, 'Sleeve has water damage, vinyl plays well.'],
      ['Fairuz - Nassam Alayna El Hawa', 'Fairuz', 'excellent', '2023-03-03', 2100, 'Lebanese first pressing.'],
      ['Fairuz - Ma Indi Hawa', 'Fairuz', 'good', '2021-11-11', 900, 'Light surface noise.'],
      ['Mohamed Abdel Wahab - Cleopatra', 'Abdel Wahab', 'good', '2020-12-12', 1100, 'Sono Cairo, 1960s pressing.'],
      ['Warda - Batwanes Beek', 'Warda', 'mint', '2024-06-06', 800, 'Sealed reissue.']
    ],
    wishlist: [
      ['Umm Kulthum - Alf Leila wa Leila', 'Umm Kulthum', 'high', 2000, 'wanted'],
      ['Sayed Darwish - Collection', 'Sayed Darwish', 'medium', 1200, 'wanted'],
      ['Fairuz - Ana La Habibi', 'Fairuz', 'low', 1500, 'wanted']
    ]
  }
];

const NOTES = ['Dealer estimate', 'Auction result', 'Online marketplace average',
  'Collector club valuation', 'Insurance appraisal', 'Price guide 2026 edition'];
const pad = (n) => String(n).padStart(2, '0');

// Gives an item 0 to 3 estimates, one a year up to 2026, never before the day
// it was bought. Items in good condition go up in value, fair and poor ones go
// down. No random numbers, so every run gives the same data.
function valuationsFor(index, condition, acquired, cost, archived) {
  if (archived) return [];
  const count = [2, 1, 3, 0, 2, 1, 3][index % 7];
  const losesValue = condition === 'fair' || condition === 'poor';
  const list = [];
  for (let step = 1; step <= count; step += 1) {
    const change = losesValue ? 1 - 0.07 * step : 1 + 0.06 * step + (index % 4) * 0.03;
    const year = 2026 - count + step;
    const date = `${year}-${pad((index * 5) % 9 + 1)}-${pad((index * 7) % 26 + 1)}`;
    if (date > acquired) list.push([Math.round(cost * change), date, NOTES[(index + step) % NOTES.length]]);
  }
  return list;
}

// Returns the id of the account, and creates it first if it does not exist.
// An existing account keeps its password.
let createdAccounts = 0;
async function findOrCreateUser(account) {
  const [existing] = await sql`SELECT id FROM users WHERE email = ${account.email}`;
  if (existing) return existing.id;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const [user] = await sql`
    INSERT INTO users (name, email, password_hash)
    VALUES (${account.name}, ${account.email}, ${passwordHash})
    RETURNING id`;
  createdAccounts += 1;
  return user.id;
}

async function main() {
  const host = new URL(process.env.DATABASE_URL).host;
  console.log(`Seeding demo data into ${host}`);

  // email -> user id
  const userIds = {};
  for (const account of [OWNER, VIEWER, MONA]) {
    userIds[account.email] = await findOrCreateUser(account);
  }

  const totals = { items: 0, valuations: 0, wishlist: 0 };
  for (const c of COLLECTIONS) {
    const ownerId = userIds[c.owner.email];

    // Remove last run's copy of this demo collection (items, valuations and
    // wishlist entries go with it because of ON DELETE CASCADE).
    await sql`
      DELETE FROM collections
      WHERE title = ${c.title}
        AND id IN (SELECT collection_id FROM collection_members WHERE user_id = ${ownerId} AND role = 'owner')`;

    const [collection] = await sql`
      INSERT INTO collections (title, currency) VALUES (${c.title}, ${c.currency}) RETURNING id`;
    await sql`INSERT INTO collection_members (collection_id, user_id, role) VALUES (${collection.id}, ${ownerId}, 'owner')`;
    for (const viewer of c.viewers) {
      await sql`INSERT INTO collection_members (collection_id, user_id, role)
                VALUES (${collection.id}, ${userIds[viewer.email]}, 'viewer')`;
    }

    let valuationCount = 0;
    for (let index = 0; index < c.items.length; index += 1) {
      const [title, category, condition, acquired, cost, description] = c.items[index];
      const archived = c.items[index][6] === true;
      const [item] = await sql`
        INSERT INTO items (collection_id, title, category, description, condition,
                           acquisition_date, acquisition_cost, is_archived)
        VALUES (${collection.id}, ${title}, ${category}, ${description}, ${condition},
                ${acquired}, ${cost}, ${archived})
        RETURNING id`;
      for (const [amount, date, note] of valuationsFor(index, condition, acquired, cost, archived)) {
        await sql`
          INSERT INTO valuations (item_id, amount, valuation_date, note)
          VALUES (${item.id}, ${amount}, ${date}, ${note})`;
        valuationCount += 1;
      }
    }

    for (const [title, category, priority, budget, status] of c.wishlist) {
      await sql`
        INSERT INTO wishlist_entries (collection_id, title, category, priority, target_budget, status)
        VALUES (${collection.id}, ${title}, ${category}, ${priority}, ${budget}, ${status})`;
    }

    totals.items += c.items.length;
    totals.valuations += valuationCount;
    totals.wishlist += c.wishlist.length;
    console.log(`  ${c.title} (${c.currency}, owner ${c.owner.email}): ${c.items.length} items, `
      + `${valuationCount} valuations, ${c.wishlist.length} wishlist entries`);
  }

  console.log(`Total: ${COLLECTIONS.length} collections, ${totals.items} items, `
    + `${totals.valuations} valuations, ${totals.wishlist} wishlist entries`);
  console.log('');
  console.log('Accounts:');
  console.log('  team27.owner@demo.com    owns five collections, can only view Arabic Vinyl Records');
  console.log('  team27.viewer@demo.com   can only view; has no access to Vintage Watches or the records');
  console.log('  mona.hassan@demo.com     owns Arabic Vinyl Records, can view Egyptian Coins');
  if (createdAccounts > 0) {
    console.log(`  Password for new accounts: ${DEMO_PASSWORD}`);
  } else {
    console.log('  All accounts already existed, so their passwords were not changed.');
  }
}

main().catch((error) => {
  console.error('Seeding failed:', error.message);
  process.exit(1);
});
