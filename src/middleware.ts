import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/constants";

/**
 * Cosmetic routing only. THIS IS NOT THE SECURITY BOUNDARY.
 *
 * All it does is bounce a browser with no session cookie towards the login
 * page, so a logged-out visitor sees a form instead of a redirect chain. It
 * does not verify the cookie's signature and it grants nothing.
 *
 * Authorization lives in requireUser() / requireApprover() inside every
 * Server Action and data-loading function, because:
 *
 *   1. Next.js middleware has been bypassable with a crafted request header
 *      (CVE-2025-29927), so it cannot be trusted to run at all; and
 *   2. Server Actions are public HTTP endpoints. Anyone can POST to one
 *      directly, whatever the UI happens to render.
 */
export function middleware(request: NextRequest) {
  const hasCookie = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasCookie && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasCookie && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
