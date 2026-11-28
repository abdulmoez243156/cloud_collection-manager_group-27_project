// Duplicate detection for the Catalogue (F3).
// Collectors often record the same coin, stamp or sneaker twice. Before an item
// is saved, its title and category are compared with the items already in the
// collection. Two rules:
//   same_title     the titles are equal after normalising
//                  ("1952 Silver Pound!" and "1952 silver  pound")
//   similar_title  same category, and the titles share most of their words
//                  (60% or more), or one title contains the other
//                  ("Jordan 1 Chicago" and "Jordan 1 Chicago 1985")
// No database or HTTP code here: plain objects in, plain objects out.

const SIMILARITY_THRESHOLD = 0.6;
const MAX_MATCHES = 5;

// Lower case, letters and digits only (any alphabet, so Arabic titles work
// too), one space between words.
function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(text) {
  return new Set(normalise(text).split(' ').filter(Boolean));
}

// Shared words divided by all the different words, from 0 to 1.
// {jordan, 1, chicago} and {jordan, 1, chicago, 1985} -> 3 / 4 = 0.75
function wordOverlap(a, b) {
  const setA = words(a);
  const setB = words(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) {
    if (setB.has(word)) shared += 1;
  }
  return shared / (setA.size + setB.size - shared);
}

// candidate: { title, category }   existing: rows from itemService.listTitles
// excludeId: the item being edited, so it is never reported as its own duplicate
function findDuplicates(candidate, existing, excludeId = null) {
  const title = normalise(candidate.title);
  const category = normalise(candidate.category);
  const compactTitle = title.replace(/ /g, '');
  const matches = [];

  for (const item of existing) {
    if (item.id === excludeId) continue;

    const otherTitle = normalise(item.title);
    const sameCategory = normalise(item.category) === category;
    let reason = null;
    let score = 0;

    if (otherTitle.replace(/ /g, '') === compactTitle) {
      reason = 'same_title';
      score = 1;
    } else if (sameCategory) {
      const overlap = wordOverlap(title, otherTitle);
      // "contains" only counts for titles of 4 or more characters, so a
      // title like "A" does not match every item with an a in it.
      const shorter = title.length <= otherTitle.length ? title : otherTitle;
      const longer = shorter === title ? otherTitle : title;
      const contains = shorter.length >= 4 && longer.includes(shorter);

      if (overlap >= SIMILARITY_THRESHOLD || contains) {
        reason = 'similar_title';
        score = Math.max(overlap, contains ? SIMILARITY_THRESHOLD : 0);
      }
    }

    if (reason) {
      matches.push({
        id: item.id,
        title: item.title,
        category: item.category,
        condition: item.condition,
        is_archived: item.is_archived,
        reason,
        score: Number(score.toFixed(2))
      });
    }
  }

  // Most likely duplicate first.
  matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return matches.slice(0, MAX_MATCHES);
}

module.exports = { findDuplicates, normalise, wordOverlap, SIMILARITY_THRESHOLD };
