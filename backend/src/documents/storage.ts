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
  private readonly publicUrl: string | null;

  constructor(opts: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    /**
     * A custom domain in front of the bucket, used as the host for presigned
     * URLs so links do not expose the account id.
     *
     * It must NOT be a domain with public access enabled. Documents here are
     * loan agreements naming people who did not agree to publish anything, and
     * the access rule — originator, borrower, admin — is enforced in the route.
     * A publicly readable bucket bypasses that entirely: object keys appear in
     * logs and browser history, and "the key is hard to guess" is obscurity,
     * not access control. `assertNotPubliclyReadable()` checks at startup.
     */
    publicUrl?: string | null;
  }) {
    this.client = new Bun.S3Client({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      bucket: opts.bucket,
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
    });
    this.publicUrl = opts.publicUrl?.replace(/\/$/, "") ?? null;
  }

  /**
   * Write an object, then try to read it back with no credentials. If that
   * succeeds the bucket is public and every document is readable by anyone who
   * learns a key, whatever the route says.
   *
   * Returns a problem description rather than throwing, so the caller decides
   * whether to refuse to start or to warn — but it must not be ignored.
   */
  async assertNotPubliclyReadable(): Promise<string | null> {
    if (!this.publicUrl) return null;
    const key = `.access-check/${crypto.randomUUID()}`;
    try {
      await this.put(key, new TextEncoder().encode("access check"), "text/plain");
      const res = await fetch(`${this.publicUrl}/${key}`, { redirect: "manual" });
      if (res.ok) {
        return `${this.publicUrl} serves bucket objects without a signature — document access control is bypassed`;
      }
      return null;
    } catch (err) {
      return `could not complete the public-access check: ${String(err)}`;
    } finally {
      await this.delete(key).catch(() => {});
    }
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
    const url = this.client.presign(key, { expiresIn: expiresInSeconds });
    if (!this.publicUrl) return url;
    // Same signature, nicer host. The query string still carries it, so the
    // link expires exactly as it would against the account endpoint.
    const parsed = new URL(url);
    return `${this.publicUrl}${parsed.pathname.replace(/^\/[^/]+/, "")}${parsed.search}`;
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
  const publicUrl = process.env["R2_PUBLIC_URL"] || null;

  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return new R2Storage({ accountId, accessKeyId, secretAccessKey, bucket, publicUrl });
  }
  // A public URL with no credentials cannot store anything. Say so rather than
  // falling back silently and leaving someone to wonder why uploads are local.
  if (publicUrl) {
    console.warn(
      "[storage] R2_PUBLIC_URL is set but R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / " +
        "R2_SECRET_ACCESS_KEY / R2_BUCKET are not — falling back to local storage",
    );
  }
  return new LocalStorage(join(process.cwd(), ".documents"));
}
