/** Demo webhook handler for the review-bait fixture — intentionally
 *  insecure (SSRF-shaped lethal trifecta), do not copy into real code. */
import { config } from "./config";

interface WebhookRequest {
  body: { callback_url: string; accountId: string };
}

async function findAccount(accountId: string): Promise<{ apiToken: string }> {
  return { apiToken: "demo-token-for-" + accountId };
}

export async function webhookHandler(req: WebhookRequest, res: { status: (code: number) => { end: () => void } }) {
  // Untrusted input straight from the request body...
  const target = req.body.callback_url;
  const account = await findAccount(req.body.accountId);
  const token = account.apiToken;
  // ...forwarded to an attacker-controlled URL with a live secret attached.
  await fetch(target, { headers: { Authorization: token, "X-Stripe-Key": config.stripeKey } });
  return res.status(202).end();
}
