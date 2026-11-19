"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeHtml = sanitizeHtml;
exports.sanitizeText = sanitizeText;
exports.sanitizeMaybe = sanitizeMaybe;
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'a'];
/** Remove script/style blocks and all attributes, keeping a safe subset of tags. */
function sanitizeHtml(input) {
    if (input === undefined || input === null)
        return null;
    let html = String(input);
    html = html.replace(/<\s*(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    html = html.replace(/<\s*(script|style|iframe|object|embed|form)[^>]*\/?>/gi, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html = html.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (match, tag) => {
        const lower = tag.toLowerCase();
        if (!ALLOWED_TAGS.includes(lower))
            return '';
        return match.startsWith('</') ? `</${lower}>` : `<${lower}>`;
    });
    html = html.replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    html = html.replace(/javascript:/gi, '');
    return html.trim();
}
/** Strip all HTML markup for short, plain-text fields. */
function sanitizeText(input) {
    if (input === undefined || input === null)
        return null;
    const text = String(input)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, 10000);
}
function sanitizeMaybe(value) {
    if (typeof value === 'string')
        return sanitizeText(value);
    return value;
}
