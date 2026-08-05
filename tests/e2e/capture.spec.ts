import { test } from '@playwright/test';

/**
 * Captures a screenshot of each screen into docs/screenshots/.
 *
 *   npm run screenshots
 *
 * Not part of the smoke suite — it asserts nothing. It exists so the README can
 * show what the software looks like without asking anyone to run it, and so
 * visual regressions are at least noticeable in a diff.
 */

test.describe('screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  const shot = (page: import('@playwright/test').Page, name: string) =>
    page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });

  test('capture every screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/login');
    await shot(page, '01-login');

    await page.getByLabel('Email').fill('hr.manager@acme.example');
    await page.getByLabel('Password').fill('DemoPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
    await shot(page, '02-dashboard');

    await page.goto('/employees?bandPosition=BELOW&sort=compaRatio');
    await page.waitForLoadState('networkidle');
    await shot(page, '03-employees-below-band');

    await page.goto('/employees/42');
    await page.waitForLoadState('networkidle');
    await shot(page, '04-employee-detail');

    await page.getByRole('button', { name: 'Change salary' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '+10%' }).click();
    await shot(page, '05-raise-dialog');
    await page.keyboard.press('Escape');

    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');
    await shot(page, '06-analytics');

    await page.goto('/data');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type=file]').setInputFiles({
      name: 'raises.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'employee_code,new_salary,effective_from,change_reason\n' +
          'ACME-00005,99000,2026-12-01,MERIT\n' +
          'ACME-00006,72000,2026-12-01,PROMOTION\n' +
          'ACME-NOPE,99000,2026-12-01,MERIT\n',
      ),
    });
    await page.getByText('No employee with code ACME-NOPE').waitFor();
    await shot(page, '07-import-preview');

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await shot(page, '08-audit-log');
  });
});
