const encoder = new TextEncoder();
const SESSION_DAYS = 7;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
function fail(message, status = 400) { return json({ error: message }, status); }
function id() { return crypto.randomUUID(); }
function b64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function sha256(value) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function passwordHash(password, saltText) {
  const salt = saltText ? unb64(saltText) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, key, 256
  );
  return `${b64(salt)}.${b64(bits)}`;
}
async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(".");
  const actual = await passwordHash(password, salt);
  return actual.split(".")[1] === expected;
}
function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
function cookie(token, maxAge) {
  return `nexus_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function clearCookie() {
  return "nexus_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}
async function body(request) {
  try { return await request.json(); } catch { return null; }
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}
async function currentUser(request, env) {
  const token = cookieValue(request, "nexus_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, users.role, users.status
     FROM sessions JOIN users ON users.id=sessions.user_id
     WHERE sessions.token_hash=? AND sessions.expires_at>?`
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  if (!row || row.status !== "active") return null;
  return row;
}
async function requireUser(request, env) {
  const user = await currentUser(request, env);
  return user || null;
}
async function requireOwner(request, env) {
  const user = await currentUser(request, env);
  return user && user.role === "owner" ? user : null;
}
async function log(env, actor, action, targetType = null, targetId = null, details = null) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id,actor_id,action,target_type,target_id,details) VALUES (?,?,?,?,?,?)"
  ).bind(id(), actor?.id || null, action, targetType, targetId, details ? JSON.stringify(details) : null).run();
}
async function createSession(env, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(await sha256(token), userId, expires).run();
  return token;
}
async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method !== "GET" && !sameOrigin(request)) return fail("Invalid request origin.", 403);

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, hostingNode: "not_connected", message: "Nexus API is online. No Minecraft node is connected yet." });
  }

  if (path === "/api/register" && method === "POST") {
    const data = await body(request);
    if (!data || typeof data.email !== "string" || typeof data.password !== "string") return fail("Enter an email and password.");
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
    if (data.password.length < 10 || data.password.length > 128) return fail("Password must be 10–128 characters.");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) return fail("An account with that email already exists.", 409);
    const userId = id();
    const hash = await passwordHash(data.password);
    const role = env.OWNER_EMAIL && email === env.OWNER_EMAIL.trim().toLowerCase() ? "owner" : "customer";
    await env.DB.prepare("INSERT INTO users(id,email,password_hash,role) VALUES (?,?,?,?)")
      .bind(userId, email, hash, role).run();
    const token = await createSession(env, userId);
    await log(env, { id: userId }, "account_registered", "user", userId);
    return json({ user: { id: userId, email, role } }, 201, { "set-cookie": cookie(token, SESSION_DAYS * 86400) });
  }

  if (path === "/api/login" && method === "POST") {
    const data = await body(request);
    if (!data || typeof data.email !== "string" || typeof data.password !== "string") return fail("Enter your email and password.");
    const user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(data.email.trim().toLowerCase()).first();
    if (!user || !(await verifyPassword(data.password, user.password_hash))) return fail("Email or password is incorrect.", 401);
    if (user.status !== "active") return fail("This account is suspended. Contact the owner.", 403);
    const token = await createSession(env, user.id);
    await log(env, user, "logged_in", "user", user.id);
    return json({ user: { id: user.id, email: user.email, role: user.role } }, 200, { "set-cookie": cookie(token, SESSION_DAYS * 86400) });
  }

  if (path === "/api/logout" && method === "POST") {
    const token = cookieValue(request, "nexus_session");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (path === "/api/me" && method === "GET") {
    const user = await requireUser(request, env);
    return user ? json({ user }) : fail("Not signed in.", 401);
  }

  const user = await requireUser(request, env);
  if (!user) return fail("Please sign in.", 401);

  if (path === "/api/servers" && method === "GET") {
    const rows = user.role === "owner"
      ? await env.DB.prepare("SELECT servers.*, users.email AS customer_email FROM servers JOIN users ON users.id=servers.owner_id ORDER BY servers.created_at DESC").all()
      : await env.DB.prepare("SELECT * FROM servers WHERE owner_id=? ORDER BY created_at DESC").bind(user.id).all();
    return json({ servers: rows.results || [] });
  }

  if (path === "/api/servers" && method === "POST") {
    const data = await body(request);
    if (!data || typeof data.name !== "string" || !["Java", "Bedrock"].includes(data.edition)) return fail("Enter a server name and choose Java or Bedrock.");
    const name = data.name.trim();
    if (!name || name.length > 32) return fail("Server name must be 1–32 characters.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM servers WHERE owner_id=?").bind(user.id).first();
    if (count.n >= 3 && user.role !== "owner") return fail("Starter limit reached: maximum 3 server records.");
    const serverId = id();
    await env.DB.prepare("INSERT INTO servers(id,owner_id,name,edition) VALUES (?,?,?,?)")
      .bind(serverId, user.id, name, data.edition).run();
    await log(env, user, "server_record_created", "server", serverId, { name, edition: data.edition });
    return json({ server: { id: serverId, name, edition: data.edition, status: "node_not_connected" } }, 201);
  }

  const serverMatch = path.match(/^\/api\/servers\/([a-f0-9-]+)(?:\/(start|stop|restart|console|delete))?$/i);
  if (serverMatch) {
    const serverId = serverMatch[1];
    const action = serverMatch[2] || null;
    const server = await env.DB.prepare("SELECT * FROM servers WHERE id=?").bind(serverId).first();
    if (!server) return fail("Server not found.", 404);
    if (user.role !== "owner" && server.owner_id !== user.id) return fail("You cannot access this server.", 403);
    if (method === "GET" && !action) return json({ server });
    if (method === "DELETE" && action === "delete") {
      await env.DB.prepare("DELETE FROM servers WHERE id=?").bind(serverId).run();
      await log(env, user, "server_record_deleted", "server", serverId);
      return json({ ok: true });
    }
    if (method === "POST" && ["start","stop","restart","console"].includes(action)) {
      // Deliberately do not fake live controls. Add a verified node adapter before enabling these.
      return fail("No hosting node is connected. This action is disabled until a real node is configured.", 503);
    }
  }

  if (path === "/api/admin/customers" && method === "GET") {
    if (user.role !== "owner") return fail("Owner access required.", 403);
    const rows = await env.DB.prepare("SELECT id,email,role,status,created_at FROM users ORDER BY created_at DESC").all();
    return json({ customers: rows.results || [] });
  }
  if (path.match(/^\/api\/admin\/customers\/[a-f0-9-]+\/suspend$/i) && method === "POST") {
    if (user.role !== "owner") return fail("Owner access required.", 403);
    const customerId = path.split("/")[4];
    if (customerId === user.id) return fail("You cannot suspend your own owner account.");
    await env.DB.prepare("UPDATE users SET status='suspended' WHERE id=? AND role='customer'").bind(customerId).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(customerId).run();
    await log(env, user, "customer_suspended", "user", customerId);
    return json({ ok: true });
  }
  if (path === "/api/admin/audit" && method === "GET") {
    if (user.role !== "owner") return fail("Owner access required.", 403);
    const rows = await env.DB.prepare("SELECT audit_logs.*, users.email AS actor_email FROM audit_logs LEFT JOIN users ON users.id=audit_logs.actor_id ORDER BY audit_logs.created_at DESC LIMIT 100").all();
    return json({ logs: rows.results || [] });
  }
  return fail("Route not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env); }
      catch (e) { return fail("Server error. Check Worker logs and database setup.", 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
