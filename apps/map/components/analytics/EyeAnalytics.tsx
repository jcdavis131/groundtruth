"use client";
// Vercel Web Analytics, once per document (both root layouts mount it). A client component
// because beforeSend is a function and cannot cross from a server layout. stripUrl sends the
// path only. Inert until Web Analytics is enabled for the project in the Vercel dashboard.

import { Analytics } from "@vercel/analytics/next";
import { stripUrl } from "@/lib/analytics/events";

export default function EyeAnalytics() {
  return <Analytics beforeSend={stripUrl} />;
}
