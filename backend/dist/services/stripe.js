"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStripeConfig = getStripeConfig;
exports.getStripeClient = getStripeClient;
exports.toMinorUnits = toMinorUnits;
exports.stripeApiError = stripeApiError;
const stripe_1 = __importDefault(require("stripe"));
const prisma_1 = require("../config/prisma");
const http_1 = require("../utils/http");
let cached = null;
async function getStripeConfig() {
    const rows = await prisma_1.prisma.setting.findMany({
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
async function getStripeClient() {
    const config = await getStripeConfig();
    if (!config.secretKey) {
        throw new http_1.ApiError(503, 'Stripe is not configured. Add your Stripe keys in Admin → Settings → Payment.');
    }
    if (config.secretKey.includes('ElectroShopDemo') || !/^sk_(test|live)_/.test(config.secretKey)) {
        throw new http_1.ApiError(503, 'The Stripe secret key is invalid. Update it in Admin → Settings → Payment.');
    }
    if (!cached || cached.secretKey !== config.secretKey) {
        cached = { secretKey: config.secretKey, client: new stripe_1.default(config.secretKey) };
    }
    return { stripe: cached.client, currency: config.currency, publishableKey: config.publishableKey };
}
/** Converts a decimal amount to the smallest currency unit Stripe expects. */
function toMinorUnits(amount) {
    return Math.round(Number(amount) * 100);
}
/** Maps Stripe SDK failures to clear API errors instead of leaking raw stack traces. */
function stripeApiError(error) {
    if (error instanceof http_1.ApiError)
        return error;
    const failure = error;
    if (failure?.type === 'StripeAuthenticationError') {
        return new http_1.ApiError(503, 'Stripe rejected the configured secret key. Update it in Admin → Settings → Payment.');
    }
    if (failure?.type === 'StripeInvalidRequestError') {
        return new http_1.ApiError(400, failure.message || 'Stripe rejected the payment request.');
    }
    return new http_1.ApiError(502, 'Stripe is temporarily unavailable. Please try again.');
}
