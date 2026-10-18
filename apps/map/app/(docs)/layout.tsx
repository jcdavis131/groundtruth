import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { BASE_METADATA, BASE_DESCRIPTION } from "@/lib/seo/base";
import EyeAnalytics from "@/components/analytics/EyeAnalytics";

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// One display face (tracked, uppercase, used with restraint) and one text face
// (mono, tabular figures for every reading). Both variable, both display=swap.
const display = Geist({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

// A second root layout, not a child of the globe's. Documents are long, they
// scroll, and they ship no Cesium, no QueryClientProvider and no application
// JavaScript beyond the Web Analytics island (components/analytics/EyeAnalytics.tsx),
// which counts the page path and nothing else.
//
// data-mode="desk" data-theme="light" are set here in the server-rendered HTML
// rather than by lib/desk/store.ts, whose applyDeskDom also writes to the
// settings store. The two attributes are all the stylesheet needs: the audited
// WCAG-AA light palette is scoped to [data-mode="desk"][data-theme="light"]
// (specificity 0,2,0, which beats the :root cockpit block at 0,1,0) and the
// print block is scoped to html[data-mode="desk"], so both come for free.
//
// The inline height on <html> and <body> overrides globals.css's
// `@layer base { html, body { height: 100% } }`. Without it a long article is
// clipped at the viewport and the document does not scroll.

export const metadata: Metadata = {
  ...BASE_METADATA,
  // A default is mandatory whenever a template is set.
  title: { template: "%s - Embedding Atlas", default: "Embedding Atlas" },
  description: BASE_DESCRIPTION,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#f4f6f8",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-mode="desk"
      data-theme="light"
      className={`${mono.variable} ${display.variable}`}
      style={{ height: "auto" }}
    >
      <body
        className="min-h-dvh bg-background text-foreground antialiased"
        style={{ height: "auto" }}
      >
        <div className="mx-auto w-full max-w-[64rem] px-4 py-8">{children}</div>
        <EyeAnalytics />
      </body>
    </html>
  );
}
