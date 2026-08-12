export interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ASSETS: Fetcher;
  VOTE_ROOM: DurableObjectNamespace;
  ADMIN_PASSWORD: string;
  VOTER_SECRET: string;
}

interface PhotoRow {
  id: string;
  beard_day: number;
  object_key: string;
  original_name: string;
  mime_type: string;
  taken_at: string | null;
  created_at: string;
}

interface VoteRow {
  voter_key: string;
  ip_key: string;
  beard_day: number;
}

const encoder = new TextEncoder();
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const defaultBackgroundColor = "#f2df64";
const defaultLogoFont = "instrument-serif";
const defaultBodyFont = "dm-mono";
const allowedFonts = new Set([
  "instrument-serif", "dm-mono", "cormorant-garamond", "playfair-display", "bodoni-moda",
  "fraunces", "space-grotesk", "syne", "libre-baskerville", "manrope",
]);

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  return base64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const [aHash, bHash] = await Promise.all([sha256(a), sha256(b)]);
  if (aHash.length !== bHash.length) return false;
  let result = 0;
  for (let index = 0; index < aHash.length; index += 1) {
    result |= aHash.charCodeAt(index) ^ bHash.charCodeAt(index);
  }
  return result === 0;
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const session = getCookie(request, "beard_admin");
  if (!session) return false;
  const [expires, signature] = session.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = await sign(`admin:${expires}`, env.VOTER_SECRET);
  return safeEqual(signature, expected);
}

async function adminLogin(request: Request, env: Env): Promise<Response> {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!body.password || !(await safeEqual(body.password, env.ADMIN_PASSWORD))) {
    return json({ error: "Wrong password" }, 401);
  }
  const expires = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const signature = await sign(`admin:${expires}`, env.VOTER_SECRET);
  return json(
    { ok: true },
    200,
    { "set-cookie": `beard_admin=${expires}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` },
  );
}

function adminLogout(): Response {
  return json(
    { ok: true },
    200,
    { "set-cookie": "beard_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" },
  );
}

function serializePhoto(photo: PhotoRow, admin = false) {
  return {
    id: photo.id,
    beardDay: photo.beard_day,
    url: `/media/${photo.id}`,
    takenAt: photo.taken_at,
    ...(admin ? { originalName: photo.original_name, createdAt: photo.created_at } : {}),
  };
}

function parseBackgroundColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function parseFont(value: unknown): string | null {
  return typeof value === "string" && allowedFonts.has(value) ? value : null;
}

async function getSiteSettings(env: Env): Promise<{ backgroundColor: string; logoFont: string; bodyFont: string }> {
  try {
    const result = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('background_color', 'logo_font', 'body_font')",
    ).all<{ key: string; value: string }>();
    const settings = new Map(result.results.map((setting) => [setting.key, setting.value]));
    return {
      backgroundColor: parseBackgroundColor(settings.get("background_color")) ?? defaultBackgroundColor,
      logoFont: parseFont(settings.get("logo_font")) ?? defaultLogoFont,
      bodyFont: parseFont(settings.get("body_font")) ?? defaultBodyFont,
    };
  } catch {
    return { backgroundColor: defaultBackgroundColor, logoFont: defaultLogoFont, bodyFont: defaultBodyFont };
  }
}

async function gallery(env: Env, admin = false): Promise<Response> {
  const [results, settings] = await Promise.all([
    env.DB.prepare(
      "SELECT id, beard_day, object_key, original_name, mime_type, taken_at, created_at FROM photos ORDER BY beard_day, created_at",
    ).all<PhotoRow>(),
    getSiteSettings(env),
  ]);
  const photos = results.results.map((photo) => serializePhoto(photo, admin));
  const maxDay = photos.reduce((max, photo) => Math.max(max, photo.beardDay), 0);
  return json({ photos, maxDay, ...settings });
}

async function servePhoto(id: string, env: Env): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const object = await env.PHOTOS.getWithMetadata<{ contentType: string }>(`photos/${id}`, "arrayBuffer");
  if (!object.value) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "content-type": object.metadata?.contentType ?? "image/webp" });
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.value, { headers });
}

function parseDay(value: unknown): number | null {
  const day = typeof value === "number" ? value : Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 10000 ? day : null;
}

