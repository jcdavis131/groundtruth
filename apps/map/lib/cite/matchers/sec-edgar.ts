// SEC EDGAR submissions file for one CIK (data.sec.gov/submissions/CIK##########.json). The item names a company by ticker and
// CIK only (no name is copied), so the ticker must be one of the registrant's tickers, the CIK must match, and the exchange
// the note leads with must be one of its exchanges. The registrant's name and SIC are in the reply but the item does not state them.

import type { CiteItem, Matcher, Reading } from "../types";
import { also, isObj, norm, parseJson, toNum, unreadable } from "./util";

export const secEdgar: Matcher = {
  id: "sec-edgar-submissions",
  sourceId: "sec-edgar",
  tolerance: { ticker: 0, cik: 0, exchange: 0 },
  read(item: CiteItem, body: string): Reading {
    const j = parseJson(body);
    if (!isObj(j) || !Array.isArray(j.tickers)) return unreadable("no tickers array in the submissions reply");
    const tickers = j.tickers.map((t) => norm(t));
    const ticker = typeof item.value === "string" ? item.value : null;
    const cik = toNum(j.cik);
    if (cik === null) return unreadable("the reply has no cik");
    const exchanges = Array.isArray(j.exchanges) ? j.exchanges.map((e) => norm(e)) : [];
    const exch = (item.note ?? "").split(";")[0].trim();
    return {
      kind: "value",
      field: "ticker",
      // the registrant lists its tickers; the item's is one of them
      publisherValue: ticker !== null && tickers.includes(ticker) ? ticker : (tickers[0] ?? null),
      itemValue: ticker,
      period: null,
      later: false,
      also: [also("cik", toNum((item.code ?? "").replace(/^CIK /, "")), cik), also("exchange", exch || null, exch && exchanges.includes(exch) ? exch : (exchanges[0] ?? null))],
    };
  },
};
