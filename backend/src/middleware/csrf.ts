import { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * CSRF protection for cookie-authenticated requests.
 * State-changing requests must originate from the configured storefront origin.
 * Requests authenticated with a Bearer token (API clients) are exempt.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.includes(req.method)) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next();

  const origin = req.headers.origin || req.headers.referer;
  const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  if (!origin) return next();
  if (origin.replace(/\/$/, '').startsWith(allowed)) return next();

  return res.status(403).json({ success: false, message: 'Request blocked by CSRF protection' });
}
