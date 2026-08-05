/**
 * CSV parsing and serialising, to RFC 4180.
 *
 * Written rather than taken from a package because the awkward cases are the
 * point: this feature exists to accept files exported from Excel, and those
 * files carry a UTF-8 byte-order mark, CRLF line endings, quoted fields with
 * embedded commas, and escaped quotes. A parser that splits on commas would
 * corrupt a salary note reading "Promotion, effective Q3" without complaining.
 *
 * Pure functions. No I/O, no streaming — an import of a few thousand salary
 * changes is a small string, and the clarity is worth more than the memory.
 */

const BOM = '﻿';

/**
 * Parse CSV text into rows of fields.
 *
 * Handles quoted fields containing commas, newlines and doubled quotes;
 * both CRLF and LF; and a leading byte-order mark. A trailing newline does not
 * produce a final empty row.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  if (input.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    // A line that is entirely empty is a blank line, not a row of one empty
    // field — spreadsheets scatter these through exported files.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === '') {
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
    } else if (char === ',') {
      endField();
    } else if (char === '\r') {
      // Swallow CR; the LF that follows ends the row.
      if (input[i + 1] === '\n') i++;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }

  // Whatever is left is the last row, unless the file ended with a newline.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** Normalise a header cell: `Employee Code` and `employee_code` both become `employeecode`. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface CsvRecord {
  /** 1-based line number in the original file, for error messages. */
  readonly line: number;
  readonly values: Readonly<Record<string, string>>;
}

export interface CsvDocument {
  readonly headers: readonly string[];
  readonly records: readonly CsvRecord[];
}

/**
 * Turn parsed rows into records keyed by normalised header.
 *
 * Rows with fewer fields than headers are padded rather than rejected here —
 * a missing value is a validation failure with a useful message, not a parse
 * error with an unhelpful one.
 */
export function toRecords(rows: readonly (readonly string[])[]): CsvDocument {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return { headers: [], records: [] };

  const headers = headerRow.map(normaliseHeader);

  const records = dataRows.map((row, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      values[header] = row[column] ?? '';
    });

    // +2: one for the header row, one because humans count from 1.
    return { line: index + 2, values };
  });

  return { headers, records };
}

/** Fields needing quotes: those containing a comma, a quote, or a line break. */
function quoteIfNeeded(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialise rows to CSV.
 *
 * Emits CRLF line endings and a leading byte-order mark, because the intended
 * destination is Excel: without the mark it mis-decodes accented names, and
 * without CRLF some versions put the whole file on one line.
 */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const body = rows
    .map((row) => row.map((value) => quoteIfNeeded(value === null || value === undefined ? '' : String(value))).join(','))
    .join('\r\n');

  return `${BOM}${body}\r\n`;
}
