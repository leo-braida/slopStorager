import { Router } from "express";
import express from "express";
import {
  createSchemaController,
  getSchemasController,
  updateSchemaController,
  deleteSchemaController,
} from "../controllers/schemas.controllers.js";

const router = Router();
const jsonParser = express.json({ limit: "10mb" });

router.post("/", jsonParser, createSchemaController);
router.get("/", getSchemasController);
router.put("/", jsonParser, updateSchemaController);
router.delete("/", deleteSchemaController);

export default router;
