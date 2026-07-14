// B0c — RULING 2026-07-15: installable home-screen web app (NOT a native app).
// The existing responsive web app becomes installable on the three iPhones:
//   1. GET /manifest.webmanifest → 200 application/manifest+json, parses, and
//      carries the required fields (name, display standalone, 192+512 PNG icons
//      whose src routes actually serve);
//   2. icon routes (apple-touch-icon 180 + manifest 192/512) → 200 image/png,
//      real PNG bytes with the exact declared dimensions, non-trivial length;
//   3. index.html carries the manifest/apple-touch-icon links and the iOS
//      standalone meta tags (capable, status-bar-style, title, theme-color);
//   4. PIN regression guard (ADR-0032 static-shell class): with a PIN configured,
//      the PWA static routes stay reachable WITHOUT a session — they are code/
//      branding, never pipeline data — while a data route still 401s.
// Every server test tears down BOTH handles (server.stop(true) + db.close()).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { initDb } from "../src/db/init";
import { makeServer } from "../src/api/server";

const GREEK = /\p{Script=Greek}/u;
const PIN = "482913";

const MANIFEST_ROUTE = "/manifest.webmanifest";
const ICON_ROUTES = {
  appleTouch: { path: "/icons/apple-touch-icon.png", size: 180 },
  icon192: { path: "/icons/icon-192.png", size: 192 },
  icon512: { path: "/icons/icon-512.png", size: 512 },
} as const;

let db: Database;
let server: Server | null = null;
let base = "";

beforeEach(() => {
  db = initDb(":memory:");
});

afterEach(() => {
  server?.stop(true); // force-close — a leaked handle keeps `bun test` alive
  server = null;
  db.close();
});

/** Starts a server on the module-level handle so afterEach always tears it down. */
function start(opts?: { hostname?: string; pin?: string }): Server {
  server = makeServer(db, 0, opts);
  base = `http://127.0.0.1:${server.port}`;
  return server;
}

/** Reads a PNG response: verifies the magic bytes and returns size + IHDR dimensions. */
async function pngInfo(res: Response): Promise<{ bytes: number; width: number; height: number }> {
  const buf = new Uint8Array(await res.arrayBuffer());
  const MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < MAGIC.length; i++) {
    expect(buf[i]).toBe(MAGIC[i]!); // real PNG bytes, not an error page
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { bytes: buf.byteLength, width: dv.getUint32(16), height: dv.getUint32(20) };
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
}

interface Manifest {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

// ─── 1. Web app manifest ─────────────────────────────────────────────────────

describe("B0c manifest: GET /manifest.webmanifest", () => {
  test("200 with a manifest JSON content type and a parseable body", async () => {
    start();
    const res = await fetch(`${base}${MANIFEST_ROUTE}`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/application\/(manifest\+json|json)/);
    const manifest = (await res.json()) as Manifest; // throws if not JSON
    expect(typeof manifest).toBe("object");
  });

  test("carries the required install fields: name/short_name Constructor, standalone, start_url /", async () => {
    start();
    const manifest = (await (await fetch(`${base}${MANIFEST_ROUTE}`)).json()) as Manifest;
    expect(manifest.name).toBe("Constructor");
    expect(manifest.short_name).toBe("Constructor");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  test("theme/background colors match the app chrome (dark-navy theme, app body background)", async () => {
    start();
    const manifest = (await (await fetch(`${base}${MANIFEST_ROUTE}`)).json()) as Manifest;
    expect(manifest.theme_color).toBe("#111827"); // index.html theme-color / app chrome
    expect(manifest.background_color).toBe("#f4f4f5"); // app body background — seamless launch
  });

  test("icons array declares 192 and 512 PNGs and each declared src actually serves", async () => {
    start();
    const manifest = (await (await fetch(`${base}${MANIFEST_ROUTE}`)).json()) as Manifest;
    expect(Array.isArray(manifest.icons)).toBe(true);
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find((i) => i.sizes === size);
      expect(icon).toBeDefined();
      expect(icon!.type).toBe("image/png");
      const res = await fetch(`${base}${icon!.src}`);
      expect(res.status).toBe(200); // a manifest pointing at a 404 icon does not install
    }
  });
});

// ─── 2. Icon routes ──────────────────────────────────────────────────────────

describe("B0c icons: PNG routes serve real images at the declared dimensions", () => {
  for (const [label, { path, size }] of Object.entries(ICON_ROUTES)) {
    test(`GET ${path} → 200 image/png, ${size}x${size}, non-trivial byte length (${label})`, async () => {
      start();
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("image/png");
      const info = await pngInfo(res);
      expect(info.width).toBe(size);
      expect(info.height).toBe(size);
      expect(info.bytes).toBeGreaterThan(500); // a real rasterized mark, not a stub
    });
  }
});

// ─── 3. index.html install/standalone tags ───────────────────────────────────

describe("B0c shell: index.html carries the manifest link and iOS standalone tags", () => {
  test("GET / links the manifest and the apple-touch-icon", async () => {
    start();
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain(`rel="manifest"`);
    expect(html).toContain(`href="${MANIFEST_ROUTE}"`);
    expect(html).toContain(`rel="apple-touch-icon"`);
    expect(html).toContain(`href="${ICON_ROUTES.appleTouch.path}"`);
  });

  test("GET / carries the iOS standalone meta tags (capable, status-bar-style, title, theme-color)", async () => {
    start();
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain(`name="apple-mobile-web-app-capable" content="yes"`);
    expect(html).toContain(`name="apple-mobile-web-app-status-bar-style"`);
    expect(html).toContain(`name="apple-mobile-web-app-title" content="Constructor"`);
    expect(html).toContain(`name="theme-color" content="#111827"`);
  });
});

// ─── 4. PIN regression guard (ADR-0032 static-shell class) ───────────────────

describe("B0c PIN gate: PWA static routes are shell (no session), data stays gated", () => {
  test("with a PIN configured, manifest + icons + shell serve 200 WITHOUT a session", async () => {
    start({ pin: PIN });
    const staticPaths = [
      MANIFEST_ROUTE,
      ICON_ROUTES.appleTouch.path,
      ICON_ROUTES.icon192.path,
      ICON_ROUTES.icon512.path,
      "/",
      "/app.js",
    ];
    for (const path of staticPaths) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200); // code/branding only — never pipeline data
    }
  });

  test("with a PIN configured, a data route still 401s without a session (Greek JSON)", async () => {
    start({ pin: PIN });
    const res = await fetch(`${base}/projects`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(GREEK);
  });
});
