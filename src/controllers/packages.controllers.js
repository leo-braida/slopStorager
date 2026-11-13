import {
  createPackage,
  processPackageUpload,
  getPackages,
  getPublishablePackagesByMinCount,
  updatePackageByQuery,
  deletePackages,
} from "../services/packages.services.js";

/**
 * POST /packages
 */
export async function createPackageController(req, res) {
  try {
    const pkg = await createPackage(req.body);
    return res.status(201).json({
      message: "Package created successfully.",
      package: pkg,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in POST /packages:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while creating package." });
  }
}

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
 * GET /packages (list via ?minCount=, or single package via ?id={id} / ?name={name})
 */
export async function getPackagesController(req, res) {
  try {
    const result = await getPackages(req.query);
    return res.status(200).json(result);
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

/**
 * PUT /packages?id={id} or PUT /packages?name={name}
 */
export async function updatePackageController(req, res) {
  try {
    const pkg = await updatePackageByQuery(req.query, req.body);
    return res.status(200).json({
      message: "Package updated successfully.",
      package: pkg,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in PUT /packages:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while updating package." });
  }
}

/**
 * DELETE /packages?lastDate={YYYY-MM-DD}, DELETE /packages?name={name}, or DELETE /packages?id={id}
 */
export async function deletePackagesController(req, res) {
  try {
    const result = await deletePackages(req.query);
    return res.status(200).json({
      message: "Package(s) deleted successfully.",
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in DELETE /packages:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while deleting package(s)." });
  }
}
