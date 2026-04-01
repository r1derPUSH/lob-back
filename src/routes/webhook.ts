import { Router, Request, Response } from "express";

const DRY_RUN = false;

const PROPERTY_LABELS: Record<string, string> = {
  sliced: "Would you like your bread sliced?",
};

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

const CANCEL_ORDER = `
mutation orderCancel($orderId: ID!) {
  orderCancel(orderId: $orderId, reason: OTHER, refund: false, restock: false, notifyCustomer: false) {
    job { id }
    userErrors { field message }
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

    console.log(
      "Note attributes:",
      JSON.stringify(order.note_attributes, null, 2),
    );

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
        properties: item.properties?.map((p: any) => ({
          name: PROPERTY_LABELS[p.name] ?? p.name,
          value: p.value,
        })),
      }));

      const variables = {
        order: {
          lineItems,
          tags: [`SPLIT_FROM_${order.id}`],
          note: `Split from order ${order.name} | ${zapietId} | SPLIT_DONE`,
          customerId: `gid://shopify/Customer/${order.customer?.id}`,
          shippingAddress: order.shipping_address
            ? {
                firstName: order.shipping_address.first_name,
                lastName: order.shipping_address.last_name,
                address1: order.shipping_address.address1,
                city: order.shipping_address.city,
                countryCode: order.shipping_address.country_code,
                zip: order.shipping_address.zip,
                phone: order.shipping_address.phone,
              }
            : undefined,
          metafields: [
            {
              namespace: "zapiet",
              key: "location_id",
              value: zapietId.match(/L=(\d+)/)?.[1] ?? "",
              type: "single_line_text_field",
            },
            {
              namespace: "zapiet",
              key: "delivery_date",
              value: zapietId.match(/D=([^&]+)/)?.[1] ?? "",
              type: "single_line_text_field",
            },
          ],
        },
      };

      const result = await shopifyGraphQL(CREATE_ORDER, variables);

      if (result?.data?.orderCreate?.userErrors?.length) {
        console.error("USER ERRORS:", result.data.orderCreate.userErrors);
      }

      const createdOrderId = result?.data?.orderCreate?.order?.id;

      if (createdOrderId) {
        console.log(" CREATED ORDER:", createdOrderId);
      }

      console.log("CREATE RESULT:", JSON.stringify(result, null, 2));
    }

    await shopifyGraphQL(CANCEL_ORDER, {
      orderId: order.admin_graphql_api_id,
    });
    console.log("Original order cancelled:", order.id);

    // повертаємо DENY і -1 inventory
    for (const item of order.line_items) {
      const variantRes = await fetch(
        `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-01/variants/${item.variant_id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
          },
        },
      );
      const variantData = await variantRes.json();
      const inventoryItemId = variantData?.variant?.inventory_item_id;

      if (inventoryItemId) {
        await fetch(
          `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-01/inventory_levels/adjust.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
            },
            body: JSON.stringify({
              inventory_item_id: inventoryItemId,
              location_id: Number(process.env.SHOPIFY_LOCATION_ID),
              available_adjustment: -item.quantity,
            }),
          },
        );
      }

      await shopifyGraphQL(
        `mutation updateVariantPolicy($id: ID!) {
          productVariantUpdate(input: { id: $id, inventoryPolicy: DENY }) {
            productVariant { id inventoryPolicy }
            userErrors { field message }
          }
        }`,
        { id: `gid://shopify/ProductVariant/${item.variant_id}` },
      );
    }

    console.log("✅ inventory -1 and DENY restored");
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