function parseTakenAt(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function uploadPhotos(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const beardDay = parseDay(form.get("beardDay"));
  if (beardDay === null) return json({ error: "Enter a valid beard day" }, 400);

  let metadata: Array<{ name?: string; originalName?: string; lastModified?: number; takenAt?: string | null }> = [];
  try {
    metadata = JSON.parse(String(form.get("metadata") ?? "[]"));
  } catch {
    // Capture metadata is optional.
  }

  const files = form.getAll("photos").filter((entry): entry is File => entry instanceof File);
  if (!files.length) return json({ error: "Choose at least one photo" }, 400);
  if (files.length > 25) return json({ error: "Upload up to 25 photos at a time" }, 400);

  const created: ReturnType<typeof serializePhoto>[] = [];
  for (const [fileIndex, file] of files.entries()) {
    if (file.type !== "image/webp" || file.size > 25 * 1024 * 1024) {
      return json({ error: `${file.name} must be a WebP image smaller than 25 MB` }, 400);
    }
    const id = crypto.randomUUID();
    const objectKey = `photos/${id}`;
    const detail = metadata[fileIndex] ?? metadata.find((item) => item.name === file.name);
    const takenAt = parseTakenAt(detail?.takenAt);
    await env.PHOTOS.put(objectKey, await file.arrayBuffer(), {
      metadata: { contentType: file.type || "image/webp" },
    });
    try {
      await env.DB.prepare(
        "INSERT INTO photos (id, beard_day, object_key, original_name, mime_type, taken_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(id, beardDay, objectKey, detail?.originalName ?? file.name, file.type, takenAt).run();
    } catch (error) {
      await env.PHOTOS.delete(objectKey);
      throw error;
    }
    created.push({ id, beardDay, url: `/media/${id}`, takenAt, originalName: detail?.originalName ?? file.name, createdAt: new Date().toISOString() });
  }
  return json({ photos: created }, 201);
}

async function updatePhoto(id: string, request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ beardDay?: unknown; takenAt?: unknown }>();
  const beardDay = parseDay(body.beardDay);
  if (beardDay === null) return json({ error: "Enter a valid beard day" }, 400);
  const takenAt = parseTakenAt(body.takenAt);
  const result = await env.DB.prepare("UPDATE photos SET beard_day = ?, taken_at = ? WHERE id = ?")
    .bind(beardDay, takenAt, id).run();
  if (!result.meta.changes) return json({ error: "Photo not found" }, 404);
  return json({ ok: true });
}

async function deletePhoto(id: string, env: Env): Promise<Response> {
  const photo = await env.DB.prepare("SELECT object_key FROM photos WHERE id = ?").bind(id).first<{ object_key: string }>();
  if (!photo) return json({ error: "Photo not found" }, 404);
  await env.PHOTOS.delete(photo.object_key);
  await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function updateSettings(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ backgroundColor?: unknown; logoFont?: unknown; bodyFont?: unknown }>();
  const updates: Array<{ key: string; value: string }> = [];
  if (body.backgroundColor !== undefined) {
    const value = parseBackgroundColor(body.backgroundColor);
    if (!value) return json({ error: "Choose a valid color" }, 400);
    updates.push({ key: "background_color", value });
  }
  if (body.logoFont !== undefined) {
    const value = parseFont(body.logoFont);
    if (!value) return json({ error: "Choose a valid logo font" }, 400);
    updates.push({ key: "logo_font", value });
  }
  if (body.bodyFont !== undefined) {
    const value = parseFont(body.bodyFont);
    if (!value) return json({ error: "Choose a valid site font" }, 400);
    updates.push({ key: "body_font", value });
  }
  if (!updates.length) return json({ error: "No settings to update" }, 400);
  await env.DB.batch(updates.map(({ key, value }) => env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, value)));
  return json({ ok: true, ...(await getSiteSettings(env)) });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes.buffer);
}

async function voterIdentity(request: Request, env: Env) {
  const existingToken = getCookie(request, "beard_voter");
  const token = existingToken && /^[A-Za-z0-9_-]{40,60}$/.test(existingToken) ? existingToken : randomToken();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
  const [voterKey, ipKey] = await Promise.all([
    sha256(`${env.VOTER_SECRET}:voter:${token}`),
    sha256(`${env.VOTER_SECRET}:ip:${ip}`),
  ]);
  return { voterKey, ipKey, token, shouldSetCookie: token !== existingToken };
}

