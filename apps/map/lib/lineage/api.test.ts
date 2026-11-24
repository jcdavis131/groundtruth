// Contract tests for the Method Lineage API (SPEC C4). Route handlers are
// called directly with NextRequest objects against the real seed graph.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as manifestGET } from "@/app/api/lineage/route";
import { GET as healthGET } from "@/app/api/lineage/health/route";
import { GET as statsGET } from "@/app/api/lineage/stats/route";
import { POST as searchPOST } from "@/app/api/lineage/search/route";
import { POST as queryPOST } from "@/app/api/lineage/query/route";
import { GET as pathGET } from "@/app/api/lineage/path/route";
import { GET as edgesGET } from "@/app/api/lineage/edges/route";
import { GET as papersGET } from "@/app/api/lineage/papers/route";
import { GET as paperGET } from "@/app/api/lineage/papers/[paper_id]/route";
import { GET as neighborhoodGET } from "@/app/api/lineage/papers/[paper_id]/neighborhood/route";
import { GET as methodsGET } from "@/app/api/lineage/methods/route";
import { GET as methodGET } from "@/app/api/lineage/methods/[method_id]/route";
import { GET as methodPapersGET } from "@/app/api/lineage/methods/[method_id]/papers/route";
import { GET as evolutionGET } from "@/app/api/lineage/methods/[method_id]/evolution/route";
import { GET as treeGET } from "@/app/api/lineage/methods/[method_id]/tree/route";
import { GET as timelineGET } from "@/app/api/lineage/timeline/route";
import { POST as ideasPOST } from "@/app/api/lineage/ideas/route";
import { POST as evalPOST } from "@/app/api/lineage/eval/route";
import { POST as assistPOST } from "@/app/api/lineage/assist/context/route";
import { GET as openapiGET } from "@/app/api/lineage/openapi.json/route";

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function body(res: Response) {
  return res.json() as Promise<Record<string, any>>;
}

describe("manifest (#1)", () => {
  it("endpoints.length === 11 and llm === null", async () => {
    const res = await manifestGET(get("/api/lineage"));
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.name).toBe("Method Lineage API");
    expect(data.status).toBe("live");
    expect(data.version).toBe("1.0");
    expect(data.llm).toBeNull();
    expect(data.endpoints).toHaveLength(11);
    expect(data.defaults.pagination.default_limit).toBe(50);
    expect(data.defaults.pagination.max_graph_nodes).toBe(300);
    expect(data.defaults.path.max_depth).toBe(12);
  });
});

describe("health (#2)", () => {
  it("status ok with the seed graph counts", async () => {
    const data = await body(await healthGET());
    expect(data.status).toBe("ok");
    expect(data.service).toBe("method-lineage-api");
    expect(data.graph.nodes).toBe(119);
    expect(data.graph.edges).toBe(88);
  });
});

describe("stats (#3)", () => {
  it("distributions non-empty, total_edges equals the validator count (88), stub_papers 0", async () => {
    const data = await body(await statsGET());
    expect(data.total_papers).toBe(59);
    expect(data.full_papers).toBe(59);
    expect(data.stub_papers).toBe(0);
    expect(data.total_edges).toBe(88);
    expect(data.total_methods).toBe(60);
    expect(Object.keys(data.year_distribution).length).toBeGreaterThan(0);
    expect(Object.keys(data.edge_type_distribution).length).toBeGreaterThan(0);
    expect(Object.keys(data.dimension_distribution).length).toBeGreaterThan(0);
    expect(
      data.paper_type_distribution.tier1 + data.paper_type_distribution.tier2,
    ).toBe(59);
  });
});

