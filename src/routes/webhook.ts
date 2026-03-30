import { Router, Request, Response } from "express";

function isPlannerOrder(order: any) {
  return order.line_items?.some((item: any) =>
    item.properties?.some((p: any) => p.name === "subscriptionPlannerId"),
  );
}

const router = Router();

router.post("/orders-paid", async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;

  res.status(200).send("OK");

  try {
    const order = JSON.parse(rawBody.toString());

    console.log("Order received:", order.id);

    const tags = order.tags ? order.tags.split(",") : [];

    if (!isPlannerOrder(order)) {
      console.log("Skip: not planner");
      return;
    }

    if (tags.includes("SPLIT_FROM")) {
      console.log("Skip: already split");
      return;
    }

    console.log("Planner order detected");

    console.log("Line items:", order.line_items?.length);
    console.log(
      "🧾 Properties:",
      order.line_items?.map((i: any) => i.properties),
    );
  } catch (err) {
    console.error("ERROR:", err);
  }
});

export default router;
