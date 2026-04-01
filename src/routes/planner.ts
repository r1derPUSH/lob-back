import { Router, Request, Response } from "express";

const router = Router();

router.post("/checkout", async (req: Request, res: Response) => {
  try {
    const { items } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: "No items" });
    }

    const line_items = items.map((item: any) => ({
      variant_id: item.id,
      quantity: item.quantity,
      properties: Object.entries(item.properties || {}).map(
        ([name, value]) => ({
          name,
          value,
        }),
      ),
    }));

    console.log("🧾 Draft line_items:", line_items);

    const response = await fetch(
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-01/draft_orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
        },
        body: JSON.stringify({
          draft_order: {
            line_items,
            tags: "PLANNER_DEV",
            note: "Created from planner",
          },
        }),
      },
    );

    const data = await response.json();

    console.log("Shopify response:", data);

    const url = data?.draft_order?.invoice_url;

    if (!url) {
      return res.status(500).json({ error: "No checkout url" });
    }

    return res.json({ url });
  } catch (err) {
    console.error("Draft error:", err);
    return res.status(500).json({ error: "Draft failed" });
  }
});

export default router;
