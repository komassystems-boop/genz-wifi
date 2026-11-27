import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth";
import packageRoutes from "./routes/packages";
import paymentRoutes from "./routes/payments";
import voucherRoutes from "./routes/vouchers";

const app = express();

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Allow the deployed GENZ WIFI customer site, plus any origins configured
// in Render's CORS_ORIGIN environment variable.
const allowedOrigins = new Set([
  "https://genz-wifi.onrender.com",
  ...configuredOrigins,
]);

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (health checks/server tools) are allowed.
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  })
);

app.use(express.json({ limit: "100kb" }));

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "GENZ WIFI API" })
);

app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/vouchers", voucherRoutes);

const port = Number(process.env.PORT || 4000);
app.listen(port, () =>
  console.log(`GENZ WIFI API listening on port ${port}`)
);
