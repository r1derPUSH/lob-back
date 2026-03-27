import { Router, Request, Response } from "express";

const router = Router();

router.post("/orders-paid", async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;

  res.status(200).send("OK");

  try {
    const order = JSON.parse(rawBody.toString());
    console.log("[TEST] RAW ORDER PAYLOAD:", JSON.stringify(order, null, 2));
  } catch (err) {
    console.error("[TEST] Failed to parse payload:", err);
  }
});

export default router;
