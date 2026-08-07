import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { ValidationError } from '@/server/http/errors';
import { requireUser } from '@/server/http/session';
import { applyImport, previewImport } from '@/server/services/import.service';

export const runtime = 'nodejs';

/** Refuse anything implausibly large before reading it into memory. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * `?apply=1` writes; without it the file is only validated.
 *
 * Two calls to one endpoint rather than two endpoints, because they must agree
 * exactly on what a valid file is — and applying re-validates from scratch
 * rather than trusting a preview that may be minutes old.
 */
export const POST = route(async (request: Request) => {
  const user = await requireUser();

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    throw new ValidationError('Choose a CSV file to upload');
  }
  if (file.size === 0) {
    throw new ValidationError('That file is empty');
  }
  if (file.size > MAX_BYTES) {
    throw new ValidationError('That file is larger than 5 MB. Split it and upload the parts.');
  }

  const csvText = await file.text();
  const apply = new URL(request.url).searchParams.get('apply') === '1';

  const db = getDb();
  return Response.json(apply ? applyImport(db, csvText, user.id) : previewImport(db, csvText));
});
