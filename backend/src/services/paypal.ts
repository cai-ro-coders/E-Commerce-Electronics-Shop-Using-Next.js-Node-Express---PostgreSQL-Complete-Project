import { prisma } from '../config/prisma';
import { ApiError } from '../utils/http';

interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  mode: 'sandbox' | 'live';
  currency: string;
  baseUrl: string;
}

interface TokenCache {
  key: string;
  token: string;
  expiresAt: number;
}

interface PayPalOrderLike {
  id: number;
  orderNumber: string;
  grandTotal: unknown;
}

export interface PayPalCapture {
  paypalOrderId: string;
  captureId: string;
  status: string;
  amount: number;
  currency: string;
  customId?: string;
}

let tokenCache: TokenCache | null = null;

function normalizeMode(value?: string): 'sandbox' | 'live' {
  return String(value ?? '').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
}

export async function getPayPalConfig(): Promise<PayPalConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['paypal_client_id', 'paypal_client_secret', 'paypal_mode', 'currency'] } },
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, (row.value ?? '').trim()]));
  const mode = normalizeMode(values.paypal_mode);
  return {
    clientId: values.paypal_client_id ?? '',
    clientSecret: values.paypal_client_secret ?? '',
    mode,
    currency: (values.currency || 'USD').toUpperCase(),
    baseUrl: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
  };
}

async function getPayPalConfigOrThrow(): Promise<PayPalConfig> {
  const config = await getPayPalConfig();
  const isDemo = (value: string) => value.includes('ElectroShopDemo');
  if (!config.clientId || !config.clientSecret) {
    throw new ApiError(503, 'PayPal is not configured. Add your PayPal Client ID and Secret in Admin → Settings → Payment.');
  }
  if (isDemo(config.clientId) || isDemo(config.clientSecret)) {
    throw new ApiError(503, 'The PayPal credentials are invalid. Update them in Admin → Settings → Payment.');
  }
  return config;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function paypalApiError(payload: any, status: number): ApiError {
  const message =
    payload?.message ||
    payload?.error_description ||
    payload?.details?.[0]?.description ||
    'PayPal rejected the request.';
  if (status === 401) {
    return new ApiError(503, 'PayPal rejected the configured credentials. Update them in Admin → Settings → Payment.');
  }
  if (status === 400 || status === 422) {
    return new ApiError(400, message);
  }
  return new ApiError(502, 'PayPal is temporarily unavailable. Please try again.');
}

async function accessToken(config: PayPalConfig): Promise<string> {
  const cacheKey = `${config.baseUrl}|${config.clientId}|${config.clientSecret}`;
  if (tokenCache && tokenCache.key === cacheKey && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
  } catch {
    throw new ApiError(502, 'PayPal is temporarily unavailable. Please try again.');
  }

  const payload = await readJson(response);
  if (!response.ok || !payload?.access_token) {
    throw paypalApiError(payload, response.status);
  }

  const expiresIn = Number(payload.expires_in) || 3000;
  tokenCache = {
    key: cacheKey,
    token: String(payload.access_token),
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return tokenCache.token;
}

async function paypalRequest(config: PayPalConfig, path: string, method: 'GET' | 'POST', body?: unknown): Promise<any> {
  const token = await accessToken(config);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(502, 'PayPal is temporarily unavailable. Please try again.');
  }

  const payload = await readJson(response);
  if (!response.ok) throw paypalApiError(payload, response.status);
  return payload;
}

/** Creates a PayPal order for a local checkout order using the credentials in the database. */
export async function createPayPalOrder(order: PayPalOrderLike): Promise<{ paypalOrderId: string; status: string; currency: string }> {
  const config = await getPayPalConfigOrThrow();
  const payload = await paypalRequest(config, '/v2/checkout/orders', 'POST', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: String(order.id),
        custom_id: String(order.id),
        invoice_id: order.orderNumber,
        description: `ElectroShop order ${order.orderNumber}`,
        amount: {
          currency_code: config.currency,
          value: Number(order.grandTotal).toFixed(2),
        },
      },
    ],
    application_context: {
      brand_name: 'ElectroShop',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
    },
  });

  if (!payload?.id) {
    throw new ApiError(502, 'PayPal did not return an order id. Please try again.');
  }
  return {
    paypalOrderId: String(payload.id),
    status: String(payload.status ?? 'CREATED'),
    currency: config.currency,
  };
}

function extractCapture(payload: any, paypalOrderId: string): PayPalCapture {
  const unit = payload?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (payload?.status !== 'COMPLETED' || capture?.status !== 'COMPLETED' || !capture?.id) {
    throw new ApiError(400, `PayPal payment has not completed (status: ${payload?.status ?? 'unknown'})`);
  }
  return {
    paypalOrderId,
    captureId: String(capture.id),
    status: String(capture.status),
    amount: Number(capture.amount?.value ?? 0),
    currency: String(capture.amount?.currency_code ?? '').toUpperCase(),
    customId: unit?.custom_id ? String(unit.custom_id) : undefined,
  };
}

/** Returns the current status of a PayPal order, or null when it no longer exists. */
export async function getPayPalOrderStatus(paypalOrderId: string): Promise<string | null> {
  const config = await getPayPalConfigOrThrow();
  try {
    const payload = await paypalRequest(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, 'GET');
    return String(payload?.status ?? '') || null;
  } catch (error) {
    if (error instanceof ApiError && [400, 404, 422].includes(error.status)) return null;
    throw error;
  }
}

/** Captures a PayPal order. Safe to retry: already-captured orders return their existing capture. */
export async function capturePayPalOrder(paypalOrderId: string): Promise<PayPalCapture> {
  const config = await getPayPalConfigOrThrow();
  const existing = await paypalRequest(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, 'GET');
  if (existing?.status === 'COMPLETED') {
    return extractCapture(existing, paypalOrderId);
  }
  if (existing?.status !== 'APPROVED' && existing?.status !== 'CREATED') {
    throw new ApiError(400, `PayPal order cannot be captured (status: ${existing?.status ?? 'unknown'})`);
  }
  const payload = await paypalRequest(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, 'POST', {});
  return extractCapture(payload, paypalOrderId);
}
