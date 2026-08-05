import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { clearSessionCookie, readSessionToken } from '@/server/http/session';
import { signOut } from '@/server/services/auth.service';

export const runtime = 'nodejs';

export const POST = route(async () => {
  // Delete the session row as well as the cookie, so a token that was captured
  // in transit stops working rather than merely being forgotten by the browser.
  signOut(getDb(), await readSessionToken());
  await clearSessionCookie();

  return Response.json({ ok: true });
});
