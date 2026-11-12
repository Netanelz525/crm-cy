import { clerkClient } from '@clerk/nextjs/server';
import { consumeMobileCode } from '../../../../lib/mobile-auth';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
export async function POST(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json') || Number(request.headers.get('content-length') || 0) > 1024) {
    return Response.json({ error: 'Invalid request' }, { status: 400, headers });
  }
  try {
    const raw = await request.text();
    if (raw.length > 1024) return Response.json({ error: 'Invalid request' }, { status: 400, headers });
    const { code, verifier } = JSON.parse(raw);
    const userId = await consumeMobileCode(code, verifier);
    if (!userId) return Response.json({ error: 'הכניסה פגה. יש להתחבר שוב.' }, { status: 401, headers });
    const client = await clerkClient();
    const token = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 30 });
    return Response.json({ ticket: token.token }, { headers });
  } catch {
    return Response.json({ error: 'לא ניתן להשלים את הכניסה. יש לנסות שוב.' }, { status: 400, headers });
  }
}
