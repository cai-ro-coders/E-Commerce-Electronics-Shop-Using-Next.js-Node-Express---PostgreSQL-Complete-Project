import rateLimit from 'express-rate-limit';

const standard = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
};

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  ...standard,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  ...standard,
  message: { success: false, message: 'Too many authentication attempts. Please wait 15 minutes.' },
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  ...standard,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  ...standard,
  message: { success: false, message: 'Too many uploads. Please slow down.' },
});
