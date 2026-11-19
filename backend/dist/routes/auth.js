"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const c = __importStar(require("../controllers/authController"));
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const rateLimit_1 = require("../middleware/rateLimit");
const auth_2 = require("../validators/auth");
const http_1 = require("../utils/http");
const r = (0, express_1.Router)();
r.post('/register', rateLimit_1.authLimiter, (0, validate_1.validateBody)(auth_2.registerSchema), (0, http_1.asyncHandler)(c.register));
r.post('/login', rateLimit_1.authLimiter, (0, validate_1.validateBody)(auth_2.loginSchema), (0, http_1.asyncHandler)(c.login));
r.post('/logout', (0, http_1.asyncHandler)(c.logout));
r.post('/forgot-password', rateLimit_1.authLimiter, (0, validate_1.validateBody)(auth_2.forgotSchema), (0, http_1.asyncHandler)(c.forgotPassword));
r.post('/reset-password', rateLimit_1.authLimiter, (0, validate_1.validateBody)(auth_2.resetSchema), (0, http_1.asyncHandler)(c.resetPassword));
r.post('/change-password', auth_1.authenticate, rateLimit_1.writeLimiter, (0, validate_1.validateBody)(auth_2.changePasswordSchema), (0, http_1.asyncHandler)(c.changePassword));
r.get('/me', auth_1.authenticate, (0, http_1.asyncHandler)(c.me));
r.put('/profile', auth_1.authenticate, (0, validate_1.validateBody)(auth_2.profileSchema), (0, http_1.asyncHandler)(c.updateProfile));
r.get('/login-history', auth_1.authenticate, (0, http_1.asyncHandler)(c.loginHistory));
exports.default = r;
