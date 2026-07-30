import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route protection.
 *
 * This only checks that a session cookie is *present* — it does not validate
 * it, because middleware runs on the edge without database access. That is
 * fine, and deliberate: this exists to avoid flashing a protected page at a
 * signed-out visitor, not to enforce access.
 *
 * Real enforcement is `requireSession` plus `assertMemberOfOrganization` in
 * @bracketx/core, which run on every request that touches data. Treating this
 * file as the security boundary would be a mistake — a forged cookie passes
 * here and fails there.
 */
const PROTECTED = ["/workspaces", "/w"];
const AUTH_ROUTES = ["/sign-in", "/sign-up"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  const isProtected = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !hasSession) {
    const url = new URL("/sign-in", request.url);
    // Preserve where they were going so sign-in can return them there.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_ROUTES.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL("/workspaces", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/workspaces/:path*", "/w/:path*", "/sign-in", "/sign-up"],
};
