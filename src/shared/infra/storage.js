// Storage adapter — єдина точка роботи з файлами (фото/архіви).
// Дозволяє перемикати backend між локальним диском (dev) і S3 (prod) через
// env STORAGE_DRIVER=local|s3, не змінюючи код, що зберігає/читає файли.
//
// Ключова ідея: у БД ми зберігаємо *storage key* — відносний шлях у межах
// сховища (напр. "processed/tm_13010.jpg" або "PRODUCT_FOTO/13010.tif").
// Для local це шлях усередині STORAGE_ROOT; для s3 — Key у бакеті.
//
// Backward-compat: у наявній БД лежать АБСОЛЮТНІ локальні шляхи. Усі read-методи
// приймають і key, і легасі-абсолютний шлях — див. _resolveLocal().
//
// Інтерфейс (обидва backend'и реалізують однаково):
//   save(key, buffer)            → Promise<{ key }>   зберегти байти
//   openRead(keyOrPath)          → Promise<ReadableStream>
//   getViewUrl(keyOrPath)        → Promise<string>    URL для <img> у UI
//   exists(keyOrPath)            → Promise<boolean>
//   remove(prefixOrKey)          → Promise<void>      видалити (рекурсивно для local-дир)
//   driver                       → "local" | "s3"

const fs = require("fs");
const path = require("path");

// === LOCAL ===

class LocalStorage {
  constructor({ root }) {
    this.driver = "local";
    this.root = path.resolve(root);
  }

  // key може бути:
  //   - відносним storage key ("processed/tm_1.jpg") → під STORAGE_ROOT;
  //   - легасі-абсолютним шляхом (з наявної БД) → беремо як є.
  _resolveLocal(keyOrPath) {
    if (path.isAbsolute(keyOrPath)) return keyOrPath;
    return path.join(this.root, keyOrPath);
  }

  async save(key, buffer) {
    const abs = this._resolveLocal(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, buffer);
    return { key };
  }

  async openRead(keyOrPath) {
    const abs = this._resolveLocal(keyOrPath);
    if (!fs.existsSync(abs)) throw new Error(`storage: file not found: ${abs}`);
    return fs.createReadStream(abs);
  }

  // Local не має зовнішнього URL — фронт ходить через внутрішній proxy-роут,
  // який стрімить openRead(). Тому getViewUrl повертає null: викликач сам
  // підставляє свій proxy-endpoint (саме так і робить web-роут).
  async getViewUrl() {
    return null;
  }

  async exists(keyOrPath) {
    return fs.existsSync(this._resolveLocal(keyOrPath));
  }

  async remove(keyOrPath) {
    const abs = this._resolveLocal(keyOrPath);
    await fs.promises.rm(abs, { recursive: true, force: true });
  }
}

// === S3 ===
// SDK вантажимо лениво (require усередині конструктора), щоб local-режим
// не вимагав встановленого @aws-sdk/*.

class S3Storage {
  constructor({ bucket, region, endpoint, accessKeyId, secretAccessKey, signedUrlTtl, keyPrefix }) {
    this.driver = "s3";
    if (!bucket) throw new Error("S3Storage: S3_BUCKET required");

    const { S3Client } = require("@aws-sdk/client-s3");
    this._cmds = require("@aws-sdk/client-s3");
    this._presign = require("@aws-sdk/s3-request-presigner");

    this.bucket = bucket;
    this.ttl = signedUrlTtl || 3600;
    this.keyPrefix = (keyPrefix || "").replace(/^\/+|\/+$/g, "");

    this.client = new S3Client({
      region: region || "us-east-1",
      // endpoint лишаємо undefined для AWS; задаємо лише для S3-сумісних.
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}), // інакше — стандартний ланцюг (IAM role / env / профіль)
    });
  }

  // Key за контрактом — ВІДНОСНИЙ ("processed/x.jpg"). Легасі-абсолютні
  // локальні шляхи з наявної БД у S3-режимі не валідні (їх немає в бакеті) —
  // кидаємо зрозумілу помилку, щоб під час міграції такі рядки впадали в очі,
  // а не 404-ли тихо. Провідний "/" теж трактується як абсолют (не валідний key).
  _key(keyOrPath) {
    if (path.isAbsolute(keyOrPath) || /^[A-Za-z]:[\\/]/.test(keyOrPath)) {
      throw new Error(
        `storage(s3): отримано абсолютний шлях "${keyOrPath}", очікувався storage key. ` +
        `Перенесіть наявні файли в S3 і збережіть key у БД (див. scripts/migrate-storage).`,
      );
    }
    return this.keyPrefix ? `${this.keyPrefix}/${keyOrPath}` : keyOrPath;
  }

  async save(key, buffer) {
    await this.client.send(new this._cmds.PutObjectCommand({
      Bucket: this.bucket,
      Key: this._key(key),
      Body: buffer,
      ContentType: _mimeFor(key),
    }));
    return { key };
  }

  async openRead(keyOrPath) {
    const out = await this.client.send(new this._cmds.GetObjectCommand({
      Bucket: this.bucket,
      Key: this._key(keyOrPath),
    }));
    return out.Body; // Node Readable stream
  }

  async getViewUrl(keyOrPath) {
    const cmd = new this._cmds.GetObjectCommand({
      Bucket: this.bucket,
      Key: this._key(keyOrPath),
    });
    return this._presign.getSignedUrl(this.client, cmd, { expiresIn: this.ttl });
  }

  async exists(keyOrPath) {
    try {
      await this.client.send(new this._cmds.HeadObjectCommand({
        Bucket: this.bucket,
        Key: this._key(keyOrPath),
      }));
      return true;
    } catch (e) {
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }

  async remove(prefixOrKey) {
    const Prefix = this._key(prefixOrKey);
    let ContinuationToken;
    do {
      const list = await this.client.send(new this._cmds.ListObjectsV2Command({
        Bucket: this.bucket, Prefix, ContinuationToken,
      }));
      const objects = (list.Contents || []).map((o) => ({ Key: o.Key }));
      if (objects.length) {
        await this.client.send(new this._cmds.DeleteObjectsCommand({
          Bucket: this.bucket, Delete: { Objects: objects },
        }));
      }
      ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }
}

// === спільне ===

function _mimeFor(key) {
  const ext = path.extname(key).toLowerCase();
  return ext === ".png" ? "image/png"
    : ext === ".webp" ? "image/webp"
    : ext === ".tif" || ext === ".tiff" ? "image/tiff"
    : "image/jpeg";
}

// Фабрика: один інстанс на процес. Читає env один раз.
let _instance = null;

function createStorage(env = process.env) {
  const driver = (env.STORAGE_DRIVER || "local").toLowerCase();
  if (driver === "s3") {
    return new S3Storage({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined, // лише для S3-сумісних
      accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
      signedUrlTtl: env.S3_SIGNED_URL_TTL ? parseInt(env.S3_SIGNED_URL_TTL, 10) : undefined,
      keyPrefix: env.S3_KEY_PREFIX || undefined,
    });
  }
  const root = env.STORAGE_ROOT || path.resolve(process.cwd(), "photos_storage");
  return new LocalStorage({ root });
}

function getStorage() {
  if (!_instance) _instance = createStorage();
  return _instance;
}

module.exports = { getStorage, createStorage, LocalStorage, S3Storage, _mimeFor };
