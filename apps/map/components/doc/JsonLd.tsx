// Structured data, rendered as a native script tag.
//
// The Next JSON-LD guide is explicit that next/script is the wrong tool here:
// it is optimised for loading and executing JavaScript, and JSON-LD is data.
// The same guide mandates scrubbing "<" out of the payload, which
// serializeJsonLd in lib/places/jsonld.ts does before this component ever
// sees the string. Inline is legal because the existing CSP in next.config.ts
// carries 'unsafe-inline' in script-src, and that file is not edited.

import { serializeJsonLd } from "@/lib/places/jsonld";

export default function JsonLd({ nodes }: { nodes: unknown[] }) {
  if (nodes.length === 0) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(nodes) }} />;
}
