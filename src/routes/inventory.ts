import { Router, Request, Response } from "express";

const router = Router();

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
  return res.json();
}

const UPDATE_INVENTORY_POLICY = `
  mutation updateVariantPolicy($id: ID!, $policy: ProductVariantInventoryPolicy!) {
    productVariantUpdate(input: { id: $id, inventoryPolicy: $policy }) {
      productVariant { id inventoryPolicy inventoryItem { id } }
      userErrors { field message }
    }
  }
`;

const ADJUST_INVENTORY = `
  mutation adjustInventory($inventoryItemId: ID!, $locationId: ID!, $delta: Int!) {
    inventoryAdjustQuantities(input: {
      reason: "correction",
      name: "available",
      changes: [{
        inventoryItemId: $inventoryItemId,
        locationId: $locationId,
        delta: $delta
      }]
    }) {
      userErrors { field message }
    }
  }
`;

router.post("/set-policy", async (req: Request, res: Response) => {
  const secret = req.headers["x-planner-secret"];
  if (secret !== process.env.PLANNER_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { variantIds, policy } = req.body;

  if (!variantIds?.length || !policy) {
    res.status(400).json({ error: "variantIds and policy required" });
    return;
  }

  const results = await Promise.all(
    variantIds.map((id: number) =>
      shopifyGraphQL(UPDATE_INVENTORY_POLICY, {
        id: `gid://shopify/ProductVariant/${id}`,
        policy,
      }),
    ),
  );

  const errors = results.flatMap(
    (r) => r?.data?.productVariantUpdate?.userErrors ?? [],
  );

  if (errors.length) {
    console.error("Policy update errors:", errors);
    res.status(500).json({ errors });
    return;
  }

  if (policy === "CONTINUE") {
    await Promise.all(
      results.map((r) => {
        const inventoryItemId =
          r?.data?.productVariantUpdate?.productVariant?.inventoryItem?.id;
        if (!inventoryItemId) return;

        return shopifyGraphQL(ADJUST_INVENTORY, {
          inventoryItemId,
          locationId: `gid://shopify/Location/${process.env.SHOPIFY_LOCATION_ID}`,
          delta: 1,
        });
      }),
    );
    console.log(`✅ +1 inventory for`, variantIds);
  }

  console.log(`✅ inventoryPolicy set to ${policy} for`, variantIds);
  res.json({ ok: true });
});

export default router;
