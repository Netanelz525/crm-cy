import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";

export function proxy(req: NextRequest) {
  const { userId } = getAuth(req as any);
  const pathname = req.nextUrl?.pathname ?? new URL(req.url).pathname;

  if (!userId && (pathname === "/email" || pathname.startsWith("/email/"))) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("returnBackUrl", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)"
  ]
};