describe("search (#4)", () => {
  it("first result for grouped-query attention is gqa", async () => {
    const data = await body(
      await searchPOST(post("/api/lineage/search", { query: "grouped-query attention", type: "auto", limit: 5 })),
    );
    expect(data.results).toHaveLength(5);
    expect(data.results[0].id).toBe("gqa");
  });

  it("limit 0 is a 400 with the HTTPValidationError shape", async () => {
    const res = await searchPOST(post("/api/lineage/search", { query: "attention", limit: 0 }));
    expect(res.status).toBe(400);
    const data = await body(res);
    expect(Array.isArray(data.detail)).toBe(true);
    expect(data.detail[0].loc).toContain("limit");
    expect(typeof data.detail[0].msg).toBe("string");
    expect(typeof data.detail[0].type).toBe("string");
  });

  it("empty query is a 400", async () => {
    const res = await searchPOST(post("/api/lineage/search", { query: "" }));
    expect(res.status).toBe(400);
  });
});

describe("query (#5)", () => {
  it("bounded subgraph: nodes <= max_nodes and every edge carries evidence", async () => {
    const data = await body(
      await queryPOST(post("/api/lineage/query", { query: "efficient attention", max_nodes: 30 })),
    );
    expect(data.nodes.length).toBeLessThanOrEqual(30);
    expect(data.seeds.length).toBeGreaterThan(0);
    expect(typeof data.truncated).toBe("boolean");
    for (const e of data.edges) {
      expect(e.evidence).toBeDefined();
      expect(e.evidence.bottleneck.text.length).toBeGreaterThan(0);
      expect(e.evidence.mechanism.text.length).toBeGreaterThan(0);
    }
  });
});

describe("path (#6)", () => {
  it("found, depth <= max_depth", async () => {
    const data = await body(
      await pathGET(get("/api/lineage/path?from_id=attention-2017&to_id=gqa")),
    );
    expect(data.found).toBe(true);
    expect(data.depth).toBeLessThanOrEqual(10);
    expect(data.path[0].node.id).toBe("attention-2017");
    expect(data.path[data.path.length - 1].node.id).toBe("gqa");
  });

  it("404 if either id is unknown", async () => {
    const res = await pathGET(get("/api/lineage/path?from_id=nope&to_id=gqa"));
    expect(res.status).toBe(404);
    expect((await body(res)).detail).toBe("not found");
  });

  it("missing to_id is a 400", async () => {
    const res = await pathGET(get("/api/lineage/path?from_id=attention-2017"));
    expect(res.status).toBe(400);
  });
});

describe("edges (#7)", () => {
  it("edge_type=replaces returns only replaces edges", async () => {
    const data = await body(await edgesGET(get("/api/lineage/edges?edge_type=replaces&limit=10")));
    expect(data.total).toBe(1);
    expect(data.edges.every((e: any) => e.type === "replaces")).toBe(true);
  });

  it("background edges are excluded by default", async () => {
    const data = await body(await edgesGET(get("/api/lineage/edges?limit=1000")));
    expect(data.total).toBe(88);
    expect(data.edges.every((e: any) => e.type !== "background")).toBe(true);
  });
});

describe("papers (#8)", () => {
  it("list totals 59 papers", async () => {
    const data = await body(await papersGET(get("/api/lineage/papers")));
    expect(data.total).toBe(59);
    expect(data.papers.length).toBe(50);
  });

  it("status=stub returns total 0 with the v1 note", async () => {
    const data = await body(await papersGET(get("/api/lineage/papers?status=stub")));
    expect(data.total).toBe(0);
    expect(data.notes).toEqual(["v1 has no stub nodes"]);
  });

  it("tier3 returns total 0", async () => {
    const data = await body(await papersGET(get("/api/lineage/papers?tier=tier3")));
    expect(data.total).toBe(0);
  });

  it("one paper by arXiv id", async () => {
    const data = await body(
      await paperGET(get("/api/lineage/papers/arxiv:2305.13245"), {
        params: Promise.resolve({ paper_id: "arxiv:2305.13245" }),
      }),
    );
    expect(data.paper.id).toBe("arxiv:2305.13245");
    expect(data.paper.paper.title).toMatch(/GQA/);
  });

  it("unknown paper is a 404", async () => {
    const res = await paperGET(get("/api/lineage/papers/arxiv:0000.00000"), {
      params: Promise.resolve({ paper_id: "arxiv:0000.00000" }),
    });
    expect(res.status).toBe(404);
  });

  it("neighbourhood is bounded and carries the truncated flag", async () => {
    const data = await body(
      await neighborhoodGET(
        get("/api/lineage/papers/arxiv:2305.13245/neighborhood?depth=1"),
        { params: Promise.resolve({ paper_id: "arxiv:2305.13245" }) },
      ),
    );
    expect(data.center).toBe("arxiv:2305.13245");
    expect(data.nodes.length).toBeLessThanOrEqual(100);
    expect(typeof data.truncated).toBe("boolean");
    expect(typeof data.truncated_count).toBe("number");
  });
});

