// Serve the Vite build and keep existing API routes on the verified Vercel origin.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    let target;
    try {
      target = new URL(env.API_ORIGIN);
      if (target.protocol !== "https:" || target.origin === incoming.origin ||
          target.username || target.password || target.pathname !== "/" ||
          target.search || target.hash) throw new Error("Invalid origin");
    } catch {
      return Response.json({ error: "API origin is not configured." }, {
        status: 503, headers: { "Cache-Control": "no-store" }
      });
    }
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("forwarded");
    headers.delete("x-forwarded-for");
    headers.delete("x-forwarded-host");
    headers.delete("x-forwarded-proto");
    headers.set("Cache-Control", "no-store");

    try {
      // Never automatically follow an API redirect with credentials attached.
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
        duplex: "half",
        cache: "no-store"
      });
      const response = new Response(upstream.body, upstream);
      response.headers.set("Cache-Control", "no-store");
      const location = response.headers.get("Location");
      if (location) {
        const redirect = new URL(location, target);
        if (redirect.origin === target.origin) {
          redirect.protocol = incoming.protocol;
          redirect.host = incoming.host;
          response.headers.set("Location", redirect.href);
        }
      }
      return response;
    } catch {
      return Response.json({ error: "API origin is unavailable." }, {
        status: 502, headers: { "Cache-Control": "no-store" }
      });
    }
  }
};
