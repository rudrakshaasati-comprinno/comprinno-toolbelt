/**
 * extract.js - Turn an uploaded file into something a portal agent can read.
 *
 * Portal agents have `fs_read` only (no shell, most no fs_write), so how a file
 * is consumed depends on its format:
 *
 *   - NATIVE (agent reads the raw file by path): plain text / markdown / csv /
 *     json / source code, PDF, and images. fs_read handles these directly
 *     (Kiro reads PDFs and has vision for images).
 *   - EXTRACTED (we produce a sidecar .txt the agent reads instead): binary
 *     Office formats (xlsx/xls, docx) that fs_read cannot parse on its own.
 *
 * classifyFile() picks the strategy; extractText() runs the extractor for
 * EXTRACTED formats. The upload route saves the raw file always, plus the
 * sidecar for EXTRACTED formats, and points the agent at whichever path it can
 * actually read.
 */

import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";

// Extensions fs_read can open directly (no server-side extraction needed).
const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
  ".log", ".xml", ".html", ".htm",
  ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".go", ".rs", ".rb", ".php",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".sh", ".sql", ".toml", ".ini", ".env",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const PDF_EXTS = new Set([".pdf"]);

// Binary formats fs_read cannot parse -> we extract text server-side.
const EXCEL_EXTS = new Set([".xlsx", ".xlsm", ".xls"]);
const WORD_EXTS = new Set([".docx"]);

/**
 * Decide how an uploaded file should reach the agent.
 * @param {string} filename original filename (used for extension)
 * @returns {{ kind: string, strategy: string, ext: string }}
 *   kind: "text" | "pdf" | "image" | "excel" | "word" | "unknown"
 *   strategy:
 *     "native"       - agent reads the raw file at its path (text, images)
 *     "extract"      - server converts to a sidecar .txt the agent reads (xlsx/docx)
 *     "agent-extract"- agent converts it at read time via the shell tool
 *                      (pdftotext), gated behind the Allow/Deny approval prompt
 */
export function classifyFile(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (TEXT_EXTS.has(ext)) return { kind: "text", strategy: "native", ext };
  // Real PDFs store text in compressed streams that fs_read cannot decode, so
  // the agent extracts them itself with `pdftotext` (approval-gated). We do NOT
  // convert PDFs server-side — that is deliberately left to the agent's shell.
  if (PDF_EXTS.has(ext)) return { kind: "pdf", strategy: "agent-extract", ext };
  if (IMAGE_EXTS.has(ext)) return { kind: "image", strategy: "native", ext };
  if (EXCEL_EXTS.has(ext)) return { kind: "excel", strategy: "extract", ext };
  if (WORD_EXTS.has(ext)) return { kind: "word", strategy: "extract", ext };
  // Unknown: treat as native text-ish; fs_read will show what it can.
  return { kind: "unknown", strategy: "native", ext };
}

/**
 * Extract plain text from an Excel workbook buffer. Emits one block per sheet,
 * rows as tab-separated cells, so a downstream agent can reason over the values.
 */
async function extractExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  wb.eachSheet((sheet) => {
    out.push(`# Sheet: ${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed; slice(1) drops the leading hole.
      const cells = (row.values || []).slice(1).map((v) => {
        if (v == null) return "";
        if (typeof v === "object") {
          // ExcelJS rich values: formula result, hyperlink text, or rich text.
          if (v.result !== undefined) return String(v.result);
          if (v.text !== undefined) return String(v.text);
          if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
          if (v.hyperlink) return String(v.text || v.hyperlink);
          return JSON.stringify(v);
        }
        return String(v);
      });
      out.push(cells.join("\t"));
    });
    out.push("");
  });
  return out.join("\n");
}

/** Extract raw text from a .docx buffer via mammoth. */
async function extractWord(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value || "";
}

/**
 * Run the extractor for an EXTRACTED-strategy file.
 * @param {"excel"|"word"} kind
 * @param {Buffer} buffer
 * @returns {Promise<string>} extracted text
 */
export async function extractText(kind, buffer) {
  switch (kind) {
    case "excel":
      return extractExcel(buffer);
    case "word":
      return extractWord(buffer);
    default:
      throw new Error(`no text extractor for kind: ${kind}`);
  }
}
