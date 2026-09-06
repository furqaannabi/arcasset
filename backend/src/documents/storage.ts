import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Where agreement documents live.
 *
 * An interface with two implementations so the review flow can be built and
 * demonstrated without R2 credentials. Keys are content-addressed, so the same
 * file uploaded twice occupies one object.
 */
export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** A short-lived URL, or null if this backend cannot mint one. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  readonly kind: "r2" | "local";
}

export class R2Storage implements Storage {
  readonly kind = "r2" as const;
  private readonly client: Bun.S3Client;

  constructor(opts: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.client = new Bun.S3Client({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      bucket: opts.bucket,
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.write(key, bytes, { type: contentType });
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await this.client.file(key).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }

  /** Short by default. A link that outlives the request is a link that leaks. */
  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return this.client.presign(key, { expiresIn: expiresInSeconds });
  }
}

/**
 * Filesystem-backed, for local development and tests.
 *
 * It cannot mint signed URLs, and says so rather than pretending — the route
 * streams bytes through the API instead. That is the honest degradation: same
 * access control, no pretend link.
 */
export class LocalStorage implements Storage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const full = resolve(this.root, key);
    // Keys come from us, not from users, but a traversal here would read
    // arbitrary files — cheap to rule out rather than reason about.
    if (!full.startsWith(resolve(this.root))) throw new Error("key escapes the storage root");
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => {});
  }

  async signedUrl(): Promise<string | null> {
    return null;
  }
}

export function storageFromEnv(): Storage {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  const bucket = process.env["R2_BUCKET"];
  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return new R2Storage({ accountId, accessKeyId, secretAccessKey, bucket });
  }
  return new LocalStorage(join(process.cwd(), ".documents"));
}
