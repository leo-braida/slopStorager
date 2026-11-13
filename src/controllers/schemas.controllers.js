import {
  createSchema,
  getSchemas,
  updateSchemaByQuery,
  deleteSchemaByQuery,
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
 * GET /schemas (all schemas, or single schema via ?id={id} / ?name={name})
 */
export async function getSchemasController(req, res) {
  try {
    const result = await getSchemas(req.query);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in GET /schemas:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while fetching schemas." });
  }
}

/**
 * PUT /schemas?id={id} or PUT /schemas?name={name}
 */
export async function updateSchemaController(req, res) {
  try {
    const schema = await updateSchemaByQuery(req.query, req.body);
    return res.status(200).json({
      message: "Schema updated successfully.",
      schema,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in PUT /schemas:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while updating schema." });
  }
}

/**
 * DELETE /schemas?id={id} or DELETE /schemas?name={name}
 */
export async function deleteSchemaController(req, res) {
  try {
    const schema = await deleteSchemaByQuery(req.query);
    return res.status(200).json({
      message: "Schema deleted successfully.",
      schema,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error in DELETE /schemas:", error);
    return res
      .status(500)
      .json({ error: "Internal server error while deleting schema." });
  }
}
