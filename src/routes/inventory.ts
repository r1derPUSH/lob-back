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

const GET_VARIANT = `
  query getVariant($id: ID!) {
    productVariant(id: $id) {
      id
      inventoryItem { id }
      product { id }
    }
  }
`;

const UPDATE_INVENTORY_POLICY = `
  mutation updateVariantPolicy($productId: ID!, $variantId: ID!, $policy: ProductVariantInventoryPolicy!) {
    productVariantsBulkUpdate(productId: $productId, variants: [{
      id: $variantId,
      inventoryPolicy: $policy
    }]) {
      productVariants {
        id
        inventoryPolicy
        inventoryItem { id }
      }
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

  const { variantQuantities, policy } = req.body;

  if (!variantQuantities || !policy) {
    res.status(400).json({ error: "variantQuantities and policy required" });
    return;
  }

  const variantIds = Object.keys(variantQuantities);

  const variantData = await Promise.all(
    variantIds.map((id) =>
      shopifyGraphQL(GET_VARIANT, {
        id: `gid://shopify/ProductVariant/${id}`,
      }),
    ),
  );

  console.log("Variant data:", JSON.stringify(variantData[0], null, 2));

  const results = await Promise.all(
    variantData.map((v) => {
      const variant = v?.data?.productVariant;
      if (!variant) return null;

      return shopifyGraphQL(UPDATE_INVENTORY_POLICY, {
        productId: variant.product.id,
        variantId: variant.id,
        policy,
      });
    }),
  );

  console.log("Policy result:", JSON.stringify(results[0], null, 2));

  const errors = results.flatMap(
    (r) => r?.data?.productVariantsBulkUpdate?.userErrors ?? [],
  );

  if (errors.length) {
    console.error("Policy update errors:", errors);
    res.status(500).json({ errors });
    return;
  }

  if (policy === "CONTINUE") {
    const adjustResults = await Promise.all(
      variantData.map((v, i) => {
        const variant = v?.data?.productVariant;
        const variantId = variantIds[i];
        const quantity = Number(variantQuantities[variantId]);
        const inventoryItemId = variant?.inventoryItem?.id;

        if (!inventoryItemId) {
          console.log(" No inventoryItemId for variant:", variantId);
          return;
        }

        console.log("Adjusting inventory:", {
          inventoryItemId,
          quantity,
          locationId: process.env.SHOPIFY_LOCATION_ID,
        });

        return shopifyGraphQL(ADJUST_INVENTORY, {
          inventoryItemId,
          locationId: `gid://shopify/Location/${process.env.SHOPIFY_LOCATION_ID}`,
          delta: quantity,
        });
      }),
    );

    console.log("Adjust results:", JSON.stringify(adjustResults, null, 2));
    console.log(`✅ +quantity inventory for`, variantQuantities);
  }

  console.log(`✅ inventoryPolicy set to ${policy} for`, variantIds);
  res.json({ ok: true });
});

export default router;
