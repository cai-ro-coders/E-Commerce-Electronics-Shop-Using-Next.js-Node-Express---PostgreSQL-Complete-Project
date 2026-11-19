import { Router } from 'express';
import { upload } from '../middleware/upload';
import { authenticate, adminOrStaff, AuthRequest } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { ApiError, asyncHandler, created } from '../utils/http';

const r = Router();

r.post('/', authenticate, adminOrStaff, uploadLimiter, upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const base = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`;
  return created(res, {
    url: `/uploads/${req.file.filename}`,
    absoluteUrl: `${base}/uploads/${req.file.filename}`,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
  }, 'File uploaded');
}));

export default r;
