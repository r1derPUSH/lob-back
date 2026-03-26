import { Router, Request, Response } from "express";
import { verifyShopifyWebhook } from "../utils/verifyWebhook";
import { splitOrderByDeliveryDate } from "../utils/orderSplitter";
import { cancelOrder, createOrder } from "../services/shopify";

const router = Router();

router.post("/orders-paid", async (req: Request, res: Response) => {
  const hmac = req.headers["x-shopify-hmac-sha256"] as string;
  const rawBody = req.body as Buffer;

  // 1. Verify webhook authenticity
  if (!hmac || !verifyShopifyWebhook(rawBody, hmac)) {
    return res.status(401).send("Unauthorized");
  }

  // 2. Respond 200 immediately — Shopify requires response within 5s
  res.status(200).send("OK");

  // 3. Process asynchronously
  try {
    const order = JSON.parse(rawBody.toString());
    const orderGroups = splitOrderByDeliveryDate(order);

    if (orderGroups.length <= 1) {
      // Only one delivery date — no splitting needed
      console.log(`Order ${order.id}: single delivery date, skipping split`);
      return;
    }

    // Cancel original order (no restock, no customer notification)
    await cancelOrder(order.admin_graphql_api_id);

    // Create one new order per delivery date
    for (const group of orderGroups) {
      await createOrder(order, group);
    }

    console.log(`Order ${order.id}: split into ${orderGroups.length} orders`);
  } catch (err) {
    console.error("Error processing order split:", err);
  }
});

export default router;
