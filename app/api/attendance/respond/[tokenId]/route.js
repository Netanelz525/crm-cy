import { NextResponse } from "next/server";
import { applyAttendanceEmailResponseToken } from "../../../../../lib/attendance-email";

function clean(value) {
  return String(value || "").trim();
}

function redirectUrl(searchParams) {
  const params = new URLSearchParams(searchParams);
  return `/attendance/respond?${params.toString()}`;
}

export async function GET(request, { params }) {
  const origin = new URL(request.url).origin;
  try {
    const resolvedParams = await params;
    const result = await applyAttendanceEmailResponseToken(clean(resolvedParams?.tokenId));
    return NextResponse.redirect(new URL(redirectUrl({
      done: "1",
      student: result.studentName,
      status: result.statusLabel,
      session: result.sessionTitle || result.sessionId
    }), origin));
  } catch (error) {
    return NextResponse.redirect(new URL(redirectUrl({
      error: clean(error?.message) || "עדכון הנוכחות דרך המייל נכשל"
    }), origin));
  }
}
