import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { requireUser } from '@/server/http/session';
import { exportEmployeesCsv, importTemplateCsv } from '@/server/services/export.service';

export const runtime = 'nodejs';

/**
 * `?template=1` returns the blank import file instead of the data.
 *
 * The Content-Disposition filename carries no date: this is the current state
 * of the data, and whoever downloads it will name the file themselves.
 */
export const GET = route(async (request: Request) => {
  await requireUser();

  const wantsTemplate = new URL(request.url).searchParams.get('template') === '1';
  const body = wantsTemplate ? importTemplateCsv() : exportEmployeesCsv(getDb());
  const filename = wantsTemplate ? 'salary-import-template.csv' : 'acme-employees.csv';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
