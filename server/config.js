// server/config.js
// ─────────────────────────────────────────────────────────────────────────────
// All non-secret tuneable options in one place.
// Credentials and IDs stay in .env — this file is for behaviour settings.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {

  // ── Google Sheets ──────────────────────────────────────────────────────────

  // Tabs to exclude from the song list (e.g. practice/draft tabs)
  EXCLUDED_TABS: ['待練勿點'],

  // How often to refresh the song list from Google Sheets (milliseconds)
  SHEET_REFRESH_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes


  // ── Song Matching ──────────────────────────────────────────────────────────

  // Confidence % at or above which a match goes straight to queue.
  // Below this threshold → sent to Pending for manual review.
  AUTO_ACCEPT_THRESHOLD: 80,

  // Fuse.js fuzzy match settings
  // threshold: 0 = exact match only, 1 = match anything (0.4 is a good balance)
  // distance: how far apart characters can be and still match
  MATCH_THRESHOLD: 0.4,
  MATCH_DISTANCE: 100,
  MATCH_MIN_CHARS: 2,

  // How much title vs artist name contributes to the match score (must sum to 1.0)
  MATCH_TITLE_WEIGHT:  0.8,
  MATCH_ARTIST_WEIGHT: 0.2,


  // ── Random Song Pick ───────────────────────────────────────────────────────

  // Weight given to songs that have never been requested (higher = more likely)
  RANDOM_NEVER_REQUESTED_WEIGHT: 365,

  // Maximum weight for songs based on days since last request
  RANDOM_MAX_DAYS_WEIGHT: 180,


  // ── Overlay ────────────────────────────────────────────────────────────────
  // Note: overlay/index.html also has CSS variables (font sizes, list height)
  // that can be edited directly in the <style> block at the top of that file.

  // How fast the Up Next / Played lists auto-scroll when they overflow (px/sec)
  OVERLAY_SCROLL_PX_PER_SEC: 28,

};
