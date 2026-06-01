// server/matcher.js
// Fuzzy-matches a viewer's request text against your Google Sheet song list.

const Fuse = require('fuse.js');
const config = require('./config');
const { getSongs } = require('./sheets');

// Options loaded from config.js
const AUTO_ACCEPT_THRESHOLD = config.AUTO_ACCEPT_THRESHOLD;

function getFuseOptions() {
  return {
    keys: [
      { name: 'title', weight: config.MATCH_TITLE_WEIGHT },
      { name: 'artist', weight: config.MATCH_ARTIST_WEIGHT },
    ],
    threshold: config.MATCH_THRESHOLD,
    distance: config.MATCH_DISTANCE,
    minMatchCharLength: config.MATCH_MIN_CHARS,
    includeScore: true,
  };
}

function matchSong(requestText) {
  const songs = getSongs();

  if (songs.length === 0) {
    return { matched: false, confident: false, reason: 'Song list is empty' };
  }

  const fuse = new Fuse(songs, getFuseOptions());
  const results = fuse.search(requestText.trim());

  if (results.length === 0) {
    return {
      matched: false,
      confident: false,
      reason: `"${requestText}" did not match any song in your list`,
    };
  }

  const best = results[0];
  const confidence = Math.round((1 - best.score) * 100);
  const confident = confidence >= AUTO_ACCEPT_THRESHOLD;

  return {
    matched: true,
    confident,
    song: best.item,
    confidence,
    originalRequest: requestText,
  };
}

module.exports = { matchSong, AUTO_ACCEPT_THRESHOLD };
