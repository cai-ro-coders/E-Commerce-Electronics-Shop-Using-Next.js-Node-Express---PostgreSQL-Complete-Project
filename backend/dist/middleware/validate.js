"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
exports.validateBody = validateBody;
exports.validateQuery = validateQuery;
const http_1 = require("../utils/http");
function formatIssues(error) {
    return error.issues?.map((i) => ({ path: i.path?.join('.') ?? '', message: i.message })) ?? [];
}
function validate(schema, source = 'body') {
    return (req, _res, next) => {
        try {
            const parsed = schema.parse(req[source]);
            req[source] = parsed;
            next();
        }
        catch (error) {
            if (error?.name === 'ZodError') {
                return next(new http_1.ApiError(422, 'Validation failed', formatIssues(error), 'VALIDATION_ERROR'));
            }
            next(error);
        }
    };
}
function validateBody(schema) {
    return validate(schema, 'body');
}
function validateQuery(schema) {
    return validate(schema, 'query');
}
