import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/http';

type Source = 'body' | 'query' | 'params';

function formatIssues(error: any) {
  return error.issues?.map((i: any) => ({ path: i.path?.join('.') ?? '', message: i.message })) ?? [];
}

export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]);
      (req as any)[source] = parsed;
      next();
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return next(new ApiError(422, 'Validation failed', formatIssues(error), 'VALIDATION_ERROR'));
      }
      next(error);
    }
  };
}

export function validateBody(schema: ZodTypeAny) {
  return validate(schema, 'body');
}

export function validateQuery(schema: ZodTypeAny) {
  return validate(schema, 'query');
}
