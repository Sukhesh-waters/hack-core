/**
 * Server-side fetch of a URL someone else chose (C7.0, SSRF guard).
 *
 * Every URL a person pastes, or a crawler discovers, is fetched from our
 * servers. Without a check, `http://169.254.169.254/` (cloud metadata),
 * `http://localhost:3000/api/...` or a public page that redirects to either
 * would be read with our network position. This module:
 *   - allows http(s) only;
 *   - resolves the host and refuses it when ANY address is private, loopback,
 *     link-local, CGNAT, multicast or reserved (IPv4 and IPv6, including
 *     IPv4-mapped and NAT64 forms, and numeric host tricks like 0x7f000001);
 *   - follows redirects itself, re-checking every hop;
 *   - times out, and caps the body.
 *
 * Residual risk, accepted: DNS could change between our lookup and the
 * connection (rebinding). Closing that needs a pinned-address dispatcher; the
 * hosts we read are ordinary public sites, and the cap/timeout still apply.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export type Lookup = (host: string) => Promise<string[]>;
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
  });
}

/** Expands an IPv6 address to its 8 hextets. */
function v6Hextets(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hextets.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const parse = (s: string | undefined) => (s ? s.split(":").map((h) => parseInt(h, 16)) : []);
  const a = parse(head);
  const b = parse(tail);
  if (text.includes("::")) {
    const fill = 8 - a.length - b.length;
    if (fill < 0) return null;
    return [...a, ...Array(fill).fill(0), ...b];
  }
  return a.length === 8 ? a : null;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip.replace(/^\[|\]$/g, ""));
  if (family === 4) return v4Public(ip);
  if (family !== 6) return false;
  const h = v6Hextets(ip);
  if (!h || h.some((x) => Number.isNaN(x))) return false;
  const embeddedV4 = () => `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  if (h.every((x) => x === 0)) return false; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return false; // ::1
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return v4Public(embeddedV4()); // ::ffff:a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b) return v4Public(embeddedV4()); // NAT64
  if ((h[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return false; // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // documentation
  return true;
}

/** Throws UnsafeUrlError unless `raw` is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https addresses can be read.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("Addresses with a login in them can't be read.");
  // WHATWG URL already turns 0x7f000001 and 2130706433 into 127.0.0.1.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError("That address points inside a private network.");
  }
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => {
    throw new UnsafeUrlError(`Couldn't find the site ${host}.`);
  });
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new UnsafeUrlError("That address points inside a private network.");
  }
}

export type SafeResponse = {
  status: number;
  ok: boolean;
  /** The URL after redirects. */
  url: string;
  headers: Headers;
  /** True when the body was cut at maxBytes. */
  truncated: boolean;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes, truncated };
}

export async function safeFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    lookup?: Lookup;
    fetchImpl?: FetchImpl;
  } = {},
): Promise<SafeResponse> {
  const { method = "GET", headers, timeoutMs = 10_000, maxBytes = 2_000_000, maxRedirects = 5 } = options;
  const lookup = options.lookup ?? defaultLookup;
  const fetchImpl: FetchImpl = options.fetchImpl ?? ((u, init) => fetch(u, init));
  const signal = AbortSignal.timeout(timeoutMs);

  let current = url;
  for (let hop = 0; ; hop += 1) {
    await assertPublicUrl(current, lookup);
    const res = await fetchImpl(current, { method, headers, redirect: "manual", signal });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      if (hop >= maxRedirects) throw new Error(`Too many redirects reading ${url}.`);
      current = new URL(location, current).toString();
      continue;
    }
    const { bytes, truncated } = method === "HEAD" ? { bytes: new Uint8Array(0), truncated: false } : await readCapped(res, maxBytes);
    return {
      status: res.status,
      ok: res.ok,
      url: current,
      headers: res.headers,
      truncated,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
  }
}
