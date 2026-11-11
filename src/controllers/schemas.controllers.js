import {
  createSchema,
  getAllSchemas,
  getSchemaByIdentifier,
  updateSchemaByIdentifier,
  deleteSchemaByIdentifier,
} from "../services/schemas.services.js";

/**
 * POST /schemas
 */
export async function createSchemaController(req, res) {
  try {
    const schema = await createSchema(req.body);
    return res.status(201).json({
      message: "Schema created successfully.",
      schema,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in POST /schemas:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while creating schema." });
  }
}

/**
 * GET /schemas
 */
export async function getAllSchemasController(_req, res) {
  try {
    const schemas = await getAllSchemas();
    return res.status(200).json(schemas);
  } catch (error) {
    console.error("Error in GET /schemas:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while fetching schemas." });
  }
}

/**
 * GET /schemas/:identifier
 */
export async function getSchemaByIdentifierController(req, res) {
  try {
    const schemaDoc = await getSchemaByIdentifier(req.params.identifier);
    return res.status(200).json(schemaDoc);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in GET /schemas/:identifier:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while fetching schema." });
  }
}

/**
 * PUT /schemas/:identifier
 */
export async function updateSchemaController(req, res) {
  try {
    const schema = await updateSchemaByIdentifier(
      req.params.identifier,
      req.body,
    );
    return res.status(200).json({
      message: "Schema updated successfully.",
      schema,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in PUT /schemas/:identifier:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while updating schema." });
  }
}

/**
 * DELETE /schemas/:identifier
 */
export async function deleteSchemaController(req, res) {
  try {
    const schema = await deleteSchemaByIdentifier(req.params.identifier);
    return res.status(200).json({
      message: "Schema deleted successfully.",
      schema,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in DELETE /schemas/:identifier:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while deleting schema." });
  }
}
