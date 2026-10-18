// Mint a signed conversation URL for a *private* ElevenLabs agent. Public
// agents connect with just the agent id and never hit this route.
//
//   GET /api/voice/elevenlabs?agent=<agent_id>   (needs x-gev-elevenlabs-api-key)

import type { NextRequest } from "next/server";
import { jsonError, keyFrom, upstreamJson } from "@/lib/server/upstream";

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent") ?? "";
  const key = keyFrom(req, "ELEVENLABS_API_KEY");
  if (!agent) return Response.json({ error: "agent required" }, { status: 400 });
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 400 });
  try {
    const json = await upstreamJson<{ signed_url: string }>(
      "elevenlabs",
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent)}`,
      { headers: { "xi-api-key": key } },
    );
    return Response.json({ signedUrl: json.signed_url });
  } catch (err) {
    return jsonError(err);
  }
}
