const SHOPIFY_ENDPOINT = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-01/graphql.json`;

async function shopifyGraphQL(query: string, variables: object) {
  const res = await fetch(SHOPIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json()) as any;
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

// Cancel original order (irreversible — double-check before enabling notifyCustomer)
export async function cancelOrder(orderId: string) {
  const mutation = `
    mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean!) {
      orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer) {
        orderCancelUserErrors { field message }
        job { id }
      }
    }
  `;
  return shopifyGraphQL(mutation, {
    orderId,
    reason: "OTHER",
    refund: false, // original payment already captured — handle refund separately if needed
    restock: true,
    notifyCustomer: false,
  });
}

// Create a new order for one delivery date group
export async function createOrder(
  originalOrder: any,
  group: { deliveryDate: string; lineItems: any[] },
) {
  const mutation = `
    mutation orderCreate($order: OrderCreateOrderInput!) {
      orderCreate(order: $order) {
        userErrors { field message }
        order { id name }
      }
    }
  `;

  const lineItems = group.lineItems.map((item: any) => ({
    variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
    quantity: item.quantity,
  }));

  const variables = {
    order: {
      lineItems,
      financialStatus: "PAID",
      tags: [`delivery_date:${group.deliveryDate}`, "split-order"],
      note: `Split from order #${originalOrder.order_number} — Delivery: ${group.deliveryDate}`,
      customer: {
        toAssociate: {
          id: `gid://shopify/Customer/${originalOrder.customer.id}`,
        },
      },
      shippingAddress: originalOrder.shipping_address
        ? {
            firstName: originalOrder.shipping_address.first_name,
            lastName: originalOrder.shipping_address.last_name,
            address1: originalOrder.shipping_address.address1,
            city: originalOrder.shipping_address.city,
            provinceCode: originalOrder.shipping_address.province_code,
            countryCode: originalOrder.shipping_address.country_code,
            zip: originalOrder.shipping_address.zip,
          }
        : undefined,
    },
  };

  return shopifyGraphQL(mutation, variables);
}
