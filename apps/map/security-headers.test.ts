// The security headers have to stay compatible with three things the app
// actually does, each of which a tightened policy has silently switched off
// before: Cesium instantiates WebAssembly to draw the globe, voice control
// asks for the microphone, and `?embed=1` is meant to be put in an iframe.
// A page that loads its chrome and never draws the map looks like a slow
// network rather than a header, so these assert the policy directly. The ISS
// dossier's embedded NASA stream is a fourth: without frame-src it is a blank box.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "./next.config";

type Rule = {
  source: string;
  has?: Array<{ type: string; key: string; value?: string }>;
  missing?: Array<{ type: string; key: string; value?: string }>;
  headers: Array<{ key: string; value: string }>;
};

const allRules = async (): Promise<Rule[]> => (await config.headers!()) as unknown as Rule[];
const get = (r: Rule, key: string) => r.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
/** The security rules (the ones carrying a CSP); the /embed cache rule is checked on its own below. */
const rules = async (): Promise<Rule[]> => (await allRules()).filter((r) => get(r, "content-security-policy"));
/** The rule that serves a normal page: the one that opts out of `embed=1`. */
const plain = (rs: Rule[]) => rs.find((r) => r.missing?.some((m) => m.key === "embed"))!;
/** The rule that serves the documented iframe view. */
const embed = (rs: Rule[]) => rs.find((r) => r.has?.some((h) => h.key === "embed"))!;

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(name + " "))!;

describe("security headers", () => {
  it("adds only the embedder-weights cache rule besides the security rules, and it sets no security header", async () => {
    const extra = (await allRules()).filter((r) => !get(r, "content-security-policy"));
    expect(extra.map((r) => r.source)).toEqual(["/embed/:path*"]);
    // The weights' path carries the model pin (lib/embed/pins.ts) and each file is sha256-checked.
    expect(extra[0].headers).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
  });

  it("covers every request with exactly one rule", async () => {
    const rs = await rules();
    expect(rs).toHaveLength(2);
    for (const r of rs) expect(r.source).toBe("/:path*");
    // The two conditions are exact complements, so no request falls through
    // uncovered and none collects both policies.
    expect(plain(rs).missing).toEqual(embed(rs).has);
  });

  it("lets Cesium instantiate WebAssembly, without opening up eval", async () => {
    for (const r of await rules()) {
      const scriptSrc = directive(get(r, "content-security-policy")!, "script-src");
      expect(scriptSrc).toContain("'wasm-unsafe-eval'");
      expect(scriptSrc.split(/\s+/)).not.toContain("'unsafe-eval'");
    }
  });

  it("lets the ISS dossier frame YouTube's privacy-enhanced player, and no other host", async () => {
    // Without a frame-src, default-src 'self' blocks the stream's iframe.
    for (const r of await rules()) {
      const frameSrc = directive(get(r, "content-security-policy")!, "frame-src");
      expect(frameSrc).toBe("frame-src 'self' https://www.youtube-nocookie.com");
    }
  });

  it("leaves the microphone available to voice control and nothing else open", async () => {
    for (const r of await rules()) {
      const pp = get(r, "permissions-policy")!;
      expect(pp).toContain("microphone=(self)");
      for (const feature of ["camera", "geolocation", "payment", "usb"]) {
        expect(pp).toContain(`${feature}=()`);
      }
    }
  });

  it("refuses framing everywhere except the documented embed view", async () => {
    const rs = await rules();
    const p = plain(rs);
    expect(directive(get(p, "content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(get(p, "X-Frame-Options")).toBe("DENY");

    const e = embed(rs);
    expect(directive(get(e, "content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors https:");
    // X-Frame-Options has no "any origin" value; leaving it off is what lets
    // frame-ancestors decide.
    expect(get(e, "X-Frame-Options")).toBeUndefined();
  });

  it("lets the browser fetch every tile host the terrain & soil pictures and the keyless terrain read directly", async () => {
    // Cesium loads imagery as images (img-src) and terrain tiles with fetch (connect-src).
    const { DIRECT_SOURCES } = await import("@/lib/terrain/products");
    const allows = (directive: string, host: string) => {
      const tokens = directive.split(/\s+/).slice(1);
      return tokens.includes("https:") || tokens.some((t) => t === `https://${host}` || (t.startsWith("https://*.") && host.endsWith(t.slice(9))));
    };
    for (const r of await rules()) {
      const csp = get(r, "content-security-policy")!;
      for (const d of DIRECT_SOURCES) {
        expect(allows(directive(csp, "img-src"), d.host), `img-src ${d.host}`).toBe(true);
        expect(allows(directive(csp, "connect-src"), d.host), `connect-src ${d.host}`).toBe(true);
      }
    }
  });

  it("lets the camera dossier show every agency's still image (https only)", async () => {
    // The info panel draws each camera's still with <img>; upgrade-insecure-requests would break an http host.
    const { CAMERA_IMAGE_HOSTS } = await import("@/lib/cameras/agencies");
    for (const r of await rules()) {
      const imgSrc = directive(get(r, "content-security-policy")!, "img-src").split(/\s+/).slice(1);
      for (const host of CAMERA_IMAGE_HOSTS) {
        expect(imgSrc.includes("https:") || imgSrc.includes(`https://${host}`), `img-src ${host}`).toBe(true);
      }
    }
  });

  it("keeps the rest of the policy strict on both rules", async () => {
    for (const r of await rules()) {
      const csp = get(r, "content-security-policy")!;
      for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests"]) {
        expect(csp).toContain(d);
      }
      expect(get(r, "X-Content-Type-Options")).toBe("nosniff");
      expect(get(r, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    }
  });

  it("has had Cesium's vendored Knockout patched off eval by the install hook", () => {
    // scripts/patch-knockout-csp.mjs runs on postinstall/predev/prebuild. If it
    // has not, Knockout's UMD preamble throws under the policy above during
    // module evaluation and takes the whole Cesium chunk — and the globe —
    // down with it.
    const require = createRequire(import.meta.url);
    let path: string;
    try {
      path = require.resolve("@cesium/widgets/Source/ThirdParty/knockout-3.5.1.js");
    } catch {
      return; // Cesium dropped its vendored copy; nothing to guard.
    }
    expect(readFileSync(path, "utf8")).not.toContain(`(0,eval)("this")`);
  });
});
