import { NextResponse, type NextRequest } from "next/server";

/** The portal lives under /app; the marketing site and /login are public. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get("azzy_session")?.value;
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = pathname !== "/app" ? `?next=${encodeURIComponent(pathname)}` : "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
  // Legacy v1 portal paths → their v2 homes (keeps old bookmarks working).
  const legacy: Record<string, string> = {
    "/pipeline": "/app/tasks",
    "/approvals": "/app/approvals",
    "/incidents": "/app/monitoring",
    "/environments": "/app/infrastructure",
    "/costs": "/app/monitoring",
    "/team": "/app/agents",
    "/office": "/app/office",
  };
  if (legacy[pathname]) {
    const url = req.nextUrl.clone();
    url.pathname = legacy[pathname];
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API proxy, every Next internal (/_next/static, /_next/image, /_next/data …), static assets and PWA files.
  matcher: ["/((?!api|_next|icons|brand|sw\\.js|manifest\\.webmanifest|favicon\\.ico).*)"],
};
