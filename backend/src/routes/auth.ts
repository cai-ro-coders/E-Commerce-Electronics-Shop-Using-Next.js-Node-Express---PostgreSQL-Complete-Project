import { Router } from 'express';
import * as c from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { authLimiter, writeLimiter } from '../middleware/rateLimit';
import {
  loginSchema, registerSchema, forgotSchema, resetSchema, changePasswordSchema, profileSchema,
} from '../validators/auth';
import { asyncHandler } from '../utils/http';

const r = Router();
r.post('/register', authLimiter, validateBody(registerSchema), asyncHandler(c.register));
r.post('/login', authLimiter, validateBody(loginSchema), asyncHandler(c.login));
r.post('/logout', asyncHandler(c.logout));
r.post('/forgot-password', authLimiter, validateBody(forgotSchema), asyncHandler(c.forgotPassword));
r.post('/reset-password', authLimiter, validateBody(resetSchema), asyncHandler(c.resetPassword));
r.post('/change-password', authenticate, writeLimiter, validateBody(changePasswordSchema), asyncHandler(c.changePassword));
r.get('/me', authenticate, asyncHandler(c.me));
r.put('/profile', authenticate, validateBody(profileSchema), asyncHandler(c.updateProfile));
r.get('/login-history', authenticate, asyncHandler(c.loginHistory));
export default r;
