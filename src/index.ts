import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routes/webhook";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Use raw body for webhook HMAC verification
app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhooks", webhookRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
