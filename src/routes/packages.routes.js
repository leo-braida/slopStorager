import { Router } from "express";
import express from "express";
import multer from "multer";
import {
  uploadPackagesController,
  getPackagesController,
  getPublishablePackagesController,
} from "../controllers/packages.controllers.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

const textParser = express.text({ type: "*/*", limit: "50mb" });

router.post("/upload", upload.any(), textParser, uploadPackagesController);
router.get("/", getPackagesController);
router.get("/publishable", getPublishablePackagesController);

export default router;
