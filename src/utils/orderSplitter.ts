// Adjust this based on how the planner stores delivery date on each line item.
// Common approaches: line_item.properties[], or order.note_attributes[].
// Example assumes line item property named "delivery_date".

export interface LineItemGroup {
  deliveryDate: string;
  lineItems: any[];
}

export function splitOrderByDeliveryDate(order: any): LineItemGroup[] {
  const groups: Record<string, any[]> = {};

  for (const item of order.line_items) {
    const dateProp = item.properties?.find(
      (p: any) => p.name === "delivery_date",
    );
    const deliveryDate = dateProp?.value ?? "unknown";

    if (!groups[deliveryDate]) {
      groups[deliveryDate] = [];
    }
    groups[deliveryDate].push(item);
  }

  return Object.entries(groups).map(([deliveryDate, lineItems]) => ({
    deliveryDate,
    lineItems,
  }));
}
