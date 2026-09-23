import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPublicAddress, safeFetch, UnsafeUrlError } from "./safe-fetch";

const PUBLIC = "93.184.216.34";
const lookupTo =
  (map: Record<string, string[]>) =>
  async (host: string): Promise<string[]> => {
    const found = map[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  };

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local, CGNAT, metadata and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1", "127.8.9.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
      "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("allows public addresses", () => {
    for (const ip of [PUBLIC, "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("assertPublicUrl", () => {
  const lookup = lookupTo({ "example.com": [PUBLIC], "evil.test": ["127.0.0.1"], "mixed.test": [PUBLIC, "10.1.1.1"] });

  it("allows an http(s) URL whose every address is public", async () => {
    await expect(assertPublicUrl("https://example.com/a", lookup)).resolves.toBeUndefined();
  });

  it("refuses other schemes, IP literals in private ranges, localhost and any private answer", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://0x7f000001/",
      "http://2130706433/",
      "http://localhost:3000/",
      "http://evil.test/",
      "http://mixed.test/",
    ]) {
      await expect(assertPublicUrl(url, lookup), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });
});

describe("safeFetch", () => {
  const lookup = lookupTo({ "example.com": [PUBLIC], "a.example.com": [PUBLIC], "internal.test": ["10.0.0.5"] });

  it("re-checks every redirect hop and refuses one that lands on a private host", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: "http://internal.test/admin" } });
    };
    await expect(safeFetch("https://example.com/", { lookup, fetchImpl })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("follows a public redirect chain and reports the final URL", async () => {
    const fetchImpl = async (url: string) =>
      url === "https://example.com/"
        ? new Response(null, { status: 301, headers: { location: "/moved" } })
        : url === "https://example.com/moved"
          ? new Response(null, { status: 302, headers: { location: "https://a.example.com/final" } })
          : new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } });
    const res = await safeFetch("https://example.com/", { lookup, fetchImpl });
    expect(res.status).toBe(200);
    expect(res.url).toBe("https://a.example.com/final");
    expect(await res.text()).toBe("<html>ok</html>");
  });

  it("stops after too many redirects", async () => {
    let n = 0;
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: `/r${++n}` } });
    await expect(safeFetch("https://example.com/", { lookup, fetchImpl, maxRedirects: 3 })).rejects.toThrow(/redirect/i);
  });

  it("caps the body at maxBytes", async () => {
    const big = "x".repeat(3_000_000);
    const fetchImpl = async () => new Response(big, { status: 200, headers: { "content-type": "text/html" } });
    const res = await safeFetch("https://example.com/", { lookup, fetchImpl, maxBytes: 2_000_000 });
    expect((await res.text()).length).toBe(2_000_000);
    expect(res.truncated).toBe(true);
  });
});
