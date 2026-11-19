"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDir = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(dir))
    fs_1.default.mkdirSync(dir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
        const safe = path_1.default.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '-');
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safe}`);
    },
});
const ALLOWED = /^(image\/(jpeg|png|webp|gif|svg\+xml)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|text\/(csv|plain))$/;
exports.upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED.test(file.mimetype))
            cb(null, true);
        else
            cb(new Error('Unsupported file type. Upload images, PDFs, Word, Excel, CSV or text files.'));
    },
});
exports.uploadDir = dir;
