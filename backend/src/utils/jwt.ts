import jwt, { SignOptions } from 'jsonwebtoken';

const secret = process.env.JWT_SECRET || 'change-me-super-secret';

export interface TokenPayload {
  id: number;
  role: string;
  email: string;
}

export function signToken(payload: TokenPayload, expiresIn?: string) {
  return jwt.sign(payload, secret, {
    expiresIn: (expiresIn || process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, secret) as TokenPayload;
}
