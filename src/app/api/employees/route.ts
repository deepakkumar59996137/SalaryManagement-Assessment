import { getDb } from '@/server/db/client';
import { parseQuery, route } from '@/server/http/handler';
import { directoryQuerySchema, toDirectoryQuery } from '@/server/http/schemas';
import { requireUser } from '@/server/http/session';
import { listEmployees } from '@/server/services/employee.service';

export const runtime = 'nodejs';

export const GET = route(async (request: Request) => {
  await requireUser();

  const query = parseQuery(request, directoryQuerySchema);
  return Response.json(listEmployees(getDb(), toDirectoryQuery(query)));
});
