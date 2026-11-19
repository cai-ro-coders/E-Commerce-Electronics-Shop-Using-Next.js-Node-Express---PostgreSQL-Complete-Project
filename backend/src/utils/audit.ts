import { prisma } from '../config/prisma';

export async function recordActivity(opts: {
  userId: number;
  action: string;
  entity?: string;
  entityId?: number;
  details?: string;
  ip?: string;
}) {
  try {
    await prisma.activityLog.create({ data: opts });
  } catch {
    // Activity logging must never break the request.
  }
}

export async function notify(opts: {
  userId?: number | null;
  title: string;
  message: string;
  type?: string;
  link?: string;
}) {
  try {
    await prisma.notification.create({
      data: {
        userId: opts.userId ?? null,
        title: opts.title,
        message: opts.message,
        type: opts.type ?? 'system',
        link: opts.link,
      },
    });
  } catch {
    // Notifications are best-effort.
  }
}
