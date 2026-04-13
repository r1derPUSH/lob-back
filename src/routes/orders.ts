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

const GET_ORDER = `
  query getOrder($id: ID!) {
    order(id: $id) {
      id
      name
      cancelledAt
      customer {
        id
      }
      lineItems(first: 50) {
        edges {
          node {
            title
            quantity
            image { url }
            variant { id }
            originalUnitPriceSet {
              shopMoney { amount }
            }
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

const CANCEL_ORDER = `
  mutation orderCancel($orderId: ID!) {
    orderCancel(
      orderId: $orderId
      reason: CUSTOMER
      refund: false
      restock: false
      notifyCustomer: false
    ) {
      job { id }
      userErrors { field message }
    }
  }
`;

function getTodayUAE(): Date {
  const now = new Date();
  const uaeOffset = 4 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + uaeOffset * 60000);
}

function isCancellable(deliveryDateStr: string): boolean {
  const today = getTodayUAE();
  today.setHours(0, 0, 0, 0);

  const delivery = new Date(deliveryDateStr);
  delivery.setHours(0, 0, 0, 0);

  const diffDays =
    (delivery.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

  return diffDays > 1;
}

router.post("/:id/cancel", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customerId } = req.body;

  if (!customerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderId = `gid://shopify/Order/${id}`;

  try {
    const orderRes = await shopifyGraphQL(GET_ORDER, { id: orderId });
    const order = orderRes?.data?.order;

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const orderCustomerId = order.customer?.id?.replace(
      "gid://shopify/Customer/",
      "",
    );
    if (String(orderCustomerId) !== String(customerId)) {
      console.warn(
        `Customer ${customerId} tried to cancel order belonging to ${orderCustomerId}`,
      );
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (order.cancelledAt) {
      res.status(400).json({ error: "Order is already cancelled" });
      return;
    }

    const allAttributes: { key: string; value: string }[] =
      order.lineItems.edges.flatMap(
        (edge: any) => edge.node.customAttributes ?? [],
      );

    const isPlannerOrder = allAttributes.some(
      (a) => a.key === "_subscriptionPlannerId",
    );
    if (!isPlannerOrder) {
      console.warn(`Cancel attempt on non-planner order: ${id}`);
      res
        .status(403)
        .json({ error: "This order cannot be cancelled via this endpoint" });
      return;
    }

    const deliveryDateAttr = allAttributes.find(
      (a) => a.key === "Delivery date",
    );
    if (!deliveryDateAttr?.value) {
      console.warn(`No delivery date on order: ${id}`);
      res.status(400).json({ error: "Order has no delivery date" });
      return;
    }

    if (!isCancellable(deliveryDateAttr.value)) {
      res.status(400).json({
        error: "not_cancellable",
        message:
          "This delivery can no longer be cancelled. Orders are charged one day before delivery and cannot be cancelled after payment has been taken.",
      });
      return;
    }

    const cancelRes = await shopifyGraphQL(CANCEL_ORDER, { orderId });
    const userErrors = cancelRes?.data?.orderCancel?.userErrors;

    if (userErrors?.length) {
      console.error("Cancel errors:", userErrors);
      res
        .status(500)
        .json({ error: "Failed to cancel order", details: userErrors });
      return;
    }

    console.log(`Order ${id} cancelled by customer ${customerId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("ERROR cancelling order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const customerId = req.query.customerId as string;

  if (!customerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderId = `gid://shopify/Order/${id}`;

  try {
    const orderRes = await shopifyGraphQL(GET_ORDER, { id: orderId });
    const order = orderRes?.data?.order;

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // Verify order belongs to this customer
    const orderCustomerId = order.customer?.id?.replace(
      "gid://shopify/Customer/",
      "",
    );
    if (String(orderCustomerId) !== String(customerId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Parse line items
    const allAttributes: { key: string; value: string }[] =
      order.lineItems.edges.flatMap(
        (edge: any) => edge.node.customAttributes ?? [],
      );

    const isPlannerOrder = allAttributes.some(
      (a) => a.key === "_subscriptionPlannerId",
    );
    if (!isPlannerOrder) {
      res.status(403).json({ error: "Not a planner order" });
      return;
    }

    const deliveryDate =
      allAttributes.find((a) => a.key === "Delivery date")?.value ?? "";
    const zapietId =
      allAttributes.find((a) => a.key === "_ZapietId")?.value ?? "";

    // Parse location from ZapietId e.g. M=D&L=252511&D=...
    const locationMatch = zapietId.match(/L=(\d+)/);
    const locationId = locationMatch ? locationMatch[1] : "252511";

    const products = order.lineItems.edges.map((edge: any) => {
      const node = edge.node;
      const attrs = node.customAttributes ?? [];
      const slicedAttr = attrs.find(
        (a: any) =>
          a.key === "Would you like your bread sliced?" || a.key === "sliced",
      );
      return {
        variantId: node.variant?.id?.replace(
          "gid://shopify/ProductVariant/",
          "",
        ),
        title: node.title,
        price: node.originalUnitPriceSet?.shopMoney?.amount
          ? Math.round(
              parseFloat(node.originalUnitPriceSet.shopMoney.amount) * 100,
            )
          : 0,
        qty: node.quantity,
        image: node.image?.url ?? null,
        hasSliced: !!slicedAttr,
        sliced: slicedAttr?.value === "Yes" || slicedAttr?.value === "yes",
      };
    });

    res.json({
      id: id,
      name: order.name,
      deliveryDate,
      locationId,
      cancelledAt: order.cancelledAt,
      products,
    });
  } catch (err) {
    console.error("ERROR fetching order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const LOCATION_IDS: Record<string, string> = {
  "252511": "Dubai",
  "252716": "Sharjah",
  "252718": "Abu Dhabi",
  "252717": "Al Ain",
};

const CITY_DELIVERY_DAYS: Record<string, number[]> = {
  Dubai: [0, 1, 2, 3, 4, 5, 6],
  Sharjah: [0, 1, 2, 3, 4, 5, 6],
  "Abu Dhabi": [0, 3, 5],
  "Al Ain": [2],
};

function isDateEditable(deliveryDateStr: string): boolean {
  return isCancellable(deliveryDateStr); // same D-1 cutoff
}

function buildZapietId(date: string, locationId: string): string {
  const d = new Date(date);
  const iso = d
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/T\d{2}:\d{2}:\d{2}Z$/, "T00:00:00Z");
  return `M=D&L=${locationId}&D=${iso}`;
}

const BREAD_TITLES = new Set([
  "ORGANIC SOURDOUGH ANCIENT GRAINS II - TOURTE DE MEULE",
  "ORGANIC OVERNIGHT OATS SOURDOUGH",
  "ORGANIC SOURDOUGH ANCIENT GRAINS I - BATARD",
  "ORGANIC FRENCH WHOLE WHEAT BREAD - TOURTE DE MEULE",
  "CINNAMON CHERRY BRIOCHE - DELIVERY ON FRIDAY ONLY!",
  "WALNUT RAISIN SOURDOUGH",
  "ARTISAN BRIOCHE BUNS - PACK OF FOUR",
  "ORGANIC FRENCH COUNTRY BREAD - TOURTE DE MEULE",
  "ORGANIC SOURDOUGH WHOLE WHEAT BATARD",
  "ORGANIC SOURDOUGH MULTI SEED",
  "ORGANIC SOURDOUGH FRENCH RYE",
  "CHOCOLATE CHIP BRIOCHE - DELIVERY ON FRIDAY ONLY!",
  "TRADITIONAL FRENCH BRIOCHE - DELIVERY ON FRIDAY ONLY!",
  "ORGANIC SOURDOUGH COUNTRY BATARD",
  "ORGANIC SOURDOUGH WHOLE WHEAT SANDWICH LOAF",
  "ORGANIC SOURDOUGH COUNTRY SANDWICH LOAF",
]);

router.post("/:id/edit", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customerId, deliveryDate, products, isSubscriber } = req.body;

  if (!customerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (
    !deliveryDate ||
    !products ||
    !Array.isArray(products) ||
    products.length === 0
  ) {
    res.status(400).json({ error: "deliveryDate and products are required" });
    return;
  }

  const orderId = `gid://shopify/Order/${id}`;

  try {
    // 1. Fetch order
    const orderRes = await shopifyGraphQL(GET_ORDER, { id: orderId });
    const order = orderRes?.data?.order;

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // 2. Verify ownership
    const orderCustomerId = order.customer?.id?.replace(
      "gid://shopify/Customer/",
      "",
    );
    if (String(orderCustomerId) !== String(customerId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // 3. Check planner order
    const allAttributes: { key: string; value: string }[] =
      order.lineItems.edges.flatMap(
        (edge: any) => edge.node.customAttributes ?? [],
      );

    const isPlannerOrder = allAttributes.some(
      (a) => a.key === "_subscriptionPlannerId",
    );
    if (!isPlannerOrder) {
      res.status(403).json({ error: "Not a planner order" });
      return;
    }

    const plannerId =
      allAttributes.find((a) => a.key === "_subscriptionPlannerId")?.value ??
      "";

    // 4. Re-validate delivery date (D-1 cutoff)
    if (!isDateEditable(deliveryDate)) {
      res.status(400).json({
        error: "not_editable",
        message:
          "This delivery can no longer be edited. Orders are locked one day before delivery.",
      });
      return;
    }

    // 5. Validate delivery day for city
    const zapietId =
      allAttributes.find((a) => a.key === "_ZapietId")?.value ?? "";
    const locationMatch = zapietId.match(/L=(\d+)/);
    const locationId = locationMatch ? locationMatch[1] : "252511";
    const city = LOCATION_IDS[locationId] ?? "Dubai";
    const allowedDays = CITY_DELIVERY_DAYS[city] ?? [0, 1, 2, 3, 4, 5, 6];
    const deliveryDayOfWeek = new Date(deliveryDate).getDay();

    if (!allowedDays.includes(deliveryDayOfWeek)) {
      res
        .status(400)
        .json({ error: "Delivery date is not available for your city" });
      return;
    }

    // 6. Cancel original order
    const cancelRes = await shopifyGraphQL(CANCEL_ORDER, { orderId });
    const cancelErrors = cancelRes?.data?.orderCancel?.userErrors;
    if (cancelErrors?.length) {
      console.error("Cancel errors on edit:", cancelErrors);
      res
        .status(500)
        .json({ error: "Failed to update order", details: cancelErrors });
      return;
    }

    // 7. Create new order with updated data
    const newZapietId = buildZapietId(deliveryDate, locationId);

    const totalBreadQty = products
      .filter((p: any) => BREAD_TITLES.has(p.title?.toUpperCase().trim()))
      .reduce((sum: number, p: any) => sum + p.qty, 0);

    const lineItems = products.map((p: any) => {
      const isBread = BREAD_TITLES.has(p.title?.toUpperCase().trim());
      const hasDiscount = isSubscriber && isBread && totalBreadQty >= 3;

      return {
        variantId: `gid://shopify/ProductVariant/${p.variantId}`,
        quantity: p.qty,
        appliedDiscount: hasDiscount
          ? {
              value: "10",
              valueType: "PERCENTAGE",
              title: "Bread Discount",
            }
          : null,
        properties: [
          { name: "_ZapietId", value: newZapietId },
          { name: "_subscriptionPlannerId", value: plannerId },
          { name: "Delivery date", value: deliveryDate },
          ...(p.hasSliced
            ? [
                {
                  name: "Would you like your bread sliced?",
                  value: p.sliced ? "Yes" : "No",
                },
              ]
            : []),
        ],
      };
    });

    const createRes = await shopifyGraphQL(
      `
      mutation orderCreate($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          order { id name }
          userErrors { field message }
        }
      }
    `,
      {
        order: {
          lineItems,
          customerId: `gid://shopify/Customer/${customerId}`,
          tags: [`SPLIT_FROM_${id}_EDIT`],
          note: `Edited from order ${id} | ${newZapietId}`,
        },
      },
    );

    console.log("CREATE RESULT:", JSON.stringify(createRes, null, 2));

    const createErrors = createRes?.data?.orderCreate?.userErrors;
    if (createErrors?.length) {
      console.error("Create errors on edit:", createErrors);
      res.status(500).json({
        error: "Failed to create updated order",
        details: createErrors,
      });
      return;
    }

    const newOrder = createRes?.data?.orderCreate?.order;
    console.log(`Order ${id} edited → new order ${newOrder?.id}`);
    res.json({
      ok: true,
      newOrderId: newOrder?.id,
      newOrderName: newOrder?.name,
    });
  } catch (err) {
    console.error("ERROR editing order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
