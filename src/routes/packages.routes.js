import { Router } from "express";
import express from "express";
import multer from "multer";
import {
  createPackageController,
  uploadPackagesController,
  getPackagesController,
  getPublishablePackagesController,
  updatePackageController,
  deletePackagesController,
} from "../controllers/packages.controllers.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

const jsonParser = express.json({ limit: "10mb" });
const textParser = express.text({ type: "*/*", limit: "50mb" });

router.post("/upload", upload.any(), textParser, uploadPackagesController);
router.post("/", jsonParser, createPackageController);
router.get("/", getPackagesController);
router.get("/publishable", getPublishablePackagesController);
router.put("/", jsonParser, updatePackageController);
router.delete("/", deletePackagesController);

export default router;
