import crypto from "crypto";

export function verifyShopifyWebhook(
  rawBody: Buffer,
  hmacHeader: string,
): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET!;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}
