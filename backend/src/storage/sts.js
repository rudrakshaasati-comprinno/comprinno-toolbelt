import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
} from "../config.js";

/**
 * sts.js - Token vending machine for engagement-scoped object-storage access.
 *
 * WHY: the agent must download an engagement's source files itself, but must
 * NOT be able to read any other engagement's data. Instead of handing the agent
 * the backend's standing credentials (which can read the whole bucket), the
 * backend mints SHORT-LIVED, READ-ONLY credentials scoped by an inline session
 * policy to exactly one engagement's prefix (engagements/{id}/*). This is AWS's
 * canonical multi-tenant "token vending machine" pattern; MinIO implements the
 * same STS AssumeRole protocol, so the identical code targets real S3 later by
 * config alone.
 *
 * ISOLATION IS ENFORCED AT THE STORAGE LAYER, NOT IN APP CODE: even if the
 * agent is buggy or compromised and asks for another engagement's key, MinIO
 * denies it because the session policy does not grant it. (MinIO semantics: the
 * effective permission is the INTERSECTION of the assuming user's policy and
 * this session policy — so this can only narrow, never widen, access.)
 */

// 15 minutes — the MinIO/STS minimum. An agent run is short; a fresh token is
// minted per run, so there is no benefit to a longer-lived credential.
const DURATION_SECONDS = 900;

/**
 * Build the inline session policy that locks a session to one engagement's
 * prefix: read-only GetObject on that prefix, and ListBucket restricted to it.
 * No Put/Delete, no access to any other prefix or the bucket root listing.
 */
function engagementScopedPolicy(bucket, prefix) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ReadEngagementObjects",
        Effect: "Allow",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/${prefix}*`],
      },
      {
        Sid: "ListEngagementPrefixOnly",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: [`arn:aws:s3:::${bucket}`],
        // ListBucket is a bucket-level action; the prefix condition is what
        // stops the session from listing anything outside this engagement.
        Condition: { StringLike: { "s3:prefix": [`${prefix}*`] } },
      },
    ],
  });
}

/**
 * Mint engagement-scoped, read-only, short-lived storage credentials.
 *
 * @param {string} engagementId
 * @returns {Promise<{
 *   endpoint:string, region:string, bucket:string, prefix:string,
 *   forcePathStyle:boolean, accessKeyId:string, secretAccessKey:string,
 *   sessionToken:string, expiration:string|null
 * }>}
 */
export async function mintEngagementCredentials(engagementId) {
  if (!engagementId || /[^A-Za-z0-9._-]/.test(engagementId)) {
    // The id becomes part of an S3 prefix and an IAM resource ARN; reject
    // anything that could break out of the intended prefix.
    throw new Error(`invalid engagementId for scoped credentials: ${engagementId}`);
  }
  const prefix = `engagements/${engagementId}/`;

  // STS client pointed at MinIO, authenticating with the backend's standing
  // (admin) credentials — the only place those creds are ever used to vend.
  const sts = new STSClient({
    region: S3_REGION,
    endpoint: S3_ENDPOINT || undefined,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  });

  // MinIO ignores RoleArn for plain AssumeRole (it uses the caller's identity),
  // but the SDK requires RoleArn + RoleSessionName to be present, so pass
  // deterministic placeholders. The real scoping comes from `Policy`.
  const res = await sts.send(new AssumeRoleCommand({
    RoleArn: "arn:aws:iam::000000000000:role/engagement-reader",
    RoleSessionName: `eng-${engagementId}`.slice(0, 64),
    DurationSeconds: DURATION_SECONDS,
    Policy: engagementScopedPolicy(S3_BUCKET, prefix),
  }));

  const c = res.Credentials;
  if (!c || !c.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error("STS AssumeRole returned no credentials");
  }

  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    prefix,
    forcePathStyle: true,
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration ? new Date(c.Expiration).toISOString() : null,
  };
}
