import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_FORCE_PATH_STYLE,
} from "../config.js";

/**
 * storage.js - S3-compatible object storage (MinIO in v1, real AWS S3 later).
 *
 * The only thing that differs between MinIO and real S3 is configuration:
 *   MinIO -> endpoint set + forcePathStyle:true.
 *   AWS S3 -> endpoint unset + forcePathStyle:false + real creds/region.
 * The code below is identical either way (architecture decision, task #5).
 *
 * The BACKEND owns all S3 access; the agent never sees S3 (it receives
 * extracted content). This keeps the agent storage-agnostic and the S3
 * credentials confined to one service.
 */

export const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT || undefined,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

/** Ensure the bucket exists (idempotent). Called once at startup. */
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  }
}

/** Store an object (Buffer or string). Returns the key. */
export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType,
  }));
  return key;
}

/** Read an object as a Buffer. */
export async function getObjectBuffer(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

/** Read an object as UTF-8 text. */
export async function getObjectText(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return await res.Body.transformToString();
}

/** Delete an object (best-effort; ignores missing). */
export async function deleteObject(key) {
  if (!key) return;
  try { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })); }
  catch { /* already gone */ }
}

/**
 * Copy an object to a new key within the same bucket. Implemented as get+put
 * (rather than CopyObjectCommand) so it works identically on MinIO and S3
 * without extra IAM. Returns the destination key.
 */
export async function copyObject(srcKey, destKey) {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: srcKey }));
  const body = Buffer.from(await res.Body.transformToByteArray());
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET, Key: destKey, Body: body, ContentType: res.ContentType,
  }));
  return destKey;
}

/** Object key layout, per architecture-v1.md section 6. */
export const keys = {
  sourceRaw: (engagementId, docId, filename) =>
    `engagements/${engagementId}/sources/${docId}-${filename}`,
  sourceText: (engagementId, docId, filename) =>
    `engagements/${engagementId}/sources/${docId}-${filename}.txt`,
  recommendationsSnapshot: (engagementId, ts) =>
    `engagements/${engagementId}/recommendations/finalized-${ts}.json`,
  proposal: (engagementId, versionId, ext) =>
    `engagements/${engagementId}/proposals/${versionId}.${ext}`,
};
