import Stripe from 'stripe';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/http';

interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  currency: string;
}

let cached: { secretKey: string; client: Stripe } | null = null;

export async function getStripeConfig(): Promise<StripeConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['stripe_secret_key', 'stripe_publishable_key', 'currency'] } },
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, (row.value ?? '').trim()]));
  return {
    secretKey: values.stripe_secret_key ?? '',
    publishableKey: values.stripe_publishable_key ?? '',
    currency: (values.currency || 'USD').toLowerCase(),
  };
}

/** Returns a cached Stripe client created from the secret key stored in the database. */
export async function getStripeClient(): Promise<{ stripe: Stripe; currency: string; publishableKey: string }> {
  const config = await getStripeConfig();
  if (!config.secretKey) {
    throw new ApiError(503, 'Stripe is not configured. Add your Stripe keys in Admin → Settings → Payment.');
  }
  if (config.secretKey.includes('ElectroShopDemo') || !/^sk_(test|live)_/.test(config.secretKey)) {
    throw new ApiError(503, 'The Stripe secret key is invalid. Update it in Admin → Settings → Payment.');
  }
  if (!cached || cached.secretKey !== config.secretKey) {
    cached = { secretKey: config.secretKey, client: new Stripe(config.secretKey) };
  }
  return { stripe: cached.client, currency: config.currency, publishableKey: config.publishableKey };
}

/** Converts a decimal amount to the smallest currency unit Stripe expects. */
export function toMinorUnits(amount: number): number {
  return Math.round(Number(amount) * 100);
}

/** Maps Stripe SDK failures to clear API errors instead of leaking raw stack traces. */
export function stripeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const failure = error as { type?: string; message?: string };
  if (failure?.type === 'StripeAuthenticationError') {
    return new ApiError(503, 'Stripe rejected the configured secret key. Update it in Admin → Settings → Payment.');
  }
  if (failure?.type === 'StripeInvalidRequestError') {
    return new ApiError(400, failure.message || 'Stripe rejected the payment request.');
  }
  return new ApiError(502, 'Stripe is temporarily unavailable. Please try again.');
}
