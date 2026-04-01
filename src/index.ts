import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routes/webhook";
import inventoryRouter from "./routes/inventory";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhooks", webhookRouter);
app.use("/api/inventory", inventoryRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
