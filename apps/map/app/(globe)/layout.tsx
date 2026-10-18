import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { Providers } from "../providers";
import EyeAnalytics from "@/components/analytics/EyeAnalytics";
import { BASE_METADATA, BASE_DESCRIPTION } from "@/lib/seo/base";

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

// A bare string, not a template: the globe is the home route and its rendered
// <title> must not move.
export const metadata: Metadata = {
  ...BASE_METADATA,
  title: "Embedding Atlas",
  description: BASE_DESCRIPTION,
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  // Both schemes are supported; the pre-paint script below picks the stored one.
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  // Let the HUD pad itself around the notch and the home indicator.
  viewportFit: "cover",
};

const THEME_INIT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q==="dark"||q==="light"?q:localStorage.getItem("eye-chrome-theme");var d=document.documentElement;if(t==="dark"){d.classList.add("dark");d.style.colorScheme="dark"}else{d.classList.remove("dark");d.style.colorScheme="light"}}catch(e){}})();`;

export default function GlobeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${display.variable} h-full antialiased`}>
      <head>
        {/* Apply the stored chrome theme before first paint so there is no flash.
            `?theme=dark|light` overrides the stored preference for the session. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* Cesium widget CSS, served from the assets copied by scripts/copy-cesium.mjs.
            Linked rather than imported so its relative image URLs resolve against
            /cesium without bundler asset rewriting. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      </head>
      <body className="h-full overflow-hidden bg-background text-foreground">
        <Providers>{children}</Providers>
        <EyeAnalytics />
      </body>
    </html>
  );
}
