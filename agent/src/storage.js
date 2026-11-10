import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * storage.js - Agent-side downloader for an engagement's source files.
 *
 * The agent receives SHORT-LIVED, ENGAGEMENT-SCOPED credentials in the run
 * payload (`storage`), minted by the backend's token vending machine. Those
 * credentials can only read this engagement's prefix (engagements/{id}/*), so
 * this module cannot reach another engagement's data even if asked — isolation
 * is enforced by the storage layer, not by this code.
 *
 * It lists the objects under the scoped prefix and downloads each into a
 * per-run temp directory, returning local paths for the runner to hand to the
 * agent (fs_read) and to run pdftotext over.
 */

/** Build an S3 client from the scoped storage block in the run payload. */
function clientFor(storage) {
  return new S3Client({
    region: storage.region || "us-east-1",
    endpoint: storage.endpoint || undefined,
    forcePathStyle: storage.forcePathStyle !== false,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      sessionToken: storage.sessionToken,
    },
  });
}

async function streamToBuffer(body) {
  // Node stream -> Buffer (the SDK returns a Readable in Node).
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Download every object under the engagement's scoped prefix into a fresh temp
 * directory.
 *
 * @param {object} storage - the run payload's storage block (scoped creds).
 * @returns {Promise<{ dir:string, files:Array<{key:string,name:string,path:string,bytes:number}> }>}
 */
export async function downloadEngagementFiles(storage) {
  if (!storage || !storage.bucket || !storage.prefix) {
    throw new Error("storage block missing bucket/prefix");
  }
  const s3 = clientFor(storage);
  const dir = await mkdtemp(path.join(tmpdir(), "eng-"));
  const files = [];

  let ContinuationToken;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: storage.bucket,
      Prefix: storage.prefix,
      ContinuationToken,
    }));
    for (const obj of list.Contents || []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      // Guard: never write outside the temp dir, and never accept a key that
      // is not under the scoped prefix (defense-in-depth; the creds already
      // forbid it, but we do not trust the listing blindly).
      if (!obj.Key.startsWith(storage.prefix)) continue;
      const rel = obj.Key.slice(storage.prefix.length);
      const safeRel = rel.split("/").filter((s) => s && s !== "." && s !== "..").join("/");
      if (!safeRel) continue;
      const dest = path.join(dir, safeRel);
      if (!dest.startsWith(dir)) continue; // path-traversal guard

      const got = await s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: obj.Key }));
      const buf = await streamToBuffer(got.Body);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      files.push({ key: obj.Key, name: path.basename(safeRel), path: dest, bytes: buf.length });
    }
    ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return { dir, files };
}

/** Remove a downloaded temp dir (best-effort; called in a finally). */
export async function cleanupDir(dir) {
  if (!dir) return;
  try { await rm(dir, { recursive: true, force: true }); }
  catch { /* best-effort */ }
}
