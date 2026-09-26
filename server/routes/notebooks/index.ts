import { Router } from "express";
import multer from "multer";

import { createNotebooksCrudRouter } from "./notebooksCrudRouter.js";
import { createSourcesRouter } from "./sourcesRouter.js";
import { createChatRouter } from "./chatRouter.js";
import { createNotesRouter } from "./notesRouter.js";
import { createContentRouter } from "./contentRouter.js";
import { createAudioRouter } from "./audioRouter.js";
import { createEmbeddingsRouter } from "./embeddingsRouter.js";
import { createQueueRouter } from "./queueRouter.js";
import { createCacheRouter } from "./cacheRouter.js";
import { createBackupRouter } from "./backupRouter.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(pdf|txt|md|html|docx|doc|rtf|csv|json|yaml|yml|png|jpg|jpeg|gif|webp|bmp|svg)$/i;
    if (
      file.originalname.match(allowed) ||
      file.mimetype.startsWith("text/") ||
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/json"
    ) {
      cb(null, true);
    } else {
      cb(new Error(`Type non supporté: ${file.mimetype}`));
    }
  },
});

export function createNotebooksRouter(): Router {
  const router = Router();

  router.use(createNotebooksCrudRouter());
  router.use(createSourcesRouter(upload));
  router.use(createChatRouter());
  router.use(createNotesRouter());
  router.use(createContentRouter());
  router.use(createAudioRouter());
  router.use(createEmbeddingsRouter());
  router.use(createQueueRouter());
  router.use(createCacheRouter());
  router.use(createBackupRouter());

  return router;
}

export { createNotebooksCrudRouter } from "./notebooksCrudRouter.js";
export { createSourcesRouter } from "./sourcesRouter.js";
export { createChatRouter } from "./chatRouter.js";
export { createNotesRouter } from "./notesRouter.js";
export { createContentRouter } from "./contentRouter.js";
export { createAudioRouter } from "./audioRouter.js";
export { createEmbeddingsRouter } from "./embeddingsRouter.js";
export { createQueueRouter } from "./queueRouter.js";
export { createCacheRouter } from "./cacheRouter.js";
export { createBackupRouter } from "./backupRouter.js";
export { buildRevealPresentation, countSlides } from "./slidesTheme.js";
