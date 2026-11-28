// Rate limiting (Lab 8 pattern): each client IP may make at most `max`
// requests per time window. Extra requests get 429 Too Many Requests.
// Slows down password guessing and scripts flooding the API.
//
// Sliding window: for every IP we keep the times of its recent requests and
// count only those inside the window.
//
// Limitation (also noted in Lab 8): the counts live in memory. Each running
// Lambda (or Vercel) instance counts on its own, and the counts reset when the
// instance stops, so this is a speed bump, not a global limit. A shared store,
// such as a database table, would make it global.

// The client IP. On Vercel the platform sets X-Forwarded-For itself, so it can
// be trusted there. Elsewhere it is ignored, because any client could send a
// fake one to dodge the limit. On Lambda, serverless-http gives the source IP
// that API Gateway saw.
function clientIp(req) {
  const forwarded = process.env.VERCEL ? req.headers['x-forwarded-for'] : undefined;
  return String(forwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function createRateLimiter({ name, windowMs, max }) {
  const hits = new Map(); // ip -> array of request times (ms)

  // Remove old entries every minute so the map cannot grow forever.
  const cleanup = setInterval(() => {
    const windowStart = Date.now() - windowMs;
    for (const [ip, times] of hits) {
      const fresh = times.filter((t) => t > windowStart);
      if (fresh.length === 0) hits.delete(ip);
      else hits.set(ip, fresh);
    }
  }, 60_000);
  cleanup.unref(); // does not keep the process alive

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = clientIp(req);
    const recent = (hits.get(ip) || []).filter((t) => t > now - windowMs);
    recent.push(now);
    hits.set(ip, recent);

    if (recent.length > max) {
      const retryAfter = Math.ceil((recent[0] + windowMs - now) / 1000);
      console.warn(`SECURITY_ALERT RATE_LIMIT_EXCEEDED limiter=${name} ip=${ip} path=${req.originalUrl}`);
      res.set('Retry-After', String(Math.max(retryAfter, 1)));
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' }
      });
    }
    next();
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// All API requests: generous, normal use never reaches it.
const apiLimiter = createRateLimiter({
  name: 'api',
  windowMs: FIFTEEN_MINUTES,
  max: Number(process.env.RATE_LIMIT_MAX) || 300
});

// Login and registration: strict, to slow down password guessing.
const authLimiter = createRateLimiter({
  name: 'auth',
  windowMs: FIFTEEN_MINUTES,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20
});

module.exports = { apiLimiter, authLimiter, createRateLimiter };
