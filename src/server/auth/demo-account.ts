/**
 * The seeded HR Manager account.
 *
 * Lives in src/ rather than scripts/ because both the seed script and the login
 * screen need it — and scripts/ may import from src/, never the other way round.
 *
 * The credentials are shown on the login screen and the form is prefilled. That
 * is a deliberate affordance for a demo whose database re-seeds on every cold
 * start: without it, a reviewer opening the deployed URL has no way in. Set
 * HIDE_DEMO_CREDENTIALS=true to turn it off — which is what a real deployment
 * holding real salary data would do.
 */
export const DEMO_ACCOUNT = {
  email: process.env.SEED_HR_EMAIL ?? 'hr.manager@acme.example',
  password: process.env.SEED_HR_PASSWORD ?? 'DemoPass!2026',
  name: 'Alex Morgan',
} as const;

export function showDemoCredentials(): boolean {
  return process.env.HIDE_DEMO_CREDENTIALS !== 'true';
}
