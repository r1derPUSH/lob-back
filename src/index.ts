import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routes/webhook";
import plannerRouter from "./routes/planner";
import cors from "cors";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: [
      "https://fortheloveofbread.ae",
      "https://www.fortheloveofbread.ae",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);

const PORT = process.env.PORT || 3000;

// Use raw body for webhook HMAC verification
app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhooks", webhookRouter);
app.use("/planner", plannerRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
