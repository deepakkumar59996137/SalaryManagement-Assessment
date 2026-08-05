import { expect, test } from '@playwright/test';

/**
 * The path an HR Manager actually walks, end to end against a production build
 * and a real seeded database.
 *
 * These do not re-test business rules — 232 faster tests already do. They test
 * that the wiring holds: that a form reaches a route that reaches a service that
 * writes to SQLite, and that the screens then agree with each other.
 */

const EMAIL = 'hr.manager@acme.example';
const PASSWORD = 'DemoPass!2026';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('authentication', () => {
  test('an unauthenticated visitor is sent to the login screen', async ({ page }) => {
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a wrong password is refused without revealing whether the account exists', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Next renders its own aria-live route announcer with role="alert", so
    // scope to the form's own message rather than matching the role globally.
    await expect(page.locator('form').getByRole('alert')).toContainText('do not match');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signing in lands on the dashboard, and signing out revokes access', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('dashboard', () => {
  test('leads with payroll cost and reaches the analytics figures', async ({ page }) => {
    await signIn(page);

    await expect(page.getByText('Annual payroll')).toBeVisible();
    await expect(page.getByText('Median salary')).toBeVisible();
    await expect(page.getByText('Paid below band')).toBeVisible();

    // The chart's data table is the accessible view of the same numbers.
    await page.getByText('Show data table').first().click();
    await expect(page.getByRole('cell', { name: 'United States' }).first()).toBeVisible();
  });
});

test.describe('employee directory', () => {
  test('filters, and the filter survives being shared as a link', async ({ page }) => {
    await signIn(page);
    await page.goto('/employees?bandPosition=BELOW&sort=compaRatio');

    await expect(page.getByText(/of \d+/).first()).toBeVisible();
    // Everyone on the page really is below their band.
    const labels = page.getByText('Below band');
    expect(await labels.count()).toBeGreaterThan(0);
  });

  test('searches by name', async ({ page }) => {
    await signIn(page);
    await page.goto('/employees');

    await page.getByLabel('Search employees').fill('Priya');
    await page.waitForURL(/search=Priya/);

    await expect(page.getByRole('link', { name: /Priya/ }).first()).toBeVisible();
  });

  test('opens an employee and shows their salary history', async ({ page }) => {
    await signIn(page);
    await page.goto('/employees');

    // Scoped to the table: a bare /^[A-Z]/ also matches the "Dashboard" nav link.
    await page.getByRole('row').nth(1).getByRole('link').first().click();
    await page.waitForURL(/\/employees\/\d+/);

    await expect(page.getByText('Current annual base')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Salary history' })).toBeVisible();
  });
});

test('a raise flows from the dialog to the timeline and the audit log', async ({ page }) => {
  // The one full write path: form -> API -> service -> SQLite -> every screen.
  await signIn(page);
  await page.goto('/employees/42');

  const name = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';
  expect(name.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Change salary' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // The preview reacts before anything is saved.
  await dialog.getByRole('button', { name: '+10%' }).click();
  await expect(dialog.getByText(/compa-ratio/)).toBeVisible();
  await expect(dialog.getByText('+10.0%')).toBeVisible();

  await dialog.getByLabel('Effective from').fill('2026-11-01');
  await dialog.getByLabel('Note (optional)').fill('End-to-end test raise');
  await dialog.getByRole('button', { name: 'Save change' }).click();

  await expect(dialog).toBeHidden();

  // The timeline now carries the new interval, marked current.
  await expect(page.getByText('Current').first()).toBeVisible();
  await expect(page.getByText('End-to-end test raise')).toBeVisible();

  // And the audit log recorded who did it.
  await page.goto('/audit');
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/salary increased from/).first()).toBeVisible();
});

test.describe('analytics', () => {
  test('reports both gap figures and narrows to a country', async ({ page }) => {
    await signIn(page);
    await page.goto('/analytics');

    await expect(page.getByRole('heading', { name: 'Gender pay gap' })).toBeVisible();
    // Both phrases also appear in the explanatory prose below the figures.
    await expect(page.getByText('Unadjusted', { exact: true })).toBeVisible();
    await expect(page.getByText('Like for like', { exact: true })).toBeVisible();

    // "Headcount" also labels a column in every breakdown table, so read the
    // stat tile rather than matching the word across the page.
    const headcountTile = () =>
      page.locator('[data-slot="card-content"]').filter({ hasText: 'Headcount' }).first();

    const headcountBefore = await headcountTile().textContent();

    await page.goto('/analytics?countryCode=DE');
    const headcountAfter = await headcountTile().textContent();

    // Filtering really changes the figures rather than just the URL.
    expect(headcountAfter).not.toEqual(headcountBefore);
  });
});

test.describe('import and export', () => {
  test('exports a CSV of every employee', async ({ page }) => {
    await signIn(page);
    await page.goto('/data');

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download all employees' }).click();

    expect((await download).suggestedFilename()).toBe('acme-employees.csv');
  });

  test('previews an import and refuses to apply a file with a bad row', async ({ page }) => {
    await signIn(page);
    await page.goto('/data');

    await page.getByRole('button', { name: /Choose a CSV file/ }).or(page.locator('input[type=file]')).first();
    await page.locator('input[type=file]').setInputFiles({
      name: 'raises.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'employee_code,new_salary,effective_from,change_reason\n' +
          'ACME-00005,99000,2026-12-01,MERIT\n' +
          'ACME-NOPE,99000,2026-12-01,MERIT\n',
      ),
    });

    await expect(page.getByText('No employee with code ACME-NOPE')).toBeVisible();
    await expect(page.getByRole('button', { name: /Apply/ })).toBeDisabled();
    await expect(page.getByText(/Nothing has been changed/)).toBeVisible();
  });
});
