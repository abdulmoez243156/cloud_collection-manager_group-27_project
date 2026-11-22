// Security headers on every API response (Lab 8 pattern).
// The API only returns JSON, so it can use a very strict policy: a browser
// may not run, frame or load anything from these responses.
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',          // never guess a different content type
    'X-Frame-Options': 'DENY',                    // never show the API inside a frame
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'                   // private collection data is never cached
  });
  next();
}

module.exports = securityHeaders;
