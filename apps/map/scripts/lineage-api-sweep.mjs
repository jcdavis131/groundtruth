// Lineage API sweep (SPEC C4 done-check): hits every C4 example against a
// running app and asserts the named condition. Usage:
//   node scripts/lineage-api-sweep.mjs <base>   (e.g. http://localhost:3000)
// Exit 0 when every check passes, 1 otherwise.

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { res, json, text };
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { res, json, text };
}

function yearsNonDecreasing(chain) {
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].node.year < chain[i - 1].node.year) return false;
  }
  return true;
}

async function main() {
  // #1 manifest
  {
    const { res, json } = await get("/api/lineage");
    check("manifest: 200", res.status === 200, `status ${res.status}`);
    check("manifest: endpoints.length === 11", json?.endpoints?.length === 11, JSON.stringify(json?.endpoints?.length));
    check("manifest: llm === null", json?.llm === null);
  }
  // #2 health
  {
    const { res, json } = await get("/api/lineage/health");
    check("health: status ok", res.status === 200 && json?.status === "ok", `status ${res.status}`);
    check("health: graph counts", json?.graph?.nodes === 119 && json?.graph?.edges === 88, JSON.stringify(json?.graph));
  }
  // #3 stats
  {
    const { res, json } = await get("/api/lineage/stats");
    check("stats: 200", res.status === 200, `status ${res.status}`);
    check("stats: total_edges equals validator count (88)", json?.total_edges === 88, JSON.stringify(json?.total_edges));
    check("stats: stub_papers 0", json?.stub_papers === 0);
    check(
      "stats: distributions non-empty",
      Object.keys(json?.year_distribution ?? {}).length > 0 &&
        Object.keys(json?.edge_type_distribution ?? {}).length > 0 &&
        Object.keys(json?.dimension_distribution ?? {}).length > 0,
    );
  }
  // #4 search
  {
    const { res, json } = await post("/api/lineage/search", {
      query: "grouped-query attention",
      type: "auto",
      limit: 5,
    });
    check("search: 200", res.status === 200, `status ${res.status}`);
    check("search: first result is gqa", json?.results?.[0]?.id === "gqa", JSON.stringify(json?.results?.[0]?.id));
  }
  // #5 query
  {
    const { res, json } = await post("/api/lineage/query", {
      query: "efficient attention",
      max_nodes: 30,
    });
    check("query: 200", res.status === 200, `status ${res.status}`);
    check("query: nodes.length <= 30", (json?.nodes?.length ?? 999) <= 30, JSON.stringify(json?.nodes?.length));
    check(
      "query: every edge carries evidence",
      Array.isArray(json?.edges) && json.edges.every((e) => e.evidence?.bottleneck?.text && e.evidence?.mechanism?.text),
    );
  }
  // #6 path
  {
    const { res, json } = await get("/api/lineage/path?from_id=attention-2017&to_id=gqa");
    check("path: 200", res.status === 200, `status ${res.status}`);
    check("path: found === true", json?.found === true);
    check("path: depth <= max_depth", (json?.depth ?? 99) <= 10, JSON.stringify(json?.depth));
    const { res: res404 } = await get("/api/lineage/path?from_id=nope&to_id=gqa");
    check("path: unknown id is 404", res404.status === 404, `status ${res404.status}`);
  }
  // #7 edges
  {
    const { res, json } = await get("/api/lineage/edges?edge_type=replaces&limit=10");
    check("edges: 200", res.status === 200, `status ${res.status}`);
    check(
      "edges: each edge type === replaces",
      Array.isArray(json?.edges) && json.edges.length > 0 && json.edges.every((e) => e.type === "replaces"),
    );
    const d = await get("/api/lineage/edges?limit=1000");
    check(
      "edges: background excluded by default",
      Array.isArray(d.json?.edges) && d.json.edges.every((e) => e.type !== "background"),
    );
  }
  // #8 papers
  {
    const { res, json } = await get("/api/lineage/papers");
    check("papers: 200", res.status === 200, `status ${res.status}`);
    check("papers: total 59", json?.total === 59, JSON.stringify(json?.total));
    const stub = await get("/api/lineage/papers?status=stub");
    check(
      "papers: status=stub total 0 with note",
      stub.json?.total === 0 && stub.json?.notes?.includes("v1 has no stub nodes"),
      JSON.stringify(stub.json),
    );
    const tier3 = await get("/api/lineage/papers?tier=tier3");
    check("papers: tier3 total 0", tier3.json?.total === 0, JSON.stringify(tier3.json));
    const one = await get("/api/lineage/papers/arxiv:2305.13245");
    check("papers: one paper resolves", one.res.status === 200 && one.json?.paper?.id === "arxiv:2305.13245", `status ${one.res.status}`);
    const nb = await get("/api/lineage/papers/arxiv:2305.13245/neighborhood?depth=1");
    check(
      "papers: neighbourhood bounded with truncated flag",
      nb.res.status === 200 && (nb.json?.nodes?.length ?? 999) <= 100 && typeof nb.json?.truncated === "boolean",
      `status ${nb.res.status}`,
    );
  }
  // #9 methods + timeline
  {
    const { res, json } = await get("/api/lineage/methods");
    check("methods: 200", res.status === 200, `status ${res.status}`);
    check("methods: total 60", json?.total === 60, JSON.stringify(json?.total));
    const one = await get("/api/lineage/methods/gqa");
    check("methods: one method resolves", one.res.status === 200 && one.json?.method?.id === "gqa", `status ${one.res.status}`);
    const mp = await get("/api/lineage/methods/gqa/papers");
    check("methods: papers list non-empty", mp.res.status === 200 && (mp.json?.papers?.length ?? 0) > 0);
    const ev = await get("/api/lineage/methods/gqa/evolution");
    check(
      "methods: evolution chain years non-decreasing",
      ev.res.status === 200 && yearsNonDecreasing(ev.json?.chain ?? []),
    );
    const tree = await get("/api/lineage/methods/gqa/tree");
    check("methods: tree resolves with focus", tree.res.status === 200 && tree.json?.focus === "gqa");
    const tl = await get("/api/lineage/timeline?year_start=2014&year_end=2024");
    check(
      "timeline: years with method ids",
      tl.res.status === 200 &&
        Array.isArray(tl.json?.years) &&
        tl.json.years.length > 0 &&
        tl.json.years.every((y) => typeof y.year === "number" && Array.isArray(y.methods)),
      `status ${tl.res.status}`,
    );
  }
  // #10 ideas / eval
  {
    const { res, json } = await post("/api/lineage/ideas", { query: "efficient attention" });
    check("ideas: 200", res.status === 200, `status ${res.status}`);
    check("ideas: four strategies", json?.strategies?.length === 4, JSON.stringify(json?.strategies?.length));
    check(
      "ideas: every proposal cites >=1 edge with quotes",
      Array.isArray(json?.ideas) &&
        json.ideas.length > 0 &&
        json.ideas.every(
          (i) => i.evidence_certificate?.edges?.length >= 1 && i.evidence_certificate?.quotes?.length >= 1,
        ),
    );
    const bad = await post("/api/lineage/ideas", { query: "efficient attention", use_llm: true });
    check(
      "ideas: use_llm:true is 400 with the fixed message",
      bad.res.status === 400 && bad.json?.detail?.[0]?.msg === "LLM assistance is not available in v1",
      `status ${bad.res.status} ${JSON.stringify(bad.json?.detail)}`,
    );
    const ev = await post("/api/lineage/eval", {
      idea: "Combine grouped-query attention, multi-query attention and FlashAttention to cut memory.",
    });
    check("eval: 200 with scores", ev.res.status === 200 && ev.json?.scores && typeof ev.json?.overall === "number", `status ${ev.res.status}`);
    const evBad = await post("/api/lineage/eval", {
      idea: "Combine grouped-query attention with multi-query attention.",
      use_llm_judge: true,
    });
    check(
      "eval: use_llm_judge:true is 400 with the fixed message",
      evBad.res.status === 400 && evBad.json?.detail?.[0]?.msg === "LLM assistance is not available in v1",
      `status ${evBad.res.status}`,
    );
  }
  // #11 assist/context
  {
    const { res, json } = await post("/api/lineage/assist/context", {
      query: "efficient long-context attention",
      budget: "balanced",
    });
    check("assist: 200", res.status === 200, `status ${res.status}`);
    check("assist: context_markdown non-empty", typeof json?.context_markdown === "string" && json.context_markdown.length > 0);
    check(
      "assist: notes carry the use_mcts line",
      json?.notes?.includes("use_mcts accepted and ignored: v1 uses deterministic BFS chains"),
    );
  }
  // openapi.json
  {
    const { res, json } = await get("/api/lineage/openapi.json");
    check("openapi: 200", res.status === 200, `status ${res.status}`);
    check("openapi: 3.1.0", json?.openapi === "3.1.0", JSON.stringify(json?.openapi));
    check("openapi: 11 family tags", json?.tags?.length === 11, JSON.stringify(json?.tags?.length));
    const paths = Object.keys(json?.paths ?? {}).join(" ");
    const forbidden = ["gaps", "survey", "agent", "jobs", "chain-comparison", "visualization", "validate", "evidence/context"];
    check(
      "openapi: nothing from the non-goals list",
      forbidden.every((f) => !paths.includes(f)),
      paths,
    );
  }
  // validation shape
  {
    const bad = await post("/api/lineage/search", { query: "attention", limit: 0 });
    check(
      "validation: 400 with {detail:[{loc,msg,type}]}",
      bad.res.status === 400 &&
        Array.isArray(bad.json?.detail) &&
        Array.isArray(bad.json.detail[0]?.loc) &&
        typeof bad.json.detail[0]?.msg === "string",
      `status ${bad.res.status}`,
    );
    const nf = await get("/api/lineage/methods/nope");
    check("validation: unknown method 404 {detail: not found}", nf.res.status === 404 && nf.json?.detail === "not found", `status ${nf.res.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`Failures: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`SWEEP ERROR: ${err?.message ?? err}`);
  process.exit(1);
});
