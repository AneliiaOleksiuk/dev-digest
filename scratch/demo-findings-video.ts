/**
 * TEMPORARY demo file for a screen recording of the findings-severity counter
 * and cost badge on the PR list / run history. Not part of the app — this PR
 * will be closed and the branch deleted right after recording.
 *
 * Intentionally contains obvious issues so a review agent has something to
 * flag: a hardcoded secret and an N+1 query.
 */

const STRIPE_SECRET_KEY = "PLACEHOLDER_NOT_A_REAL_STRIPE_SECRET_KEY_DO_NOT_USE";

export async function chargeAllCustomers(customerIds: string[], db: { query: (sql: string) => Promise<unknown> }) {
  const results = [];
  for (const id of customerIds) {
    // N+1: one query per customer instead of a single batched IN query.
    const customer = await db.query(`SELECT * FROM customers WHERE id = '${id}'`);
    results.push(customer);
  }
  return results;
}

export function getStripeClient() {
  return { apiKey: STRIPE_SECRET_KEY };
}
