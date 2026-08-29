import { createRequire } from 'module'; const require = createRequire(import.meta.url);

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
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
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
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
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
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token3) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token3.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
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
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
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
var NOWPAYMENTS_SANDBOX_URL = "https://api-sandbox.nowpayments.io/v1";
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
  const digest = crypto.createHmac("sha512", secret).update(JSON.stringify(sortObject(body))).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
function validDepositCurrency(value) {
  const currency = String(value || "").toLowerCase();
  return SUPPORTED_DEPOSIT_CURRENCIES.has(currency) ? currency : null;
}
function registerNowPaymentsRoutes(app2) {
  app2.post("/api/payments/nowpayments/invoice", async (req, res) => {
    try {
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      const admin3 = adminClient();
      const token3 = bearer(req);
      if (!apiKey || !admin3 || !token3) return res.status(401).json({ error: "Supabase Auth requerida." });
      const { data: authData, error: authError } = await admin3.auth.getUser(token3);
      if (authError || !authData.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
      const amount = Number(req.body?.amount);
      const payCurrency = validDepositCurrency(req.body?.payCurrency || "usdttrc20");
      if (!Number.isFinite(amount) || amount < 10 || amount > 1e5) return res.status(400).json({ error: "El monto debe estar entre 10 y 100000 USD." });
      if (!payCurrency) return res.status(400).json({ error: "Solo se permiten dep\xF3sitos USDT por TRC20 o BEP20." });
      const transactionId = `NP-${crypto.randomUUID()}`;
      const callbackUrl = `${origin(req)}/api/payments/nowpayments/ipn`;
      const response = await fetch(`${NOWPAYMENTS_SANDBOX_URL}/invoice`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          price_amount: amount,
          price_currency: "usd",
          pay_currency: payCurrency,
          order_id: transactionId,
          order_description: `BitNode deposit ${authData.user.id}`,
          ipn_callback_url: callbackUrl,
          success_url: `${origin(req)}/dashboard/deposit?payment=success`,
          cancel_url: `${origin(req)}/dashboard/deposit?payment=cancelled`
        })
      });
      const invoice = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(502).json({ error: "NOWPayments rechaz\xF3 la creaci\xF3n del invoice.", details: invoice });
      const { error: insertError } = await admin3.from("transactions").insert({
        id: transactionId,
        user_id: authData.user.id,
        username: authData.user.user_metadata?.username || authData.user.email?.split("@")[0] || null,
        type: "deposit",
        label: "Dep\xF3sito NOWPayments",
        amount,
        status: "pending",
        network: payCurrency,
        provider_payment_id: invoice.payment_id ? String(invoice.payment_id) : null,
        provider_status: "waiting",
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (insertError) return res.status(500).json({ error: "No se pudo registrar el dep\xF3sito.", details: insertError.message });
      return res.json({ transactionId, invoiceId: invoice.id || invoice.payment_id, invoiceUrl: invoice.invoice_url || invoice.pay_address || null, status: "pending" });
    } catch (error) {
      console.error("[NOWPayments] invoice error", error);
      return res.status(500).json({ error: "No se pudo iniciar el dep\xF3sito de prueba." });
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
import crypto2 from "node:crypto";
import { createClient as createClient2 } from "@supabase/supabase-js";
var NETWORKS = /* @__PURE__ */ new Set(["Ethereum", "Solana", "BNB Chain", "Polygon", "Arbitrum", "Bitcoin"]);
var LIMIT = 1e3;
var FEE_RATE = 0.015;
function admin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient2(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function token(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
function validWallet(network, wallet) {
  if (["Ethereum", "BNB Chain", "Polygon", "Arbitrum"].includes(network)) return /^0x[a-fA-F0-9]{40}$/.test(wallet);
  if (network === "Solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);
  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(wallet);
}
function validateWithdrawalInput(amount, network, wallet, usedToday) {
  if (!Number.isFinite(amount) || amount < 10 || amount > LIMIT) return "El retiro debe estar entre $10 y $1,000 USDT.";
  if (!NETWORKS.has(network) || !validWallet(network, wallet)) return "La red o la wallet no son v\xE1lidas.";
  if (usedToday + amount > LIMIT) return `L\xEDmite diario excedido. Ya solicitaste ${usedToday.toFixed(2)} USDT hoy.`;
  return null;
}
function registerWithdrawalRoutes(app2) {
  app2.post("/api/withdrawals/request", async (req, res) => {
    const client = admin();
    const accessToken = token(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    const amount = Number(req.body?.amount);
    const network = String(req.body?.network || "");
    const wallet = String(req.body?.wallet || "").trim();
    const fee = Math.max(1, amount * FEE_RATE);
    const basicError = validateWithdrawalInput(amount, network, wallet, 0);
    if (basicError) return res.status(400).json({ error: basicError });
    const start = /* @__PURE__ */ new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { data: today, error: historyError } = await client.from("transactions").select("amount,type").eq("user_id", data.user.id).eq("type", "withdraw").gte("created_at", start.toISOString());
    if (historyError) return res.status(500).json({ error: "No se pudo verificar el l\xEDmite diario." });
    const used = (today || []).reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
    const limitError = validateWithdrawalInput(amount, network, wallet, used);
    if (limitError) return res.status(400).json({ error: limitError });
    const id = `WDR-${crypto2.randomUUID()}`;
    const { error: insertError } = await client.from("transactions").insert({
      id,
      user_id: data.user.id,
      username: data.user.user_metadata?.username || data.user.email?.split("@")[0] || null,
      type: "withdraw",
      label: `Solicitud de retiro \xB7 ${network}`,
      amount: -amount,
      status: "pending",
      network,
      wallet,
      fee,
      net_amount: amount - fee,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      provider_status: "manual_review"
    });
    if (insertError) return res.status(500).json({ error: "No se pudo registrar la solicitud de retiro." });
    return res.status(201).json({ id, status: "pending", fee, netAmount: amount - fee, message: "Solicitud registrada para revisi\xF3n manual." });
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
  if (!client) throw new Error("Supabase server credentials are not configured.");
  const { data, error } = await client.from("commission_ledger").select("id, source_user_id, commission_type, amount, rate, leg, status, source_event_id, created_at, metadata").eq("beneficiary_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error(`Commission ledger query failed: ${error.message}`);
  const rows = data || [];
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
    const contract = contractsById.get(String(row.metadata?.contract_id || ""));
    return {
      ...row,
      source_username: profilesById.get(row.source_user_id) || "Usuario referido",
      node_name: contract ? plansById.get(contract.plan_id) || contract.plan_id : "Nodo no identificado",
      contract_amount: contract ? Number(contract.amount) : null
    };
  });
  const { data: volumeRows, error: volumeError } = await client.from("network_volume").select("leg, volume, matched_volume, updated_at").eq("user_id", userId);
  if (volumeError) throw new Error(`Network volume query failed: ${volumeError.message}`);
  const left = Number(volumeRows?.find((row) => row.leg === "left")?.volume || 0);
  const right = Number(volumeRows?.find((row) => row.leg === "right")?.volume || 0);
  const matched = Math.min(left, right);
  const updatedAt = volumeRows?.reduce((latest, row) => !latest || String(row.updated_at) > latest ? String(row.updated_at) : latest, null);
  const { data: networkNodes, error: networkError } = await client.from("network_nodes").select("user_id, parent_id, leg, sponsor_id").or(`user_id.eq.${userId},parent_id.eq.${userId},sponsor_id.eq.${userId}`);
  if (networkError) throw new Error(`Network tree query failed: ${networkError.message}`);
  const networkUserIds = Array.from(new Set((networkNodes || []).map((node) => node.user_id)));
  const { data: networkProfiles } = networkUserIds.length ? await client.from("profiles").select("id, username").in("id", networkUserIds) : { data: [] };
  const networkNamesById = new Map((networkProfiles || []).map((profile) => [profile.id, profile.username]));
  return {
    ...summarizeCommissionRows(rows),
    binaryVolume: {
      left,
      right,
      matched,
      status: matched > 0 ? "paired" : left > 0 || right > 0 ? "awaiting_pair" : "no_volume",
      updatedAt
    },
    entries: enrichedRows,
    networkNodes: (networkNodes || []).map((node) => ({
      ...node,
      username: networkNamesById.get(node.user_id) || "Usuario"
    }))
  };
}
async function activateContractAndCommissions(client, input) {
  if (!input.contractId || !input.label || !Number.isFinite(input.amount) || input.amount < 10) {
    throw new Error("Invalid contract activation input.");
  }
  const { data, error } = await client.rpc("activate_contract_and_commissions", {
    p_user_id: input.userId,
    p_contract_id: input.contractId,
    p_username: input.username || null,
    p_label: input.label,
    p_amount: input.amount
  });
  if (error) throw new Error(`Contract activation RPC failed: ${error.message}`);
  return data;
}
async function processConfirmedContractCommissions(client, userId, contractId) {
  const { data: transaction, error: transactionError } = await client.from("transactions").select("id, user_id, type, status, amount").eq("id", contractId).eq("user_id", userId).maybeSingle();
  if (transactionError) throw new Error(`Contract lookup failed: ${transactionError.message}`);
  if (!transaction || transaction.type !== "contract" || transaction.status !== "completed") {
    throw new Error("Only completed contract transactions can generate commissions.");
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
  app2.get("/api/commissions/summary", async (req, res) => {
    const client = adminClient2();
    const accessToken = bearer2(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
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
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    const contractId = String(req.body?.contractId || "").trim();
    const label = String(req.body?.label || "").trim();
    const amount = Number(req.body?.amount);
    if (!contractId || !label || !Number.isFinite(amount)) return res.status(400).json({ error: "Datos de contrato incompletos." });
    try {
      const result = await activateContractAndCommissions(client, {
        userId: data.user.id,
        contractId,
        username: data.user.user_metadata?.username || data.user.email?.split("@")[0],
        label,
        amount
      });
      return res.json(result);
    } catch (error2) {
      console.error("[Contracts] activation error", error2);
      return res.status(400).json({ error: error2 instanceof Error ? error2.message : "No se pudo activar el contrato." });
    }
  });
  app2.post("/api/commissions/contract-confirmed", async (req, res) => {
    const client = adminClient2();
    const accessToken = bearer2(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    const contractId = String(req.body?.contractId || "").trim();
    if (!contractId) return res.status(400).json({ error: "contractId es requerido." });
    try {
      const result = await processConfirmedContractCommissions(client, data.user.id, contractId);
      return res.json(result);
    } catch (error2) {
      console.error("[Commissions] contract confirmation error", error2);
      return res.status(400).json({ error: error2 instanceof Error ? error2.message : "No se pudo procesar la comisi\xF3n." });
    }
  });
}

// server/deposits.ts
import crypto3 from "node:crypto";
import { createClient as createClient4 } from "@supabase/supabase-js";
function admin2() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient4(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function token2(req) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}
function validateManualDeposit(amount) {
  if (!Number.isFinite(amount) || amount < 10 || amount > 1e5) return "El dep\xF3sito debe estar entre $10 y $100,000 USDT.";
  return null;
}
function registerDepositRoutes(app2) {
  app2.post("/api/deposits/request", async (req, res) => {
    const client = admin2();
    const accessToken = token2(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesi\xF3n Supabase requerida." });
    const { data, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !data.user) return res.status(401).json({ error: "Sesi\xF3n Supabase inv\xE1lida." });
    const amount = Number(req.body?.amount);
    const validationError = validateManualDeposit(amount);
    if (validationError) return res.status(400).json({ error: validationError });
    const id = `DEP-${crypto3.randomUUID()}`;
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

// server/security.ts
import rateLimit from "express-rate-limit";
var message = { error: "Demasiadas solicitudes; intenta m\xE1s tarde." };
function createApiRateLimiter(overrides = {}) {
  return rateLimit({ windowMs: 15 * 60 * 1e3, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, message, ...overrides });
}
function createFinancialRateLimiter(overrides = {}) {
  return rateLimit({ windowMs: 60 * 1e3, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "L\xEDmite de operaciones excedido; intenta m\xE1s tarde." }, ...overrides });
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
  registerDepositRoutes(app2);
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app2;
}

// api/[...path].ts
var app = createApp();
function handler(req, res) {
  return app(req, res);
}
export {
  handler as default
};
