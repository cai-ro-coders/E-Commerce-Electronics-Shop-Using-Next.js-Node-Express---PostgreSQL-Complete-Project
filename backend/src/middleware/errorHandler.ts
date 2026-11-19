import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/http';
import { ZodError } from 'zod';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors;
  let code = err.code;

  if (err instanceof ZodError) {
    status = 422;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    errors = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof ApiError) {
    status = err.status;
    errors = err.errors;
    code = err.code;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'DUPLICATE';
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      message = target ? `A record with this ${target} already exists` : 'A record with these values already exists';
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'The requested record was not found';
    } else if (err.code === 'P2003') {
      status = 409;
      code = 'RELATION_CONFLICT';
      message = 'This record is referenced by other data and cannot be deleted';
    }
  } else if (err?.name === 'MulterError') {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
  }

  if (status >= 500) console.error('[api-error]', err);

  res.status(status).json({
    success: false,
    message,
    ...(code ? { code } : {}),
    ...(errors ? { errors } : {}),
    ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { stack: err.stack } : {}),
  });
}
