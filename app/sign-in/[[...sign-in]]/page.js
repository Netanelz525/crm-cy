import { SignIn } from "@clerk/nextjs";

function clean(value) {
  return String(value || "").trim();
}

function safeInternalPath(value) {
  const raw = clean(value);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/sign-in") || raw.startsWith("/sign-up")) return "/";
  return raw;
}

export default async function SignInPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const redirectUrl = safeInternalPath(resolvedSearchParams?.redirect_url);

  const mobileRedirect = redirectUrl.startsWith("/mobile/connect?") ? redirectUrl : undefined;

  return (
    <div className="card">
      <h1>כניסה למערכת</h1>
      <SignIn fallbackRedirectUrl={redirectUrl} forceRedirectUrl={mobileRedirect} signUpForceRedirectUrl={mobileRedirect} />
    </div>
  );
}
