/**
 * Middleware Express generique de validation Zod pour req.body.
 *
 * Usage:
 *   router.post("/endpoint", validateBody(MyZodSchema), handler);
 *
 * - En cas d'echec : repond 400 avec { error, details: [{field, message}] }
 * - En cas de succes : req.body est remplace par les donnees parsees (strip des cles inconnues)
 */

import type { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Corps de requete invalide.",
        details: result.error.errors.map((e) => ({
          field: e.path.join(".") || "(root)",
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
