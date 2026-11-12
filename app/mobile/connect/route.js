import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { issueMobileCode, MOBILE_NONCE } from '../../../lib/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function GET(request) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get('challenge') || '';
  const state = url.searchParams.get('state') || '';
  if (!MOBILE_NONCE.test(challenge) || !MOBILE_NONCE.test(state)) {
    return new Response('Invalid authentication request', { status: 400, headers });
  }
  const { userId } = await auth();
  if (!userId) {
    const login = new URL('/sign-in', url.origin);
    login.searchParams.set('redirect_url', url.pathname + url.search);
    return NextResponse.redirect(login, { headers });
  }
  const code = await issueMobileCode(userId, challenge);
  const callback = new URL('crmcy://auth');
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);
  return NextResponse.redirect(callback, { headers });
}
