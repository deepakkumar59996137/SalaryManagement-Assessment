import { describe, expect, it } from 'vitest';
import { normaliseHeader, parseCsv, toCsv, toRecords } from '@/domain/csv';

describe('parseCsv', () => {
  it('parses a plain file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles the Windows line endings Excel writes', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the byte-order mark Excel puts at the front', () => {
    // Without this the first header reads "﻿employee_code" and never matches.
    expect(parseCsv('﻿code,salary\nACME-1,100')).toEqual([
      ['code', 'salary'],
      ['ACME-1', '100'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // The case a split-on-comma parser corrupts silently.
    expect(parseCsv('code,note\nACME-1,"Promotion, effective Q3"')).toEqual([
      ['code', 'note'],
      ['ACME-1', 'Promotion, effective Q3'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('note\n"She said ""yes"""')).toEqual([['note'], ['She said "yes"']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('code,note\nACME-1,"line one\nline two"')).toEqual([
      ['code', 'note'],
      ['ACME-1', 'line one\nline two'],
    ]);
  });

  it('trims unquoted fields but preserves quoted ones exactly', () => {
    expect(parseCsv('a, b ,"  c  "')).toEqual([['a', 'b', '  c  ']]);
  });

  it('ignores blank lines scattered through the file', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields, which are missing values rather than absent columns', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿')).toEqual([]);
  });
});

describe('normaliseHeader', () => {
  it('makes header spelling irrelevant', () => {
    // Whatever the HR Manager's spreadsheet calls the column.
    expect(normaliseHeader('Employee Code')).toBe('employeecode');
    expect(normaliseHeader('employee_code')).toBe('employeecode');
    expect(normaliseHeader('EMPLOYEE-CODE')).toBe('employeecode');
  });
});

describe('toRecords', () => {
  it('keys values by normalised header', () => {
    const document = toRecords(parseCsv('Employee Code,New Salary\nACME-1,90000'));

    expect(document.headers).toEqual(['employeecode', 'newsalary']);
    expect(document.records[0]?.values).toEqual({ employeecode: 'ACME-1', newsalary: '90000' });
  });

  it('reports the line number a person would see in their spreadsheet', () => {
    // Row one is the header, and humans count from one.
    const document = toRecords(parseCsv('code\nA\nB'));
    expect(document.records.map((record) => record.line)).toEqual([2, 3]);
  });

  it('pads a short row rather than rejecting it, so validation can explain why', () => {
    const document = toRecords(parseCsv('a,b,c\n1,2'));
    expect(document.records[0]?.values).toEqual({ a: '1', b: '2', c: '' });
  });

  it('returns nothing for a file with no header', () => {
    expect(toRecords([])).toEqual({ headers: [], records: [] });
  });
});

describe('toCsv', () => {
  it('quotes only the fields that need it', () => {
    const output = toCsv([
      ['code', 'note'],
      ['ACME-1', 'Promotion, effective Q3'],
      ['ACME-2', 'plain'],
    ]);

    expect(output).toContain('ACME-1,"Promotion, effective Q3"');
    expect(output).toContain('ACME-2,plain');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(toCsv([['She said "yes"']])).toContain('"She said ""yes"""');
  });

  it('writes a byte-order mark and CRLF, because the destination is Excel', () => {
    const output = toCsv([['a', 'b']]);
    expect(output.startsWith('﻿')).toBe(true);
    expect(output.endsWith('\r\n')).toBe(true);
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(toCsv([['a', null, undefined, 0]])).toContain('a,,,0');
  });

  it('round-trips through the parser without loss', () => {
    const rows = [
      ['code', 'note', 'salary'],
      ['ACME-1', 'Promotion, effective Q3', '90000'],
      ['ACME-2', 'She said "yes"', '80000'],
      ['ACME-3', 'line one\nline two', '70000'],
    ];

    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
