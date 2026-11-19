"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const client_1 = require("@prisma/client");
const http_1 = require("../utils/http");
const zod_1 = require("zod");
function notFoundHandler(req, res) {
    res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
}
function errorHandler(err, _req, res, _next) {
    let status = err.status || 500;
    let message = err.message || 'Internal Server Error';
    let errors = err.errors;
    let code = err.code;
    if (err instanceof zod_1.ZodError) {
        status = 422;
        message = 'Validation failed';
        code = 'VALIDATION_ERROR';
        errors = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    }
    else if (err instanceof http_1.ApiError) {
        status = err.status;
        errors = err.errors;
        code = err.code;
    }
    else if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
            status = 409;
            code = 'DUPLICATE';
            const target = err.meta?.target?.join(', ');
            message = target ? `A record with this ${target} already exists` : 'A record with these values already exists';
        }
        else if (err.code === 'P2025') {
            status = 404;
            code = 'NOT_FOUND';
            message = 'The requested record was not found';
        }
        else if (err.code === 'P2003') {
            status = 409;
            code = 'RELATION_CONFLICT';
            message = 'This record is referenced by other data and cannot be deleted';
        }
    }
    else if (err?.name === 'MulterError') {
        status = 400;
        message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    }
    if (status >= 500)
        console.error('[api-error]', err);
    res.status(status).json({
        success: false,
        message,
        ...(code ? { code } : {}),
        ...(errors ? { errors } : {}),
        ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { stack: err.stack } : {}),
    });
}