describe("methods (#9)", () => {
  it("list totals 60 methods; q filters", async () => {
    const data = await body(await methodsGET(get("/api/lineage/methods")));
    expect(data.total).toBe(60);
    const filtered = await body(await methodsGET(get("/api/lineage/methods?q=grouped-query")));
    expect(filtered.methods.some((m: any) => m.id === "gqa")).toBe(true);
  });

  it("one method carries parents, children, papers", async () => {
    const data = await body(
      await methodGET(get("/api/lineage/methods/gqa"), {
        params: Promise.resolve({ method_id: "gqa" }),
      }),
    );
    expect(data.method.id).toBe("gqa");
    expect(Array.isArray(data.parents)).toBe(true);
    expect(Array.isArray(data.children)).toBe(true);
    expect(data.papers.length).toBeGreaterThan(0);
  });

  it("unknown method is a 404", async () => {
    const res = await methodGET(get("/api/lineage/methods/nope"), {
      params: Promise.resolve({ method_id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("evolution chain years are non-decreasing", async () => {
    const data = await body(
      await evolutionGET(get("/api/lineage/methods/gqa/evolution"), {
        params: Promise.resolve({ method_id: "gqa" }),
      }),
    );
    expect(data.chain[0].node.id).toBe("gqa");
    const years = data.chain.map((c: any) => c.node.year);
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]);
    }
  });

  it("tree is rooted at the topmost ancestor with the focus named", async () => {
    const data = await body(
      await treeGET(get("/api/lineage/methods/gqa/tree"), {
        params: Promise.resolve({ method_id: "gqa" }),
      }),
    );
    expect(data.focus).toBe("gqa");
    expect(data.tree.id).toBe("attention-2017");
    expect(data.tree.children.length).toBeGreaterThan(0);
  });

  it("method papers", async () => {
    const data = await body(
      await methodPapersGET(get("/api/lineage/methods/gqa/papers"), {
        params: Promise.resolve({ method_id: "gqa" }),
      }),
    );
    expect(data.papers.some((p: any) => p.id === "arxiv:2305.13245")).toBe(true);
  });

  it("timeline groups methods by year", async () => {
    const data = await body(
      await timelineGET(get("/api/lineage/timeline?year_start=2014&year_end=2024")),
    );
    expect(data.years.length).toBeGreaterThan(0);
    const years = data.years.map((y: any) => y.year);
    expect(years[0]).toBeGreaterThanOrEqual(2014);
    expect(years[years.length - 1]).toBeLessThanOrEqual(2024);
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeGreaterThan(years[i - 1]);
    }
    for (const y of data.years) {
      expect(Array.isArray(y.methods)).toBe(true);
      expect(y.methods.length).toBeGreaterThan(0);
    }
  });
});

describe("ideas / eval (#10)", () => {
  it("ideas returns four strategies with cited, evaluated proposals", async () => {
    const data = await body(
      await ideasPOST(post("/api/lineage/ideas", { query: "efficient attention" })),
    );
    expect(data.strategies).toHaveLength(4);
    expect(data.ideas.length).toBeGreaterThan(0);
    for (const idea of data.ideas) {
      expect(idea.evidence_certificate.edges.length).toBeGreaterThanOrEqual(1);
      expect(idea.eval.overall).toBeGreaterThanOrEqual(0);
    }
  });

  it("use_llm:true is a 400 with the fixed message", async () => {
    const res = await ideasPOST(
      post("/api/lineage/ideas", { query: "efficient attention", use_llm: true }),
    );
    expect(res.status).toBe(400);
    const data = await body(res);
    expect(data.detail[0].msg).toBe("LLM assistance is not available in v1");
  });

  it("eval scores a grounded idea and rejects use_llm / use_llm_judge", async () => {
    const good = await body(
      await evalPOST(
        post("/api/lineage/eval", {
          idea: "Combine grouped-query attention, multi-query attention and FlashAttention to cut memory.",
        }),
      ),
    );
    expect(good.veto).toBeNull();
    expect(good.scores.novelty).toBeGreaterThan(0);
    expect(good.weights).toEqual({
      novelty: 0.2,
      feasibility: 0.25,
      significance: 0.2,
      validity: 0.2,
      clarity: 0.15,
    });
    for (const flag of ["use_llm", "use_llm_judge"]) {
      const res = await evalPOST(
        post("/api/lineage/eval", { idea: "Combine grouped-query attention with multi-query attention.", [flag]: true }),
      );
      expect(res.status).toBe(400);
      expect((await body(res)).detail[0].msg).toBe("LLM assistance is not available in v1");
    }
  });

  it("eval rejects an idea shorter than 10 chars", async () => {
    const res = await evalPOST(post("/api/lineage/eval", { idea: "too short" }));
    expect(res.status).toBe(400);
  });
});

describe("assist/context (#11)", () => {
  it("context_markdown is non-empty and notes carry the use_mcts line", async () => {
    const data = await body(
      await assistPOST(
        post("/api/lineage/assist/context", {
          query: "efficient long-context attention",
          budget: "balanced",
        }),
      ),
    );
    expect(data.query).toBe("efficient long-context attention");
    expect(data.budget).toBe("balanced");
    expect(data.context_markdown.length).toBeGreaterThan(0);
    expect(data.seeds.length).toBeGreaterThan(0);
    expect(data.notes).toEqual([
      "use_mcts accepted and ignored: v1 uses deterministic BFS chains",
    ]);
    for (const e of data.edges) {
      expect(e.evidence.bottleneck.text.length).toBeGreaterThan(0);
    }
  });

  it("use_mcts is accepted (true or false) and ignored", async () => {
    const data = await body(
      await assistPOST(
        post("/api/lineage/assist/context", {
          query: "efficient long-context attention",
          use_mcts: false,
        }),
      ),
    );
    expect(data.context_markdown.length).toBeGreaterThan(0);
  });
});

describe("openapi.json", () => {
  it("is OpenAPI 3.1.0 with 11 family tags and nothing from the non-goals list", async () => {
    const data = await body(await openapiGET());
    expect(data.openapi).toBe("3.1.0");
    expect(data.tags).toHaveLength(11);
    const paths = Object.keys(data.paths);
    for (const p of [
      "/api/lineage",
      "/api/lineage/health",
      "/api/lineage/stats",
      "/api/lineage/search",
      "/api/lineage/query",
      "/api/lineage/path",
      "/api/lineage/edges",
      "/api/lineage/papers",
      "/api/lineage/methods",
      "/api/lineage/ideas",
      "/api/lineage/eval",
      "/api/lineage/assist/context",
      "/api/lineage/timeline",
      "/api/lineage/openapi.json",
    ]) {
      expect(paths).toContain(p);
    }
    const joined = paths.join(" ");
    for (const forbidden of [
      "gaps",
      "survey",
      "agent",
      "jobs",
      "chain-comparison",
      "visualization",
      "validate",
      "evidence/context",
    ]) {
      expect(joined).not.toContain(forbidden);
    }
    expect(data.components.schemas.Node).toBeDefined();
    expect(data.components.schemas.Edge).toBeDefined();
    expect(data.components.schemas.SearchRequest).toBeDefined();
  });
});

describe("cache headers", () => {
  it("GETs are cacheable per the C4 rule", async () => {
    const res = await healthGET();
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
  });
});
