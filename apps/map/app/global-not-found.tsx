import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NotFoundFrame from "@/components/hud/NotFoundFrame";

// With two root layouts ((globe) and (docs)) there is no single layout to
// compose an unmatched-URL 404 from, so this page brings its own html, fonts
// and the cockpit theme. Enabled by experimental.globalNotFound.

const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const display = Geist({ variable: "--font-display", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Not found · Embedding Atlas",
  description: "There is no view at this address.",
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`dark ${mono.variable} ${display.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-background font-mono text-foreground">
        <NotFoundFrame />
      </body>
    </html>
  );
}
