// server/app.ts
import express from "express";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = { openId: user.openId };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message2) {
    super(message2);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) console.error("[OAuth] ERROR: OAUTH_SERVER_URL is not configured!");
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const { data } = await this.client.post(EXCHANGE_TOKEN_PATH, {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    });
    return data;
  }
  async getUserInfoByToken(token3) {
    const { data } = await this.client.post(GET_USER_INFO_PATH, { accessToken: token3.accessToken });
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({ baseURL: ENV.oAuthServerUrl, timeout: AXIOS_TIMEOUT_MS });
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(platforms.filter((p) => typeof p === "string"));
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE")) return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({ accessToken });
    const loginMethod = this.deriveLoginMethod(data?.platforms, data?.platform ?? data.platform ?? null);
    return { ...data, platform: loginMethod, loginMethod };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) return /* @__PURE__ */ new Map();
    return new Map(Object.entries(parseCookieHeader(cookieHeader)));
  }
  getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }
  async createSessionToken(openId, options = {}) {
    return this.signSession({ openId, appId: ENV.appId, name: options.name || "" }, options);
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor((issuedAt + expiresInMs) / 1e3)).sign(this.getSessionSecret());
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), { algorithms: ["HS256"] });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) return null;
      return { openId, appId, name };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const { data } = await this.client.post(GET_USER_INFO_WITH_JWT_PATH, { jwtToken, projectId: ENV.appId });
    const loginMethod = this.deriveLoginMethod(data?.platforms, data?.platform ?? data.platform ?? null);
    return { ...data, platform: loginMethod, loginMethod };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) sessionToken = authHeader.slice(7);
    }
    const session = await this.verifySession(sessionToken);
    if (!session) throw ForbiddenError("Invalid session cookie");
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      if (!userInfo.taskUid) throw ForbiddenError("Cron session missing task_uid");
      return buildCronUser(userInfo);
    }
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(session.openId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({ openId: userInfo.openId, name: userInfo.name || null, email: userInfo.email ?? null, loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null, lastSignedIn: signedInAt });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) throw ForbiddenError("User not found");
    await upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return { id: -1, openId: userInfo.openId, name: userInfo.name || "Manus Scheduled Task", email: null, loginMethod: null, role: "user", createdAt: now, updatedAt: now, lastSignedIn: now, taskUid: userInfo.taskUid ?? void 0, isCron: true };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app2) {
  app2.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
var appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  })
  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/nowpayments.ts
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
var NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";
var SUPPORTED_DEPOSIT_CURRENCIES = /* @__PURE__ */ new Set(["usdttrc20", "usdtbsc"]);
var supabaseUrl = process.env.VITE_SUPABASE_URL;
var serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
function adminClient() {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
function origin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${forwardedProto}://${req.get("host")}`;
}
function bearer(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}
function validIpnSignature(body, signature) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature) return false;
  const digest2 = crypto.createHmac("sha512", secret).update(JSON.stringify(sortObject(body))).digest("hex");
  const expected = Buffer.from(digest2, "utf8");
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
function validDepositCurrency(value) {
  const currency = String(value || "").toLowerCase();
  return SUPPORTED_DEPOSIT_CURRENCIES.has(currency) ? currency : null;
}
function registerNowPaymentsRoutes(app2) {
  app2.post("/api/payments/nowpayments/payment", async (req, res) => {
    try {
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      const admin3 = adminClient();
      const token3 = bearer(req);
      if (!apiKey || !admin3 || !token3) return res.status(401).json({ error: "Supabase Auth requerida." });
      const { data: authData, error: authError } = await admin3.auth.getUser(token3);
      if (authError || !authData.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
      const amount = Number(req.body?.amount);
      const payCurrency = validDepositCurrency(req.body?.payCurrency || "usdtbsc");
      if (!Number.isFinite(amount) || amount < 10 || amount > 1e5) return res.status(400).json({ error: "El monto debe estar entre 10 y 100000 USD." });
      if (!payCurrency) return res.status(400).json({ error: "Solo se permiten dep\xF3sitos USDT por TRC20 o BEP20." });
      const transactionId = `NP-${crypto.randomUUID()}`;
      const callbackUrl = `${origin(req)}/api/payments/nowpayments/ipn`;
      const response = await fetch(`${NOWPAYMENTS_API_URL}/payment`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          price_amount: amount,
          price_currency: "usd",
          pay_currency: payCurrency,
          order_id: transactionId,
          order_description: `BitNode deposit ${authData.user.id}`,
          ipn_callback_url: callbackUrl,
          is_fixed_rate: true
        })
      });
      const payment = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(502).json({ error: "NOWPayments rechaz\xF3 la creaci\xF3n del pago.", details: payment });
      if (!payment.payment_id || !payment.pay_address || !payment.pay_amount || !payment.pay_currency)
        return res.status(502).json({ error: "NOWPayments no devolvi\xF3 los datos de dep\xF3sito esperados.", details: payment });
      const { error: insertError } = await admin3.from("transactions").insert({
        id: transactionId,
        user_id: authData.user.id,
        username: authData.user.user_metadata?.username || authData.user.email?.split("@")[0] || null,
        type: "deposit",
        label: "Dep\xF3sito NOWPayments",
        amount,
        status: "pending",
        network: payCurrency,
        provider_payment_id: String(payment.payment_id),
        provider_status: String(payment.payment_status || "waiting"),
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (insertError) return res.status(500).json({ error: "No se pudo registrar el dep\xF3sito.", details: insertError.message });
      return res.json({
        transactionId,
        paymentId: String(payment.payment_id),
        payAddress: String(payment.pay_address),
        payAmount: String(payment.pay_amount),
        payCurrency: String(payment.pay_currency),
        status: String(payment.payment_status || "waiting")
      });
    } catch (error) {
      console.error("[NOWPayments] payment error", error);
      return res.status(500).json({ error: "No se pudo iniciar el dep\xF3sito." });
    }
  });
  app2.post("/api/payments/nowpayments/ipn", async (req, res) => {
    if (!validIpnSignature(req.body, req.header("x-nowpayments-sig"))) return res.status(401).json({ error: "Firma IPN inv\xE1lida." });
    const admin3 = adminClient();
    if (!admin3) return res.status(503).json({ error: "Persistencia Supabase no configurada." });
    const body = req.body;
    const orderId = body.order_id ? String(body.order_id) : "";
    const providerStatus = body.payment_status ? String(body.payment_status) : "unknown";
    const status = ["finished", "confirmed"].includes(providerStatus) ? "completed" : ["failed", "expired", "refunded"].includes(providerStatus) ? "failed" : "pending";
    if (orderId) {
      const { error } = await admin3.from("transactions").update({ status, provider_status: providerStatus, provider_payment_id: body.payment_id ? String(body.payment_id) : void 0 }).eq("id", orderId).eq("type", "deposit");
      if (error) return res.status(500).json({ error: "No se pudo actualizar la transacci\xF3n." });
    }
    return res.json({ received: true });
  });
}

