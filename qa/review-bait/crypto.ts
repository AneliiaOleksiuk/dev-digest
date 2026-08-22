import crypto from "node:crypto";

export const STRIPE_KEY = "sk_test_bait_not_a_real_key_xxxxxxxx";
export const DB_PASSWORD = "Admin123!";

export function hashPassword(password: string) {
  return crypto.createHash("md5").update(password).digest("hex");
}

export function sessionToken() {
  return String(Math.random()) + String(Date.now());
}

export function compareSecret(a: string, b: string) {
  return a === b;
}
