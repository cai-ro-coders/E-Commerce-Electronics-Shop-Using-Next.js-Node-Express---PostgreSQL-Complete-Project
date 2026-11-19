"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const routes_1 = __importDefault(require("./routes"));
const errorHandler_1 = require("./middleware/errorHandler");
const csrf_1 = require("./middleware/csrf");
const rateLimit_1 = require("./middleware/rateLimit");
const openapi_1 = require("./docs/openapi");
const app = (0, express_1.default)();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
}));
app.use((0, cors_1.default)({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin.replace(/\/$/, '')) || origin.startsWith('http://localhost:')) {
            return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
app.use((0, morgan_1.default)(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads'), { maxAge: '7d' }));
app.use('/api', rateLimit_1.apiLimiter);
app.use('/api', csrf_1.csrfProtection);
app.get('/api/health', (_req, res) => {
    res.json({ success: true, status: 'ok', service: 'electroshop-api', version: '1.0.0', timestamp: new Date().toISOString() });
});
app.get('/api/openapi.json', (_req, res) => res.json(openapi_1.openApiSpec));
app.use('/api/docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(openapi_1.openApiSpec, {
    customSiteTitle: 'ElectroShop API Docs',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true },
}));
app.use('/api', routes_1.default);
app.use(errorHandler_1.notFoundHandler);
app.use(errorHandler_1.errorHandler);
const server = app.listen(port, () => {
    console.log(`ElectroShop API listening on http://localhost:${port}`);
    console.log(`API docs available at http://localhost:${port}/api/docs`);
});
function shutdown(signal) {
    console.log(`\n${signal} received. Closing server...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
exports.default = app;
