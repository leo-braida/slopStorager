import { Router } from "express";
import express from "express";
import {
  createSchemaController,
  getAllSchemasController,
  getSchemaByIdentifierController,
  updateSchemaController,
  deleteSchemaController,
} from "../controllers/schemas.controllers.js";

const router = Router();
const jsonParser = express.json({ limit: "10mb" });

router.post("/", jsonParser, createSchemaController);
router.get("/", getAllSchemasController);
router.get("/:identifier", getSchemaByIdentifierController);
router.put("/:identifier", jsonParser, updateSchemaController);
router.delete("/:identifier", deleteSchemaController);

export default router;
