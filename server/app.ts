import express, { type Express } from "express";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./_core/oauth.js";
import { registerStorageProxy } from "./_core/storageProxy.js";
import { appRouter } from "./routers.js";
import { createContext } from "./_core/context.js";
import { registerNowPaymentsRoutes } from "./nowpayments.js";
import { registerWithdrawalRoutes } from "./withdrawals.js";
import { registerCommissionRoutes } from "./commissions.js";
import { registerDepositRoutes } from "./deposits.js";
import { createApiRateLimiter, createFinancialRateLimiter } from "./security.js";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.use("/api", createApiRateLimiter());
  app.use(
    ["/api/deposits", "/api/withdrawals", "/api/contracts", "/api/commissions"],
    createFinancialRateLimiter()
  );

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerNowPaymentsRoutes(app);
  registerWithdrawalRoutes(app);
  registerCommissionRoutes(app);
  registerDepositRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}
