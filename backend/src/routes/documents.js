import { Router } from "express";
import multer from "multer";
import { extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { putObject, getObjectBuffer, keys, deleteObject } from "../storage/storage.js";
import { classifyFile } from "../storage/extract.js";
import { addDocument, listDocuments, getDocument, deleteDocument } from "../domain/engagements.js";
import { authorizeEngagement } from "../http/auth.js";

export const documentsRouter = Router();

// Guard engagement-scoped document routes (:id = engagement id) so only the
// owner/collaborator can upload or list an engagement's documents.
documentsRouter.param("id", (req, res, next) => authorizeEngagement(req, res, next));

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB (matches the design's stated cap)
const MAX_FILES = 10;

// Allow-list of extensions we accept (validated in fileFilter — security).
const ALLOWED_EXTS = new Set([
  ".pdf", ".docx", ".xlsx", ".xlsm", ".xls", ".txt", ".md", ".csv", ".pptx",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname || "").toLowerCase();
    if (ALLOWED_EXTS.has(ext)) cb(null, true);
    else cb(new Error(`file type not allowed: ${ext || "(none)"}`));
  },
});

function safeName(original) {
  const ext = extname(original || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  const base = basename(original || "file", extname(original || ""))
    .replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "file";
  return `${base}${ext}`;
}

/**
 * POST /api/engagements/:id/documents
 * multipart/form-data: files[] (+ optional addedBy). Stores each raw file in
 * S3, extracts text for binary Office formats into a sidecar, and records a
 * document row. Returns the created document metadata.
 */
documentsRouter.post("/engagements/:id/documents", (req, res) => {
  upload.array("files", MAX_FILES)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files (field name must be 'files')" });

    const engagementId = req.params.id;
    const addedBy = req.body?.addedBy || null;
    const kind = ["source", "meeting_mom", "questionnaire"].includes(req.body?.kind) ? req.body.kind : "source";
    const results = [];

    for (const f of files) {
      const docId = randomUUID();
      const name = safeName(f.originalname);
      const rawKey = keys.sourceRaw(engagementId, docId, name);

      try {
        // Store a SINGLE object per document: the raw uploaded file. The agent
        // downloads raw source files from object storage and parses them itself
        // (its image has the needed extractors), so the backend no longer writes
        // a separate extracted-text sidecar. classifyFile is kept only to report
        // the detected kind back to the client.
        await putObject(rawKey, f.buffer, f.mimetype);
        const cls = classifyFile(f.originalname);

        const doc = await addDocument({
          engagementId, name, s3Key: rawKey, textS3Key: null, mime: f.mimetype, addedBy, kind,
        });
        results.push({ ...doc, kind: cls.kind });
      } catch (e) {
        results.push({ name, error: e.message });
      }
    }

    res.status(201).json({ documents: results });
  });
});

/** GET /api/engagements/:id/documents — list documents for an engagement. */
documentsRouter.get("/engagements/:id/documents", async (req, res) => {
  try { res.json({ documents: await listDocuments(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** DELETE /api/documents/:docId — remove a document (S3 objects + DB row). */
documentsRouter.delete("/documents/:docId", async (req, res) => {
  try {
    const doc = await getDocument(req.params.docId);
    if (!doc) return res.status(404).json({ error: "document not found" });
    await deleteObject(doc.s3_key);
    if (doc.text_s3_key) await deleteObject(doc.text_s3_key);
    await deleteDocument(doc.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /api/documents/download?key=... — stream a stored object back.
 * Backend-proxied download (v1). The key must be under engagements/ to prevent
 * reading arbitrary objects.
 */
documentsRouter.get("/documents/download", async (req, res) => {
  const key = String(req.query.key || "");
  if (!key.startsWith("engagements/")) {
    return res.status(400).json({ error: "invalid key" });
  }
  try {
    const buf = await getObjectBuffer(key);
    res.setHeader("Content-Disposition", `attachment; filename="${basename(key).replace(/["\r\n]/g, "_")}"`);
    res.send(buf);
  } catch (e) {
    res.status(404).json({ error: "not found" });
  }
});
