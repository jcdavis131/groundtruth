// Method Lineage section layout (SPEC C1, C7).
// Title template "%s - Method Lineage"; canonicals point at arxiviq, never
// at the eye origin — see lib/lineage/seo.ts. This layout does not touch the
// docs root layout, the globe, or any other docs section.

import type { Metadata } from "next";

import { lineageCanonical } from "@/lib/lineage/seo";

export const metadata: Metadata = {
  title: {
    template: "%s - Method Lineage",
    default: "Method Lineage",
  },
  description:
    "A causal map of how AI methods evolve: methods, papers and cited causal edges, every edge quoted verbatim.",
  alternates: { canonical: lineageCanonical("/lineage") },
  openGraph: {
    title: "Method Lineage",
    description:
      "A causal map of how AI methods evolve: methods, papers and cited causal edges, every edge quoted verbatim.",
    url: lineageCanonical("/lineage"),
    type: "website",
  },
  twitter: {
    title: "Method Lineage",
    description:
      "A causal map of how AI methods evolve: methods, papers and cited causal edges, every edge quoted verbatim.",
  },
};

export default function LineageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
