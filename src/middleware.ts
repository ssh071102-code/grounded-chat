import { NextResponse, type NextRequest } from "next/server";
import { embedCsp } from "@/lib/widget";

/** Framing policy for the embedded widget. */
export const config = {
  matcher: "/embed",
};

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    embedCsp(process.env.EMBED_FRAME_ANCESTORS),
  );
  // In a conforming browser an enforced `frame-ancestors` overrides
  // X-Frame-Options. XFO is dropped anyway, for older clients that honour only
  // it, and because a SAMEORIGIN default from a proxy would block the widget
  // everywhere. ⚠ A proxy or CDN can add it back after this runs, and a second
  // CSP header is intersected rather than replaced, so the header set on the
  // deployed response is the one to check, not this line.
  response.headers.delete("X-Frame-Options");
  return response;
}
