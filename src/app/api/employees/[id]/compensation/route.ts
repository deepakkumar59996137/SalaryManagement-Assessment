import { z } from 'zod';
import { SELECTABLE_CHANGE_REASONS } from '@/domain/compensation';
import { isIsoDate } from '@/domain/dates';
import { getDb } from '@/server/db/client';
import { parse, parseJson, route } from '@/server/http/handler';
import { employeeIdSchema } from '@/server/http/schemas';
import { requireUser } from '@/server/http/session';
import { getCompensationHistory, reviseSalary } from '@/server/services/compensation.service';

export const runtime = 'nodejs';

const revisionSchema = z.object({
  // Major units — what a person types. The service converts, because the
  // number of decimal places depends on the employee's currency.
  baseSalaryMajor: z.coerce
    .number()
    .positive('Enter a salary greater than zero')
    .finite()
    .max(100_000_000, 'That salary looks like a typo'),
  effectiveFrom: z.string().refine(isIsoDate, 'Enter a date as YYYY-MM-DD'),
  changeReason: z.enum(SELECTABLE_CHANGE_REASONS),
  note: z.string().trim().max(500).optional().nullable(),
});

export const GET = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  await requireUser();

  const { id } = await context.params;
  return Response.json(getCompensationHistory(getDb(), parse(id, employeeIdSchema)));
});

export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();

  const { id } = await context.params;
  const employeeId = parse(id, employeeIdSchema);
  const body = await parseJson(request, revisionSchema);

  const result = reviseSalary(getDb(), { employeeId, ...body }, user.id);
  return Response.json(result, { status: 201 });
});
