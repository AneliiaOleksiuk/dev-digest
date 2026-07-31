/** Demo config for the review-bait fixture — intentionally insecure, do not copy. */
export const config = {
  port: Number(process.env.PORT ?? 3080),
  // Live-looking key on purpose: bait for the Security Reviewer (CRITICAL).
  stripeKey: "sk_live_51H8xq2Ka9Vn3Pqi_m7RdBb74Xc",
  redisUrl: process.env.REDIS_URL,
};
