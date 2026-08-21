import rateLimit, { type Options } from "express-rate-limit";

const message = { error: "Demasiadas solicitudes; intenta más tarde." };

export function createApiRateLimiter(overrides: Partial<Options> = {}) {
  return rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, message, ...overrides });
}

export function createFinancialRateLimiter(overrides: Partial<Options> = {}) {
  return rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Límite de operaciones excedido; intenta más tarde." }, ...overrides });
}
