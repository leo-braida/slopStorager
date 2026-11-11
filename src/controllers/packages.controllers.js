import {
  processPackageUpload,
  getPackagesByMinCount,
  getPublishablePackagesByMinCount,
} from "../services/packages.services.js";

/**
 * POST /packages/upload
 */
export async function uploadPackagesController(req, res) {
  try {
    let content = "";

    if (Array.isArray(req.files) && req.files.length > 0) {
      content = req.files.map((f) => f.buffer.toString("utf8")).join("\n");
    } else if (typeof req.body === "string" && req.body.trim().length > 0) {
      content = req.body;
    } else {
      return res.status(400).json({
        error:
          "No file or dataset content provided. Upload a file via multipart/form-data or send raw content in the request body.",
      });
    }

    const schemaName =
      (typeof req.query.schemaName === "string" &&
        req.query.schemaName.trim()) ||
      (req.body &&
        typeof req.body === "object" &&
        typeof req.body.schemaName === "string" &&
        req.body.schemaName.trim()) ||
      null;

    const result = await processPackageUpload({ content, schemaName });

    return res.status(200).json({
      message: "File uploaded and database populated successfully.",
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in POST /packages/upload:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while processing upload." });
  }
}

/**
 * GET /packages
 */
export async function getPackagesController(req, res) {
  try {
    const packages = await getPackagesByMinCount(req.query.minCount);
    return res.status(200).json(packages);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in GET /packages:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while fetching packages." });
  }
}

/**
 * GET /packages/publishable
 */
export async function getPublishablePackagesController(req, res) {
  try {
    const results = await getPublishablePackagesByMinCount(req.query.minCount);
    return res.status(200).json(results);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in GET /packages/publishable:", error);
    return res.status(500).json({
      error: "Internal server error while checking publishable packages.",
    });
  }
}
