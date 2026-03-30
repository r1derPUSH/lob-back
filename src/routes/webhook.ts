import { Router, Request, Response } from "express";

const DRY_RUN = false;

function isPlannerOrder(order: any) {
  return order.line_items?.some((item: any) =>
    item.properties?.some((p: any) => p.name === "subscriptionPlannerId"),
  );
}

async function shopifyGraphQL(query: string, variables: any) {
  const res = await fetch(
    `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const data = await res.json();

  if (data.errors) {
    console.error("GraphQL error:", data.errors);
  }

  return data;
}

const CREATE_ORDER = `
mutation orderCreate($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order {
      id
      name
    }
    userErrors {
      field
      message
    }
  }
}
`;

const router = Router();

router.post("/orders-paid", async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;

  res.status(200).send("OK");

  try {
    const order = JSON.parse(rawBody.toString());

    console.log("Order received:", order.id);

    const tags = order.tags
      ? order.tags.split(",").map((t: string) => t.trim())
      : [];

    if (!isPlannerOrder(order)) {
      console.log("Skip: not planner");
      return;
    }

    if (tags.some((t: string) => t.startsWith("SPLIT_FROM"))) {
      console.log("Skip: already split");
      return;
    }

    console.log("Planner order detected");

    if (order.note?.includes("SPLIT_DONE")) {
      console.log("⛔ Already processed");
      return;
    }

    const groups: Record<string, any[]> = {};

    for (const item of order.line_items) {
      const zapietProp = item.properties?.find(
        (p: any) => p.name === "_ZapietId",
      );

      if (!zapietProp) continue;

      const zapietId = zapietProp.value;

      if (!groups[zapietId]) {
        groups[zapietId] = [];
      }

      groups[zapietId].push(item);
    }

    console.log("GROUPED ORDERS:", groups);

    if (Object.keys(groups).length > 20) {
      console.log("🚨 TOO MANY SPLITS — skipping");
      return;
    }

    for (const zapietId in groups) {
      const items = groups[zapietId];

      console.log("SPLIT PREVIEW:", {
        originalOrderId: order.id,
        zapietId,
        itemsCount: items.length,
        items: items.map((i: any) => ({
          title: i.title,
          quantity: i.quantity,
          variant_id: i.variant_id,
        })),
      });
    }

    if (DRY_RUN) {
      console.log("DRY RUN ENABLED — no orders will be created");
      return;
    }

    for (const zapietId in groups) {
      const items = groups[zapietId];

      console.log("🚀 Creating split order for:", zapietId);

      const lineItems = items.map((item: any) => ({
        variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
        quantity: item.quantity,
        customAttributes: item.properties?.map((p: any) => ({
          key: p.name,
          value: p.value,
        })),
      }));

      const variables = {
        order: {
          lineItems,
          tags: [`SPLIT_FROM_${order.id}`],
          note: `Split from order ${order.name} | ${zapietId} | SPLIT_DONE`,
        },
      };

      const result = await shopifyGraphQL(CREATE_ORDER, variables);

      if (result?.data?.orderCreate?.userErrors?.length) {
        console.error("USER ERRORS:", result.data.orderCreate.userErrors);
      }

      const createdOrderId = result?.data?.orderCreate?.order?.id;

      if (createdOrderId) {
        console.log("✅ CREATED ORDER:", createdOrderId);
      }

      console.log("CREATE RESULT:", JSON.stringify(result, null, 2));
    }

    console.log("Line items:", order.line_items?.length);
    console.log(
      "Properties:",
      order.line_items?.map((i: any) => i.properties),
    );
  } catch (err) {
    console.error("ERROR:", err);
  }
});

export default router;
