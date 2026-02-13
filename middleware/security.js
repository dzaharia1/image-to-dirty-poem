import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

export const configureSecurity = (app) => {
  // Security Middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://apis.google.com",
          "https://www.googleapis.com",
          "https://static.cloudflareinsights.com"
        ],
      },
    },
  }));

  const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per 1 minute
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  // Apply rate limiting to all requests
  app.use(limiter);

  app.use(cors());

  // Disable Cloudflare's automatic script injection
  app.use((req, res, next) => {
    res.setHeader('cf-edge-cache', 'no-transform');
    next();
  });
};
