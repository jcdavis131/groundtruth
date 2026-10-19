import { describe, expect, it } from "vitest";
import {
  addressLine,
  amount,
  area,
  CONFIDENTIAL_REASON,
  epochDate,
  finalize,
  isOwnerMask,
  isOwnerPlaceholder,
  join,
  MASK_REASON,
  ownerNames,
  PLACEHOLDER_REASON,
  publishedOwner,
  sale,
  text,
  values,
  value,
  year,
  ymd,
} from "./normalize";
import type { ParcelRecord } from "./types";

describe("blanks are missing, never 0", () => {
  it("text: whitespace, NULL and listed placeholders are undefined", () => {
    expect(text(" ")).toBeUndefined();
    expect(text("   ")).toBeUndefined();
    expect(text("NULL")).toBeUndefined();
    expect(text("Null")).toBeUndefined();
    expect(text(null)).toBeUndefined();
    expect(text("CONTACT LOCAL JURISDICTION", ["CONTACT LOCAL JURISDICTION"])).toBeUndefined();
    expect(text("  300  ALAMO PLZ ")).toBe("300 ALAMO PLZ");
    expect(text(0)).toBe("0");
  });

  it("amount: Number('') and Number(null) are 0, so they are not used", () => {
    expect(amount("")).toBeUndefined();
    expect(amount(" ")).toBeUndefined();
    expect(amount(null)).toBeUndefined();
    expect(amount(undefined)).toBeUndefined();
    expect(amount("abc")).toBeUndefined();
    expect(amount("  86,794,159")).toBe(86_794_159);
    expect(amount("$1,300,000")).toBe(1_300_000);
    expect(amount("0")).toBe(0);
    expect(amount(0)).toBe(0);
    expect(amount(Number.NaN)).toBeUndefined();
  });

  it("year: 0 and implausible years are not years; '2026.0' is 2026", () => {
    expect(year(0)).toBeUndefined();
    expect(year("0")).toBeUndefined();
    expect(year("")).toBeUndefined();
    expect(year("2026.0")).toBe("2026");
    expect(year(1887)).toBe("1887");
    expect(year(99)).toBeUndefined();
  });

  it("area: 0 acres is not an area", () => {
    expect(area(0, "acres", "deeded")).toBeUndefined();
    expect(area("0", "acres", "legal")).toBeUndefined();
    expect(area(1.25, "acres", "outline")).toEqual({ value: 1.25, unit: "acres", basis: "outline" });
  });

  it("value and values: a missing number is left out; 0 is kept", () => {
    expect(value("land", "")).toBeUndefined();
    expect(value("land", 0)).toEqual({ label: "land", amount: 0 });
    expect(values("tax year 2025", [undefined, value("market value", "10")])).toEqual({ year: "tax year 2025", items: [{ label: "market value", amount: 10 }] });
    expect(values(undefined, [value("a", null)])).toBeUndefined();
  });

  it("dates: epoch milliseconds and yyyymmdd; other text as published", () => {
    expect(epochDate(568080000000)).toBe("1988-01-02");
    expect(epochDate(null)).toBeUndefined();
    expect(ymd("20250701")).toBe("2025-07-01");
    expect(ymd("2026MAY")).toBe("2026MAY");
    expect(ymd(" ")).toBeUndefined();
  });

  it("addressLine: tidies spaces and empty comma segments, keeps the words", () => {
    expect(addressLine(" 430 E COMMERCE ST , SAN ANTONIO, TX 78205")).toBe("430 E COMMERCE ST, SAN ANTONIO, TX 78205");
    expect(addressLine(" S ALAMO ST , , TX 78205")).toBe("S ALAMO ST, TX 78205");
    expect(addressLine(" , ")).toBeUndefined();
    expect(join([" ", "A", null, "B"])).toBe("A B");
  });

  it("sale: nothing without a date or a price", () => {
    expect(sale(undefined, undefined)).toBeUndefined();
    expect(sale(undefined, "")).toBeUndefined();
    expect(sale("2019-02-04", 1_300_000)).toEqual({ date: "2019-02-04", price: 1_300_000 });
  });
});

