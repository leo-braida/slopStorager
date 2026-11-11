import express from "express";
import { connectDB } from "./config/db.js";
import schemasRouter from "./routes/schemas.routes.js";
import packagesRouter from "./routes/packages.routes.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use("/schemas", schemasRouter);
app.use("/packages", packagesRouter);

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();

export { app };
