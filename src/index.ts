import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routes/webhook";
import inventoryRouter from "./routes/inventory";
import ordersRouter from "./routes/orders";

import cors from "cors";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      if (
        !origin ||
        origin.includes("shopifypreview.com") ||
        origin.includes("fortheloveofbread.ae") ||
        origin.includes("fortheloveofbreaddubai.com") ||
        origin.includes("localhost")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-presence-secret",
      "x-planner-secret",
    ],
    credentials: true,
  }),
);

const PORT = process.env.PORT || 3000;

app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhooks", webhookRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/orders", ordersRouter); // ← сюди

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
