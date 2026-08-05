import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { parseJson, route } from '@/server/http/handler';
import { setSessionCookie } from '@/server/http/session';
import { signIn } from '@/server/services/auth.service';

export const runtime = 'nodejs';

const credentialsSchema = z.object({
  email: z.string().min(1, 'Enter your email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const POST = route(async (request: Request) => {
  const credentials = await parseJson(request, credentialsSchema);
  const { user, token } = signIn(getDb(), credentials);

  await setSessionCookie(token);
  return Response.json({ user });
});
