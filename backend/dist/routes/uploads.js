"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const upload_1 = require("../middleware/upload");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const http_1 = require("../utils/http");
const r = (0, express_1.Router)();
r.post('/', auth_1.authenticate, auth_1.adminOrStaff, rateLimit_1.uploadLimiter, upload_1.upload.single('file'), (0, http_1.asyncHandler)(async (req, res) => {
    if (!req.file)
        throw new http_1.ApiError(400, 'No file uploaded');
    const base = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`;
    return (0, http_1.created)(res, {
        url: `/uploads/${req.file.filename}`,
        absoluteUrl: `${base}/uploads/${req.file.filename}`,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mime: req.file.mimetype,
        size: req.file.size,
    }, 'File uploaded');
}));
exports.default = r;
