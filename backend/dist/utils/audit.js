"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordActivity = recordActivity;
exports.notify = notify;
const prisma_1 = require("../config/prisma");
async function recordActivity(opts) {
    try {
        await prisma_1.prisma.activityLog.create({ data: opts });
    }
    catch {
        // Activity logging must never break the request.
    }
}
async function notify(opts) {
    try {
        await prisma_1.prisma.notification.create({
            data: {
                userId: opts.userId ?? null,
                title: opts.title,
                message: opts.message,
                type: opts.type ?? 'system',
                link: opts.link,
            },
        });
    }
    catch {
        // Notifications are best-effort.
    }
}
