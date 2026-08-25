import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 10);
export const MAX_FILES_PER_KPI = Number(process.env.MAX_FILES_PER_KPI || 5);

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'xls', 'xlsx', 'xlsm', 'csv', 'doc', 'docx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'txt',
]);

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'sh', 'ps1', 'msi', 'dll',
  'scr', 'vbs', 'js', 'jar', 'app', 'apk', 'php',
]);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function validateUploadFile(name: string, mimeType: string, size: number): string | null {
  const ext = fileExtension(name);
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) return `File type ".${ext}" is not allowed.`;
  if (!ALLOWED_EXTENSIONS.has(ext)) return `File type ".${ext}" is not supported. Allowed: PDF, Excel, Word, images, CSV.`;
  if (size <= 0) return 'File is empty.';
  if (size > MAX_FILE_SIZE_MB * 1024 * 1024) return `File exceeds the ${MAX_FILE_SIZE_MB} MB limit.`;
  if (/(^|\/)(x-msdownload|x-sh|x-executable)/i.test(mimeType)) return 'Executable files are rejected.';
  return null;
}

export function checksumOf(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function makeStorageKey(originalName: string): string {
  const ext = fileExtension(originalName);
  const rand = crypto.randomBytes(16).toString('hex');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `attachments/${stamp}/${rand}${ext ? '.' + ext : ''}`;
}

export type StorageDriver = 'db' | 's3';

export function storageDriver(): StorageDriver {
  const v = (process.env.STORAGE_DRIVER || '').toLowerCase();
  if (v === 's3') return 's3';
  if (v === 'db') return 'db';
  return process.env.STORAGE_BUCKET && process.env.STORAGE_ACCESS_KEY_ID ? 's3' : 'db';
}

let s3: S3Client | null = null;
function s3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.STORAGE_REGION || 'auto',
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: !!process.env.STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3;
}

/**
 * Stores a file. With the "db" driver the bytes are returned so the caller
 * persists them in the Attachment.data column inside the same transaction.
 */
export async function putFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ inlineData: Buffer | null }> {
  if (storageDriver() === 's3') {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    return { inlineData: null };
  }
  return { inlineData: buffer };
}

export async function getFile(att: { storageKey: string; data: Uint8Array | null }): Promise<Buffer> {
  if (att.data && att.data.length > 0) return Buffer.from(att.data);
  if (storageDriver() === 's3') {
    const res = await s3Client().send(
      new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: att.storageKey })
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  throw new Error('Attachment data not found.');
}

export async function deleteFile(key: string): Promise<void> {
  if (storageDriver() === 's3') {
    await s3Client().send(
      new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key })
    );
  }
}