// server/withdrawals.ts
import { createClient as createClient2 } from "@supabase/supabase-js";
var NETWORKS = /* @__PURE__ */ new Set(["BNB Chain"]);
var LIMIT = 1e3;
function validWallet(network, wallet) {
  return network === "BNB Chain" && /^0x[a-fA-F0-9]{40}$/.test(wallet);
}
function validateWithdrawalInput(amount, network, wallet, usedToday) {
  if (!Number.isFinite(amount) || amount < 10 || amount > LIMIT) return "El retiro debe estar entre $10 y $1,000 USDT.";
  if (!NETWORKS.has(network) || !validWallet(network, wallet)) return "La red o la wallet no son v\xE1lidas.";
  if (usedToday + amount > LIMIT) return `L\xEDmite diario excedido. Ya solicitaste ${usedToday.toFixed(2)} USDT hoy.`;
  return null;
}
function registerWithdrawalRoutes(app2) {
  app2.post("/api/withdrawals/request", async (req, res) => {
    return res.status(409).json({ error: "Este retiro requiere confirmaci\xF3n con el c\xF3digo enviado a tu correo." });
  });
}

// server/commissions.ts
import { createClient as createClient3 } from "@supabase/supabase-js";
function adminClient2() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey2 ? createClient3(url, serviceRoleKey2, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) : null;
}
function bearer2(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
async function getNetworkSummaryWithClient(client, userId) {
  const [ownerResult, treeResult] = await Promise.all([
    client.from("profiles").select("username, referral_code").eq("id", userId).maybeSingle(),
    client.rpc("get_my_network_tree", { p_user_id: userId, p_max_depth: 25 })
  ]);
  if (ownerResult.error) throw new Error(`Owner profile query failed: ${ownerResult.error.message}`);
  if (treeResult.error) throw new Error(`Network tree query failed: ${treeResult.error.message}`);
  const networkNodes = treeResult.data || [];
  const userIds = Array.from(new Set(networkNodes.map((node) => node.user_id)));
  const profilesResult = userIds.length ? await client.from("profiles").select("id, username").in("id", userIds) : { data: [], error: null };
  if (profilesResult.error) throw new Error(`Network profiles query failed: ${profilesResult.error.message}`);
  const names = new Map((profilesResult.data || []).map((profile) => [profile.id, profile.username]));
  const directNodes = networkNodes.filter((node) => node.sponsor_id === userId);
  const directIds = directNodes.map((node) => node.user_id);
  const contractsResult = directIds.length ? await client.from("contracts").select("user_id, status").in("user_id", directIds) : { data: [], error: null };
  if (contractsResult.error) throw new Error(`Direct contracts query failed: ${contractsResult.error.message}`);
  const activeByUser = /* @__PURE__ */ new Map();
  for (const contract of contractsResult.data || []) {
    if (contract.status === "active") activeByUser.set(contract.user_id, (activeByUser.get(contract.user_id) || 0) + 1);
  }
  return {
    ownerUsername: ownerResult.data?.username || null,
    referralCode: ownerResult.data?.referral_code || null,
    networkNodes: networkNodes.map((node) => ({ ...node, username: names.get(node.user_id) || node.username || "Usuario" })),
    directReferrals: directNodes.map((node) => ({
      user_id: node.user_id,
      username: names.get(node.user_id) || node.username || "Usuario",
      leg: node.parent_id === userId ? node.leg : null,
      active_nodes: activeByUser.get(node.user_id) || 0
    }))
  };
}
async function processContractCommissionsWithClient(client, input) {
  if (!input.sourceEventId || !input.contractId || !input.userId) {
    throw new Error("Commission event identifiers are required.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Commission event amount must be positive.");
  }
  const { data, error } = await client.rpc("process_contract_commissions", {
    p_source_event_id: input.sourceEventId,
    p_contract_id: input.contractId,
    p_user_id: input.userId,
    p_amount: input.amount,
    p_event_type: input.eventType || "contract_confirmed"
  });
  if (error) throw new Error(`Commission RPC failed: ${error.message}`);
  return data;
}
function summarizeCommissionRows(rows) {
  const credited = rows.filter((row) => row.status === "credited");
  const direct = credited.filter((row) => row.commission_type === "direct").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const binary = credited.filter((row) => row.commission_type === "binary").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return { direct, binary, total: direct + binary };
}
async function getCommissionSummary(userId) {
  const client = adminClient2();
  if (!client)
    throw new Error("Supabase server credentials are not configured.");
  const { data, error } = await client.from("commission_ledger").select(
    "id, source_user_id, commission_type, amount, rate, leg, status, source_event_id, created_at, metadata"
  ).eq("beneficiary_id", userId).order("created_at", { ascending: false });
  if (error)
    throw new Error(`Commission ledger query failed: ${error.message}`);
  const rows = data || [];
  const [ownerResult, treeResult, volumeResult] = await Promise.all([
    client.from("profiles").select("username, referral_code").eq("id", userId).maybeSingle(),
    client.rpc("get_my_network_tree", { p_user_id: userId, p_max_depth: 25 }),
    client.from("network_volume").select("leg, volume, matched_volume, updated_at").eq("user_id", userId)
  ]);
  const { data: ownerProfile, error: ownerProfileError } = ownerResult;
  if (ownerProfileError)
    throw new Error(`Owner profile query failed: ${ownerProfileError.message}`);
  const sourceUserIds = Array.from(new Set(rows.map((row) => row.source_user_id).filter(Boolean)));
  const contractIds = Array.from(new Set(rows.map((row) => String(row.metadata?.contract_id || "")).filter(Boolean)));
  const [{ data: sourceProfiles }, { data: sourceContracts }] = await Promise.all([
    sourceUserIds.length ? client.from("profiles").select("id, username").in("id", sourceUserIds) : Promise.resolve({ data: [] }),
    contractIds.length ? client.from("contracts").select("id, plan_id, amount").in("id", contractIds) : Promise.resolve({ data: [] })
  ]);
  const planIds = Array.from(new Set((sourceContracts || []).map((contract) => contract.plan_id).filter(Boolean)));
  const { data: sourcePlans } = planIds.length ? await client.from("plans").select("id, name").in("id", planIds) : { data: [] };
  const profilesById = new Map((sourceProfiles || []).map((profile) => [profile.id, profile.username]));
  const contractsById = new Map((sourceContracts || []).map((contract) => [contract.id, contract]));
  const plansById = new Map((sourcePlans || []).map((plan) => [plan.id, plan.name]));
  const enrichedRows = rows.map((row) => {
    const metadata = row.metadata || {};
    const contract = contractsById.get(String(metadata.contract_id || ""));
    return {
      ...row,
      source_username: profilesById.get(row.source_user_id) || "Usuario referido",
      node_name: contract ? plansById.get(contract.plan_id) || contract.plan_id : "Nodo no identificado",
      contract_amount: contract ? Number(contract.amount) : null
    };
  });
  const networkError = treeResult.error;
  const networkNodes = treeResult.data || [];
  if (networkError)
    throw new Error(`Network tree query failed: ${networkError.message}`);
  if (volumeResult.error)
    throw new Error(`Network volume query failed: ${volumeResult.error.message}`);
  const networkUserIds = Array.from(new Set((networkNodes || []).map((node) => node.user_id)));
  const { data: networkProfiles } = networkUserIds.length ? await client.from("profiles").select("id, username").in("id", networkUserIds) : { data: [] };
  const networkNamesById = new Map((networkProfiles || []).map((profile) => [profile.id, profile.username]));
  const directNodes = (networkNodes || []).filter((node) => node.sponsor_id === userId);
  const directUserIds = directNodes.map((node) => node.user_id);
  const { data: directContracts } = directUserIds.length ? await client.from("contracts").select("user_id, status").in("user_id", directUserIds) : { data: [] };
  const activeNodesByUserId = /* @__PURE__ */ new Map();
  for (const contract of directContracts || []) {
    if (contract.status !== "active") continue;
    activeNodesByUserId.set(
      contract.user_id,
      (activeNodesByUserId.get(contract.user_id) || 0) + 1
    );
  }
  const leftVolume = Number(volumeResult.data?.find((row) => row.leg === "left")?.volume || 0);
  const rightVolume = Number(volumeResult.data?.find((row) => row.leg === "right")?.volume || 0);
  const matchedVolume = Math.max(
    ...(volumeResult.data || []).map((row) => Number(row.matched_volume || 0)),
    0
  );
  const updatedAt = (volumeResult.data || []).map((row) => row.updated_at).filter(Boolean).sort().at(-1) || null;
  return {
    ...summarizeCommissionRows(rows),
    ownerUsername: ownerProfile?.username || null,
    referralCode: ownerProfile?.referral_code || null,
    binaryVolume: {
      left: leftVolume,
      right: rightVolume,
      matched: matchedVolume,
      status: matchedVolume > 0 ? "paired" : leftVolume > 0 || rightVolume > 0 ? "awaiting_pair" : "no_volume",
      updatedAt
    },
    entries: enrichedRows,
    networkNodes: (networkNodes || []).map((node) => ({
      ...node,
      username: networkNamesById.get(node.user_id) || "Usuario"
    })),
    directReferrals: directNodes.map((node) => ({
      user_id: node.user_id,
      username: networkNamesById.get(node.user_id) || "Usuario",
      leg: node.parent_id === userId ? node.leg : null,
      active_nodes: activeNodesByUserId.get(node.user_id) || 0
    }))
  };
}
async function activateContractAndCommissions(client, input) {
  if (!input.contractId || !input.planId || !Number.isFinite(input.amount) || input.amount < 10) {
    throw new Error("Invalid contract activation input.");
  }
  const { data: placement, error: placementError } = await client.rpc(
    "place_network_node",
    {
      p_user_id: input.userId,
      p_sponsor_id: null,
      p_preferred_leg: null
    }
  );
  if (placementError)
    throw new Error(`Network placement RPC failed: ${placementError.message}`);
  const { data, error } = await client.rpc("activate_plan_and_node", {
    p_user_id: input.userId,
    p_contract_id: input.contractId,
    p_plan_id: input.planId,
    p_amount: input.amount,
    p_parent_id: placement?.parent_id ?? null,
    p_leg: placement?.leg ?? null,
    p_username: input.username || null
  });
  if (error) throw new Error(`Plan activation RPC failed: ${error.message}`);
  return { ...data, placement };
}
async function processConfirmedContractCommissions(client, userId, contractId) {
  const { data: transaction, error: transactionError } = await client.from("transactions").select("id, user_id, type, status, amount").eq("id", contractId).eq("user_id", userId).maybeSingle();
  if (transactionError)
    throw new Error(`Contract lookup failed: ${transactionError.message}`);
  if (!transaction || transaction.type !== "contract" || transaction.status !== "completed") {
    throw new Error(
      "Only completed contract transactions can generate commissions."
    );
  }
  return processContractCommissionsWithClient(client, {
    sourceEventId: `contract:${contractId}:confirmed`,
    contractId,
    userId,
    amount: Math.abs(Number(transaction.amount)),
    eventType: "contract_confirmed"
  });
}
function registerCommissionRoutes(app2) {
  app2.get("/api/commissions/network", async (req, res) => {
    const client = adminClient2();
    const accessToken = bearer2(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    try {
      return res.json(await getNetworkSummaryWithClient(client, data.user.id));
    } catch (error2) {
      console.error("[Commissions] network error", error2);
      return res.status(500).json({ error: "No se pudo leer la red binaria." });
    }
  });
  app2.get("/api/commissions/summary", async (req, res) => {
    const client = adminClient2();
    const accessToken = bearer2(req);
    if (!client || !accessToken)
      return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user)
      return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    try {
      return res.json(await getCommissionSummary(data.user.id));
    } catch (error2) {
      console.error("[Commissions] summary error", error2);
      return res.status(500).json({ error: "No se pudo leer el ledger de comisiones." });
    }
  });
  app2.post("/api/contracts/activate", async (req, res) => {
    const client = adminClient2();
    const accessToken = bearer2(req);
    if (!client || !accessToken)
      return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user)
      return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    const contractId = String(req.body?.contractId || "").trim();
    const planId = String(req.body?.planId || "").trim();
    const amount = Number(req.body?.amount);
    if (!contractId || !planId || !Number.isFinite(amount))
      return res.status(400).json({ error: "Datos de contrato incompletos." });
    try {
      const result = await activateContractAndCommissions(client, {
        userId: data.user.id,
        contractId,
        planId,
        username: data.user.user_metadata?.username || data.user.email?.split("@")[0],
        amount
      });
      return res.json(result);
    } catch (error2) {
      console.error("[Contracts] activation error", error2);
      return res.status(400).json({
        error: error2 instanceof Error ? error2.message : "No se pudo activar el contrato."
      });
    }
  });
  app2.post(
    "/api/commissions/contract-confirmed",
    async (req, res) => {
      const client = adminClient2();
      const accessToken = bearer2(req);
      if (!client || !accessToken)
        return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
      const { data, error } = await client.auth.getUser(accessToken);
      if (error || !data.user)
        return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
      const contractId = String(req.body?.contractId || "").trim();
      if (!contractId)
        return res.status(400).json({ error: "contractId es requerido." });
      try {
        const result = await processConfirmedContractCommissions(
          client,
          data.user.id,
          contractId
        );
        return res.json(result);
      } catch (error2) {
        console.error("[Commissions] contract confirmation error", error2);
        return res.status(400).json({
          error: error2 instanceof Error ? error2.message : "No se pudo procesar la comisi\xF3n."
        });
      }
    }
  );
}

