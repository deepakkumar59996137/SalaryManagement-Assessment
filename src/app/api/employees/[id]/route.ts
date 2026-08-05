import { getDb } from '@/server/db/client';
import { parse, route } from '@/server/http/handler';
import { employeeIdSchema } from '@/server/http/schemas';
import { requireUser } from '@/server/http/session';
import { getEmployee } from '@/server/services/employee.service';

export const runtime = 'nodejs';

export const GET = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  await requireUser();

  const { id } = await context.params;
  return Response.json(getEmployee(getDb(), parse(id, employeeIdSchema)));
});