describe("owners", () => {
  it("names as published, blanks and repeats dropped", () => {
    expect(ownerNames("STATE OF TEXAS", "state of texas", " ", null)).toEqual(["STATE OF TEXAS"]);
    expect(publishedOwner([])).toMatchObject({ status: "not-published" });
    expect(publishedOwner(["A"], { careOf: "A" })).toEqual({ status: "published", names: ["A"], role: "owner" });
    expect(publishedOwner(["A"], { careOf: "B", dba: "C" })).toEqual({ status: "published", names: ["A"], role: "owner", careOf: "B", dba: "C" });
  });

  it("placeholder tokens mean withheld", () => {
    for (const s of ["CURRENT OWNER", "Current Owner", "current  co-owner", "Current CoOwner", "CONFIDENTIAL", "REDACTED"]) expect(isOwnerMask(s)).toBe(true);
    for (const s of ["STATE OF TEXAS", "CURRENT OWNERSHIP LLC", "UNKNOWN OWNER", undefined]) expect(isOwnerMask(s)).toBe(false);
  });

  it("a withholding word anywhere in the owner field means withheld, not only an exact placeholder", () => {
    // Two Connecticut records (Tolland) publish "SUPPRESSED OWNER"; NY publishes "Name Withheld".
    // The name before "(REDACTED)" is made up here: the marker is what is tested.
    for (const s of ["SUPPRESSED OWNER", "Name Withheld", "JANE Q SAMPLE (REDACTED)", "*CONFIDENTIAL*", "Owner: confidential", "OWNER-WITHHELD", "CONFIDENTIAL OWNER TRUST LLC"]) {
      expect(isOwnerMask(s), s).toBe(true);
    }
    // Whole words only: a name that merely contains the letters is a name.
    for (const s of ["REDACTEDSON FARMS", "CONFIDENTIALITY PARTNERS", "WITHHELDT"]) expect(isOwnerMask(s), s).toBe(false);
  });

  it("placeholders that are not withholding markers are recognised, and only whole", () => {
    for (const s of ["UNKNOWN OWNER", "Owner Unknown", "NAME NOT AVAILABLE", "unknown"]) expect(isOwnerPlaceholder(s), s).toBe(true);
    for (const s of ["UNKNOWN OWNER LLC", "STATE OF CONN", undefined]) expect(isOwnerPlaceholder(s), s ?? "undefined").toBe(false);
  });

  const base: ParcelRecord = {
    adapter: "x",
    parcelId: "1",
    owner: { status: "published", names: ["CURRENT OWNER"], role: "owner" },
    mailing: "1 MAIN ST",
    ownerAddress: "2 MAIN ST",
    taxpayer: { name: "T", address: "3 MAIN ST" },
    ownedSince: "2020-01-01",
    situs: "9 ELM ST",
  };

  it("finalize: a masked owner is withheld and every address that belongs to the owner goes with it", () => {
    const r = finalize(base);
    expect(r.owner).toEqual({ status: "withheld", reason: MASK_REASON });
    expect(r.mailing).toBeUndefined();
    expect(r.ownerAddress).toBeUndefined();
    expect(r.taxpayer).toBeUndefined();
    expect(r.ownedSince).toBeUndefined();
    expect(r.mailingNote).toMatch(/withheld/);
    // The parcel's own site address is not the owner's and stays.
    expect(r.situs).toBe("9 ELM ST");
  });

  it("finalize: the source's confidentiality flag does the same for a real-looking name", () => {
    const r = finalize({ ...base, owner: { status: "published", names: ["SOMEONE"], role: "owner" } }, { confidential: true });
    expect(r.owner).toEqual({ status: "withheld", reason: CONFIDENTIAL_REASON });
    expect(JSON.stringify(r)).not.toContain("SOMEONE");
    expect(r.mailing).toBeUndefined();
  });

  it("finalize: \"SUPPRESSED OWNER\" with a mailing address is withheld, the mailing address with it", () => {
    const r = finalize({ ...base, owner: { status: "published", names: ["SUPPRESSED OWNER"], role: "owner" } });
    expect(r.owner).toEqual({ status: "withheld", reason: MASK_REASON });
    expect(r.mailing).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("1 MAIN ST");
    expect(JSON.stringify(r)).not.toContain("SUPPRESSED OWNER");
  });

  it("finalize: a name followed by \"(REDACTED)\" is withheld, the name and the mailing address with it", () => {
    const r = finalize({ ...base, owner: { status: "published", names: ["JANE Q SAMPLE (REDACTED)"], role: "owner" } });
    expect(r.owner).toEqual({ status: "withheld", reason: MASK_REASON });
    expect(JSON.stringify(r)).not.toContain("SAMPLE");
    expect(r.mailing).toBeUndefined();
    expect(r.ownerAddress).toBeUndefined();
  });

  it("finalize: a withholding marker in a co-owner, care-of or taxpayer name withholds the owner too", () => {
    const owner = { status: "published" as const, names: ["SOMEONE"], role: "owner" as const };
    for (const r of [
      finalize({ ...base, owner: { ...owner, names: ["SOMEONE", "Current Co-Owner"] } }),
      finalize({ ...base, owner: { ...owner, careOf: "CONFIDENTIAL" } }),
      finalize({ ...base, owner, taxpayer: { name: "NAME WITHHELD", address: "3 MAIN ST" } }),
    ]) {
      expect(r.owner).toEqual({ status: "withheld", reason: MASK_REASON });
      expect(JSON.stringify(r)).not.toContain("SOMEONE");
      expect(r.mailing).toBeUndefined();
      expect(r.taxpayer).toBeUndefined();
    }
  });

  it("finalize: \"UNKNOWN OWNER\" is not a name: the owner is not published, the rest stays as published", () => {
    const r = finalize({ ...base, owner: { status: "published", names: ["UNKNOWN OWNER"], role: "owner" } });
    expect(r.owner).toEqual({ status: "not-published", reason: PLACEHOLDER_REASON });
    // Not a withholding marker: nothing else is withheld on its account.
    expect(r.mailing).toBe("1 MAIN ST");
    expect(r.situs).toBe("9 ELM ST");
    // Beside a real name, the placeholder alone is dropped.
    const two = finalize({ ...base, owner: { status: "published", names: ["TOWN OF X", "Owner Unknown"], role: "owner" } });
    expect(two.owner).toEqual({ status: "published", names: ["TOWN OF X"], role: "owner" });
  });

  it("finalize: a published owner passes through untouched, undefined keys are dropped", () => {
    const r = finalize({ adapter: "x", parcelId: "1", owner: { status: "published", names: ["CITY OF HOUSTON"], role: "owner" }, mailing: "PO BOX 1562", zoning: undefined });
    expect(r.mailing).toBe("PO BOX 1562");
    expect("zoning" in r).toBe(false);
  });
});