// server/secureCommissionEndpoint.ts
import { createClient as createClient4 } from "@supabase/supabase-js";
function adminClient3() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey2 ? createClient4(url, serviceRoleKey2, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function bearer3(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
function registerSecureCommissionRoutes(app2) {
  app2.post("/api/commissions/process", async (req, res) => {
    const client = adminClient3();
    const accessToken = bearer3(req);
    if (!client || !accessToken) {
      return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    }
    const { data: authData, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    }
    const contractId = String(req.body?.contractId || "").trim();
    if (!contractId || contractId.length > 128) {
      return res.status(400).json({ error: "contractId es requerido." });
    }
    const { data: contract, error: contractError } = await client.from("contracts").select("id, user_id, amount, status").eq("id", contractId).eq("user_id", authData.user.id).maybeSingle();
    if (contractError) {
      console.error("[Commissions] Contract lookup failed", contractError);
      return res.status(500).json({ error: "No se pudo verificar el contrato." });
    }
    if (!contract || contract.status !== "active") {
      return res.status(400).json({ error: "Solo los contratos activos pueden liquidar comisiones." });
    }
    const amount = Number(contract.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "El monto del contrato no es v\xE1lido." });
    }
    const { data, error } = await client.rpc("process_contract_commissions", {
      p_source_event_id: `contract:${contract.id}:confirmed`,
      p_contract_id: contract.id,
      p_user_id: authData.user.id,
      p_amount: amount,
      p_event_type: "contract_confirmed"
    });
    if (error) {
      console.error("[Commissions] RPC failed", error);
      return res.status(400).json({ error: "No se pudo procesar la comisi\xF3n." });
    }
    return res.json(data);
  });
}

