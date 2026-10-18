import { headers } from "next/headers";
import Cockpit from "@/components/hud/Cockpit";

/** Phone hint from the request so the first paint is the phone layout, not a desktop flash. */
function mobileHint(h: Headers): boolean {
  if (h.get("sec-ch-ua-mobile") === "?1") return true;
  const ua = h.get("user-agent") ?? "";
  return /Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua);
}

export default async function Home() {
  const h = await headers();
  return <Cockpit initialMobile={mobileHint(h)} />;
}
