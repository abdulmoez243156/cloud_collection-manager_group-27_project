// Duplicate detection for the Catalogue (Function 3).
//
// Problem it solves: collectors keep records in scattered spreadsheets and
// often record the same coin, stamp or sneaker twice. Before an item is saved,
// the API compares its title and category with the items already in the same
// collection and reports likely duplicates.
//
// Two rules, checked in order:
//   1. same_title     - the titles are identical after normalising
//                       ("1952 Silver Pound!" equals "1952 silver  pound")
//   2. similar_title  - same category AND the titles share most of their
//                       words (word overlap >= 60%), or one title contains
//                       the other ("Jordan 1 Chicago" vs "Jordan 1 Chicago 1985")
//
// This file has no database or HTTP code: it receives plain objects and
// returns plain objects, so it can be tested and explained on its own.

const SIMILARITY_THRESHOLD = 0.6;
const MAX_MATCHES = 5;

// Lower-case and keep only letters and digits (any alphabet, including Arabic),
// with single spaces between words.
function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(text) {
  return new Set(normalise(text).split(' ').filter(Boolean));
}

// Jaccard similarity: shared words divided by all distinct words (0 to 1).
// {jordan, 1, chicago} vs {jordan, 1, chicago, 1985} -> 3 / 4 = 0.75
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
      // "contains" only counts for titles of 4+ characters, so a title like
      // "A" does not match every item that has the letter a in it.
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