function voterCookie(token: string): string {
  return `beard_voter=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

async function findVote(request: Request, env: Env) {
  const identity = await voterIdentity(request, env);
  const vote = await env.DB.prepare(
    "SELECT voter_key, ip_key, beard_day FROM votes WHERE voter_key = ? OR ip_key = ? LIMIT 1",
  ).bind(identity.voterKey, identity.ipKey).first<VoteRow>();
  return { identity, vote };
}

async function voteStatus(request: Request, env: Env): Promise<Response> {
  const [{ identity, vote }, admin] = await Promise.all([findVote(request, env), isAdmin(request, env)]);
  return json(
    { hasVoted: Boolean(vote), beardDay: vote?.beard_day ?? null, isAdmin: admin },
    200,
    identity.shouldSetCookie ? { "set-cookie": voterCookie(identity.token) } : {},
  );
}

async function voteResults(env: Env): Promise<Array<{ beardDay: number; votes: number }>> {
  const result = await env.DB.prepare(
    "SELECT beard_day, COUNT(*) AS votes FROM votes GROUP BY beard_day ORDER BY beard_day",
  ).all<{ beard_day: number; votes: number }>();
  return result.results.map((row) => ({ beardDay: row.beard_day, votes: Number(row.votes) }));
}

async function publicVoteResults(request: Request, env: Env): Promise<Response> {
  const [{ vote }, admin] = await Promise.all([findVote(request, env), isAdmin(request, env)]);
  if (!vote && !admin) return json({ error: "Vote first to see results" }, 403);
  return json({ results: await voteResults(env) });
}

async function submitVote(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ beardDay?: unknown }>();
  const beardDay = parseDay(body.beardDay);
  if (beardDay === null) return json({ error: "Choose a beard day" }, 400);
  const eligibleDay = await env.DB.prepare("SELECT 1 AS eligible FROM photos WHERE beard_day = ? LIMIT 1")
    .bind(beardDay).first<{ eligible: number }>();
  if (!eligibleDay) return json({ error: "That beard day is not available" }, 400);

  const { identity, vote } = await findVote(request, env);
  if (vote) {
    await env.DB.prepare(
      "UPDATE votes SET beard_day = ?, updated_at = datetime('now') WHERE voter_key = ?",
    ).bind(beardDay, vote.voter_key).run();
  } else {
    try {
      await env.DB.prepare(
        "INSERT INTO votes (voter_key, ip_key, beard_day) VALUES (?, ?, ?)",
      ).bind(identity.voterKey, identity.ipKey, beardDay).run();
    } catch {
      await env.DB.prepare(
        "UPDATE votes SET beard_day = ?, updated_at = datetime('now') WHERE ip_key = ?",
      ).bind(beardDay, identity.ipKey).run();
    }
  }

  const room = env.VOTE_ROOM.get(env.VOTE_ROOM.idFromName("global"));
  await room.fetch("https://vote-room.internal/broadcast", { method: "POST" });
  return json(
    { ok: true, beardDay },
    200,
    identity.shouldSetCookie ? { "set-cookie": voterCookie(identity.token) } : {},
  );
}

async function liveVotes(request: Request, env: Env): Promise<Response> {
  const [{ vote }, admin] = await Promise.all([findVote(request, env), isAdmin(request, env)]);
  if (!vote && !admin) return json({ error: "Vote first to see results" }, 403);
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "WebSocket required" }, 426);
  }
  const room = env.VOTE_ROOM.get(env.VOTE_ROOM.idFromName("global"));
  return room.fetch(request);
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("content-security-policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/gallery" && request.method === "GET") return gallery(env);
  if (path === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
  if (path === "/api/admin/logout" && request.method === "POST") return adminLogout();
  if (path === "/api/admin/status" && request.method === "GET") return json({ authenticated: await isAdmin(request, env) });
  if (path === "/api/vote/status" && request.method === "GET") return voteStatus(request, env);
  if (path === "/api/votes" && request.method === "PUT") return submitVote(request, env);
  if (path === "/api/votes/results" && request.method === "GET") return publicVoteResults(request, env);
  if (path === "/api/votes/live" && request.method === "GET") return liveVotes(request, env);

  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) return json({ error: "Unauthorized" }, 401);
    if (path === "/api/admin/photos" && request.method === "GET") return gallery(env, true);
    if (path === "/api/admin/photos" && request.method === "POST") return uploadPhotos(request, env);
    if (path === "/api/admin/settings" && request.method === "PATCH") return updateSettings(request, env);
    const match = path.match(/^\/api\/admin\/photos\/([0-9a-f-]{36})$/i);
    if (match && request.method === "PATCH") return updatePhoto(match[1], request, env);
    if (match && request.method === "DELETE") return deletePhoto(match[1], env);
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      let response: Response;
      if (url.pathname.startsWith("/api/")) {
        response = await handleApi(request, env, url.pathname);
      } else if (url.pathname.startsWith("/media/")) {
        response = await servePhoto(url.pathname.slice("/media/".length), env);
      } else {
        response = await env.ASSETS.fetch(request);
      }
      if (response.status === 101) return response;
      return withSecurityHeaders(response);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(json({ error: "Something went wrong" }, 500));
    }
  },
} satisfies ExportedHandler<Env>;

export class VoteRoom {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      await this.broadcast();
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "results", results: await voteResults(this.env) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async broadcast(): Promise<void> {
    const message = JSON.stringify({ type: "results", results: await voteResults(this.env) });
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Please reconnect");
      }
    }
  }
}