// server/deposits.ts
import crypto2 from "node:crypto";
import { createClient as createClient5 } from "@supabase/supabase-js";
function admin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient5(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function token(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
function validateManualDeposit(amount) {
  if (!Number.isFinite(amount) || amount < 10 || amount > 1e5) return "El dep\xF3sito debe estar entre $10 y $100,000 USDT.";
  return null;
}
function registerDepositRoutes(app2) {
  app2.post("/api/deposits/request", async (req, res) => {
    const client = admin();
    const accessToken = token(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    const amount = Number(req.body?.amount);
    const validationError = validateManualDeposit(amount);
    if (validationError) return res.status(400).json({ error: validationError });
    const id = `DEP-${crypto2.randomUUID()}`;
    const { error } = await client.from("transactions").insert({
      id,
      user_id: data.user.id,
      username: data.user.user_metadata?.username || data.user.email?.split("@")[0] || null,
      type: "deposit",
      label: "Dep\xF3sito manual \xB7 pendiente",
      amount,
      status: "pending",
      provider_status: "manual_review",
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (error) return res.status(500).json({ error: "No se pudo registrar el dep\xF3sito pendiente." });
    return res.status(201).json({ id, status: "pending", credited: false, message: "Dep\xF3sito registrado para confirmaci\xF3n." });
  });
}

// server/adminWithdrawals.ts
import { createClient as createClient6 } from "@supabase/supabase-js";
var ADMIN_EMAIL = "gentecash@gmail.com";
function serviceClient() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Las credenciales administrativas no est\xE1n configuradas.");
  return createClient6(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function token2(req) {
  const header = req.header("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
async function authenticatedAdmin(req) {
  const client = serviceClient();
  const accessToken = token2(req);
  if (!accessToken) return { client, error: "Sesi\xF3n requerida.", status: 401 };
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return { client, error: "La sesi\xF3n no es v\xE1lida.", status: 401 };
  const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profileError || profile?.role !== "admin" || data.user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return { client, error: "No tienes permisos para gestionar retiros.", status: 403 };
  }
  return { client, userId: data.user.id };
}
async function withdrawalWindow(client) {
  const { data } = await client.from("platform_settings").select("value").eq("key", "withdrawal_window").maybeSingle();
  return data?.value && typeof data.value === "object" && data.value.enabled === true;
}
var cleanReference = (value) => String(value || "").trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
function registerAdminWithdrawalRoutes(app2) {
  app2.get("/api/admin/withdrawal-window", async (req, res) => {
    try {
      const admin3 = await authenticatedAdmin(req);
      if ("error" in admin3) return res.status(admin3.status ?? 500).json({ error: admin3.error });
      return res.status(200).json({ enabled: await withdrawalWindow(admin3.client) });
    } catch (error) {
      console.error("[admin-withdrawal-window]", error);
      return res.status(503).json({ error: "No se pudo consultar la ventana de retiros." });
    }
  });
  app2.patch("/api/admin/withdrawal-window", async (req, res) => {
    try {
      const admin3 = await authenticatedAdmin(req);
      if ("error" in admin3) return res.status(admin3.status ?? 500).json({ error: admin3.error });
      const enabled = req.body?.enabled === true;
      const { error } = await admin3.client.from("platform_settings").upsert({
        key: "withdrawal_window",
        value: { enabled, mode: "manual_test", updated_by: (await admin3.client.auth.getUser(token2(req))).data.user?.id || null },
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "key" });
      if (error) return res.status(500).json({ error: "No se pudo actualizar la ventana de retiros." });
      return res.status(200).json({ enabled });
    } catch (error) {
      console.error("[admin-withdrawal-window]", error);
      return res.status(503).json({ error: "La configuraci\xF3n de retiros no est\xE1 disponible." });
    }
  });
  app2.get("/api/admin/withdrawals", async (req, res) => {
    try {
      const admin3 = await authenticatedAdmin(req);
      if ("error" in admin3) return res.status(admin3.status ?? 500).json({ error: admin3.error });
      const { data, error } = await admin3.client.from("transactions").select("id,user_id,username,label,amount,status,network,wallet,fee,net_amount,provider_status,created_at").eq("type", "withdraw").order("created_at", { ascending: false }).limit(200);
      if (error) return res.status(500).json({ error: "No se pudo cargar la cola de retiros." });
      return res.status(200).json({ withdrawals: data || [] });
    } catch (error) {
      console.error("[admin-withdrawals]", error);
      return res.status(503).json({ error: "El m\xF3dulo de retiros no est\xE1 disponible." });
    }
  });
  app2.post("/api/admin/withdrawals", async (req, res) => {
    try {
      const admin3 = await authenticatedAdmin(req);
      if ("error" in admin3) return res.status(admin3.status ?? 500).json({ error: admin3.error });
      const id = String(req.body?.id || "").trim().slice(0, 160);
      const action = String(req.body?.action || "").trim();
      if (!id || !["approve", "mark_paid", "reject"].includes(action)) return res.status(400).json({ error: "La acci\xF3n de retiro no es v\xE1lida." });
      const { data: withdrawal, error: lookupError } = await admin3.client.from("transactions").select("id,status,type").eq("id", id).maybeSingle();
      if (lookupError || !withdrawal || withdrawal.type !== "withdraw") return res.status(404).json({ error: "Solicitud de retiro no encontrada." });
      const status = String(withdrawal.status);
      const ref = cleanReference(req.body?.reference);
      const transitions = {
        approve: { from: ["pending"], to: "approved", provider: "manual_approved" },
        mark_paid: { from: ["approved"], to: "completed", provider: ref ? `manual_paid:${ref}` : "manual_paid" },
        reject: { from: ["pending", "approved"], to: "rejected", provider: ref ? `manual_rejected:${ref}` : "manual_rejected" }
      };
      const transition = transitions[action];
      if (!transition.from.includes(status)) return res.status(409).json({ error: "La solicitud no permite esta acci\xF3n en su estado actual." });
      const { error: updateError } = await admin3.client.from("transactions").update({ status: transition.to, provider_status: transition.provider }).eq("id", id).eq("status", status);
      if (updateError) return res.status(500).json({ error: "No se pudo actualizar el retiro." });
      return res.status(200).json({ id, status: transition.to, providerStatus: transition.provider });
    } catch (error) {
      console.error("[admin-withdrawals]", error);
      return res.status(503).json({ error: "El m\xF3dulo de retiros no est\xE1 disponible." });
    }
  });
}

// shared/monthlyRoi.ts
import { z as z2 } from "zod";
var roiMonthSchema = z2.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
var percentage = z2.number().finite().min(0).max(1e3).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Usa hasta dos decimales."
);
var monthlyRatesSchema = z2.object({
  daily: percentage,
  seven: percentage,
  fourteen: percentage,
  twentyOne: percentage
}).strict();
var monthlyRoiInput = z2.object({
  month: roiMonthSchema,
  rates: monthlyRatesSchema,
  version: z2.number().int().nonnegative()
}).strict();

// server/adminMonthlyRoi.ts
function registerAdminMonthlyRoiRoutes(app2) {
  app2.get("/api/admin/monthly-roi", async (req, res) => {
    try {
      const admin3 = await authenticatedAdmin(req);
      if ("error" in admin3) return res.status(admin3.status ?? 500).json({ error: admin3.error });
      const month = roiMonthSchema.safeParse(req.query.month);
      if (!month.success) return res.status(400).json({ error: "Selecciona un mes v\xE1lido." });
      const { data, error } = await admin3.client.from("monthly_node_roi").select("rates, version, updated_at").eq("month", `${month.data}-01`).maybeSingle();
      if (error) return res.status(503).json({ error: "La configuraci\xF3n mensual no est\xE1 disponible. Verifica la migraci\xF3n de ROI." });
      return res.json({ month: month.data, rates: data?.rates ?? null, version: data?.version ?? 0, updatedAt: data?.updated_at ?? null });
    } catch {
      return res.status(503).json({ error: "No se pudo cargar la configuraci\xF3n mensual." });
    }
  });
  app2.put("/api/admin/monthly-roi", async (req, res) => {
    try {
      const admin3 = await authenticatedAdmin(req);
      if ("error" in admin3) return res.status(admin3.status ?? 500).json({ error: admin3.error });
      const input = monthlyRoiInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Completa los cuatro porcentajes entre 0 y 1000, con hasta dos decimales, y un mes v\xE1lido." });
      const { month, rates, version } = input.data;
      const { data, error } = await admin3.client.rpc("save_monthly_node_roi", {
        p_month: `${month}-01`,
        p_rates: rates,
        p_expected_version: version,
        p_actor: admin3.userId
      });
      if (error) return res.status(error.code === "40001" ? 409 : 503).json({
        error: error.code === "40001" ? "Otro administrador cambi\xF3 este mes. Recarga el mes antes de guardar." : "No se guardaron los porcentajes. Verifica la migraci\xF3n y vuelve a intentarlo."
      });
      return res.json({ month, rates: data.rates, version: data.version, updatedAt: data.updated_at });
    } catch {
      return res.status(503).json({ error: "No se pudieron guardar los porcentajes." });
    }
  });
}

// server/security.ts
import rateLimit from "express-rate-limit";
var message = { error: "Demasiadas solicitudes; intenta m\xE1s tarde." };
function createApiRateLimiter(overrides = {}) {
  return rateLimit({ windowMs: 15 * 60 * 1e3, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, message, ...overrides });
}
function createFinancialRateLimiter(overrides = {}) {
  return rateLimit({ windowMs: 60 * 1e3, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "L\xEDmite de operaciones excedido; intenta m\xE1s tarde." }, ...overrides });
}

// server/emailSecurity.ts
import crypto3 from "node:crypto";
import { createClient as createClient7 } from "@supabase/supabase-js";

// shared/withdrawalFee.ts
var WITHDRAW_FEE_RATE = 0.05;
var WITHDRAW_MIN_FEE = 1;
function withdrawalFee(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(Math.max(WITHDRAW_MIN_FEE, amount * WITHDRAW_FEE_RATE) * 100) / 100;
}

// server/emailSecurity.ts
var CODE_TTL_MS = 10 * 60 * 1e3;
function admin2() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient7(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function bearer4(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
function digest(challengeId, code) {
  const secret = process.env.EMAIL_OTP_SECRET || process.env.RESEND_API_KEY || "";
  return crypto3.createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}
function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto3.timingSafeEqual(left, right);
}
function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c] || c);
}
async function sendEmail(to, subject, html, idempotencyKey) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY no est\xE1 configurada.");
  const from = process.env.RESEND_FROM_EMAIL || "BitNode <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Resend respondi\xF3 ${response.status}.`);
  return body.id || null;
}
async function authenticated(req) {
  const client = admin2();
  const token3 = bearer4(req);
  if (!client || !token3) return null;
  const { data, error } = await client.auth.getUser(token3);
  return error || !data.user?.email ? null : { client, user: data.user };
}
function normalizedPayload(purpose, input) {
  const payload = input && typeof input === "object" ? input : {};
  if (purpose === "wallet_change") {
    const wallet2 = String(payload.wallet || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet2)) throw new Error("La wallet BEP20 no es v\xE1lida.");
    return { wallet: wallet2 };
  }
  const amount = Number(payload.amount);
  const network = String(payload.network || "");
  const wallet = String(payload.wallet || "").trim();
  const error = validateWithdrawalInput(amount, network, wallet, 0);
  if (error) throw new Error(error);
  return { amount, network, wallet };
}
function registerEmailSecurityRoutes(app2) {
  app2.post("/api/security/email-code/request", async (req, res) => {
    const auth = await authenticated(req);
    if (!auth) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const purpose = String(req.body?.purpose || "");
    if (purpose !== "withdrawal" && purpose !== "wallet_change") return res.status(400).json({ error: "Operaci\xF3n no v\xE1lida." });
    try {
      const payload = normalizedPayload(purpose, req.body?.payload);
      const recentSince = new Date(Date.now() - 6e4).toISOString();
      const { count } = await auth.client.from("email_security_challenges").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).gte("created_at", recentSince);
      if ((count || 0) > 0) return res.status(429).json({ error: "Espera un minuto antes de solicitar otro c\xF3digo." });
      const id = crypto3.randomUUID();
      const code = crypto3.randomInt(1e5, 1e6).toString();
      const { error } = await auth.client.from("email_security_challenges").insert({ id, user_id: auth.user.id, purpose, code_hash: digest(id, code), payload, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      if (error) throw error;
      const action = purpose === "withdrawal" ? "confirmar tu retiro" : "confirmar tu wallet de retiro";
      try {
        await sendEmail(auth.user.email, `C\xF3digo BitNode: ${code}`, `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#0b1020;color:#eef2ff;border-radius:14px"><h1 style="color:#9badff">BitNode</h1><p>Usa este c\xF3digo para ${action}:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700">${code}</p><p>Caduca en 10 minutos. Si no solicitaste esta acci\xF3n, ignora este mensaje.</p></div>`, `otp-${id}`);
      } catch (error2) {
        await auth.client.from("email_security_challenges").delete().eq("id", id);
        throw error2;
      }
      return res.json({ challengeId: id, expiresInSeconds: 600, maskedEmail: auth.user.email.replace(/^(.{2}).*(@.*)$/, "$1***$2") });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo enviar el c\xF3digo." });
    }
  });
  app2.post("/api/security/email-code/verify", async (req, res) => {
    const auth = await authenticated(req);
    if (!auth) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const challengeId = String(req.body?.challengeId || "");
    const code = String(req.body?.code || "").trim();
    const { data: challenge } = await auth.client.from("email_security_challenges").select("*").eq("id", challengeId).eq("user_id", auth.user.id).maybeSingle();
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() < Date.now()) return res.status(400).json({ error: "El c\xF3digo expir\xF3 o ya fue utilizado." });
    if (challenge.attempts >= 5) return res.status(429).json({ error: "Se agotaron los intentos. Solicita otro c\xF3digo." });
    if (!/^\d{6}$/.test(code) || !safeEqual(challenge.code_hash, digest(challengeId, code))) {
      await auth.client.from("email_security_challenges").update({ attempts: challenge.attempts + 1 }).eq("id", challengeId);
      return res.status(400).json({ error: "C\xF3digo incorrecto." });
    }
    const { data: consumed } = await auth.client.from("email_security_challenges").update({ consumed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", challengeId).is("consumed_at", null).select("id").maybeSingle();
    if (!consumed) return res.status(409).json({ error: "Este c\xF3digo ya fue utilizado." });
    const payload = challenge.payload;
    if (challenge.purpose === "wallet_change") {
      const { error: error2 } = await auth.client.auth.admin.updateUserById(auth.user.id, { user_metadata: { ...auth.user.user_metadata, wallet_bep20: String(payload.wallet) } });
      if (error2) return res.status(500).json({ error: "No se pudo guardar la wallet." });
      return res.json({ status: "verified", message: "Wallet confirmada y guardada." });
    }
    const amount = Number(payload.amount);
    const network = String(payload.network);
    const wallet = String(payload.wallet);
    const fee = withdrawalFee(amount);
    const start = /* @__PURE__ */ new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { data: today } = await auth.client.from("transactions").select("amount").eq("user_id", auth.user.id).eq("type", "withdraw").gte("created_at", start.toISOString());
    const used = (today || []).reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
    const validation = validateWithdrawalInput(amount, network, wallet, used);
    if (validation) return res.status(400).json({ error: validation });
    const id = `WDR-${crypto3.randomUUID()}`;
    const { error } = await auth.client.from("transactions").insert({ id, user_id: auth.user.id, username: auth.user.user_metadata?.username || auth.user.email?.split("@")[0], type: "withdraw", label: `Solicitud de retiro \xB7 ${network}`, amount: -amount, status: "pending", network, wallet, fee, net_amount: amount - fee, provider_status: "email_verified", created_at: (/* @__PURE__ */ new Date()).toISOString() });
    if (error) return res.status(500).json({ error: "No se pudo registrar el retiro." });
    await sendEmail(auth.user.email, "Retiro confirmado en BitNode", `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px"><h1>Retiro confirmado</h1><p>Solicitud: <b>${escapeHtml(id)}</b></p><p>Monto: <b>${amount.toFixed(2)} USDT</b></p><p>Comisi\xF3n: ${fee.toFixed(2)} USDT \xB7 Neto: ${(amount - fee).toFixed(2)} USDT</p><p>Wallet: ${escapeHtml(wallet)}</p></div>`, `withdrawal-confirmed-${id}`).catch(() => void 0);
    return res.status(201).json({ id, status: "pending", fee, netAmount: amount - fee, message: "Correo verificado. Solicitud registrada." });
  });
  app2.post("/api/email/welcome", async (req, res) => {
    const auth = await authenticated(req);
    if (!auth) return res.status(401).json({ error: "Sesi\xF3n requerida." });
    const { data: existing } = await auth.client.from("transactional_email_events").select("id").eq("user_id", auth.user.id).eq("kind", "welcome").maybeSingle();
    if (existing) return res.json({ status: "already_sent" });
    try {
      const name = escapeHtml(String(auth.user.user_metadata?.username || auth.user.email.split("@")[0]));
      const providerId = await sendEmail(auth.user.email, "Bienvenido a BitNode", `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#0b1020;color:#eef2ff;border-radius:14px"><h1 style="color:#9badff">Bienvenido a BitNode, ${name}</h1><p>Tu correo fue confirmado y tu cuenta ya est\xE1 lista.</p><p>Desde tu dashboard puedes activar nodos, completar tareas y administrar tus retiros con verificaci\xF3n por correo.</p></div>`, `welcome-${auth.user.id}`);
      await auth.client.from("transactional_email_events").insert({ user_id: auth.user.id, kind: "welcome", provider_id: providerId });
      return res.json({ status: "sent" });
    } catch {
      return res.status(503).json({ error: "No se pudo enviar el correo de bienvenida." });
    }
  });
}

// server/app.ts
function createApp() {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.set("trust proxy", 1);
  app2.use(helmet({ contentSecurityPolicy: false }));
  app2.use(express.json({ limit: "1mb" }));
  app2.use(express.urlencoded({ limit: "64kb", extended: true }));
  app2.use("/api", createApiRateLimiter());
  app2.use(
    ["/api/deposits", "/api/withdrawals", "/api/contracts", "/api/commissions"],
    createFinancialRateLimiter()
  );
  registerStorageProxy(app2);
  registerOAuthRoutes(app2);
  registerNowPaymentsRoutes(app2);
  registerWithdrawalRoutes(app2);
  registerCommissionRoutes(app2);
  registerSecureCommissionRoutes(app2);
  registerDepositRoutes(app2);
  registerAdminWithdrawalRoutes(app2);
  registerAdminMonthlyRoiRoutes(app2);
  registerEmailSecurityRoutes(app2);
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app2;
}
var app = createApp();
var app_default = app;
export {
  createApp,
  app_default as default
};
