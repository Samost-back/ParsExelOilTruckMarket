import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createStorage, LocalStorage, S3Storage, _mimeFor } =
  require("../../../src/shared/infra/storage.js");

function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return Promise.resolve(stream);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

describe("createStorage (driver selection)", () => {
  it("дефолт — local з коренем photos_storage", () => {
    const s = createStorage({});
    expect(s.driver).toBe("local");
    expect(s).toBeInstanceOf(LocalStorage);
  });

  it("STORAGE_DRIVER=s3 → S3Storage; без bucket кидає", () => {
    expect(() => createStorage({ STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
  });

  it("STORAGE_DRIVER=s3 з bucket → S3Storage", () => {
    const s = createStorage({ STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_REGION: "eu-central-1" });
    expect(s.driver).toBe("s3");
    expect(s).toBeInstanceOf(S3Storage);
  });
});

describe("LocalStorage", () => {
  let root;
  let storage;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stg-"));
    storage = new LocalStorage({ root });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("save кладе файл під STORAGE_ROOT і повертає той самий key", async () => {
    const r = await storage.save("processed/tm_1.jpg", Buffer.from("hello"));
    expect(r.key).toBe("processed/tm_1.jpg");
    const onDisk = fs.readFileSync(path.join(root, "processed", "tm_1.jpg"), "utf8");
    expect(onDisk).toBe("hello");
  });

  it("save створює вкладені директорії", async () => {
    await storage.save("a/b/c/x.jpg", Buffer.from("y"));
    expect(fs.existsSync(path.join(root, "a", "b", "c", "x.jpg"))).toBe(true);
  });

  it("openRead за key повертає вміст", async () => {
    await storage.save("k.jpg", Buffer.from("data"));
    const buf = await streamToBuffer(await storage.openRead("k.jpg"));
    expect(buf.toString()).toBe("data");
  });

  it("openRead приймає легасі-абсолютний шлях (backward-compat)", async () => {
    const abs = path.join(root, "legacy.jpg");
    fs.writeFileSync(abs, "legacy");
    const buf = await streamToBuffer(await storage.openRead(abs));
    expect(buf.toString()).toBe("legacy");
  });

  it("openRead на відсутньому файлі кидає", async () => {
    await expect(storage.openRead("nope.jpg")).rejects.toThrow(/not found/);
  });

  it("exists — true/false для key", async () => {
    await storage.save("e.jpg", Buffer.from("1"));
    expect(await storage.exists("e.jpg")).toBe(true);
    expect(await storage.exists("missing.jpg")).toBe(false);
  });

  it("getViewUrl повертає null (UI ходить через proxy-роут)", async () => {
    expect(await storage.getViewUrl("e.jpg")).toBe(null);
  });

  it("remove видаляє файл і дерево", async () => {
    await storage.save("d/1.jpg", Buffer.from("a"));
    await storage.save("d/2.jpg", Buffer.from("b"));
    await storage.remove("d");
    expect(fs.existsSync(path.join(root, "d"))).toBe(false);
  });
});

describe("S3Storage._key (нормалізація key)", () => {
  // Будуємо без виклику конструктора (щоб не чіпати реальний SDK):
  // _key — чиста функція над this.keyPrefix.
  function makeKeyer(keyPrefix) {
    return S3Storage.prototype._key.bind({ keyPrefix });
  }

  it("відносний key лишається як є", () => {
    expect(makeKeyer("")("processed/x.jpg")).toBe("processed/x.jpg");
  });

  it("додає keyPrefix", () => {
    expect(makeKeyer("prod")("processed/x.jpg")).toBe("prod/processed/x.jpg");
  });

  it("провідний слеш трактується як легасі-абсолютний шлях → кидає", () => {
    // Key за контрактом — відносний; "/..." це POSIX-абсолют, не валідний key.
    expect(() => makeKeyer("")("/processed/x.jpg")).toThrow(/storage key/);
  });

  it("легасі-абсолютний POSIX-шлях → зрозуміла помилка", () => {
    expect(() => makeKeyer("")("/var/app/photos_storage/x.jpg")).toThrow(/storage key/);
  });

  it("легасі-абсолютний Windows-шлях → зрозуміла помилка", () => {
    expect(() => makeKeyer("")("C:\\Users\\x\\photo.jpg")).toThrow(/storage key/);
  });
});

describe("_mimeFor", () => {
  it("за розширенням", () => {
    expect(_mimeFor("a.png")).toBe("image/png");
    expect(_mimeFor("a.webp")).toBe("image/webp");
    expect(_mimeFor("a.tif")).toBe("image/tiff");
    expect(_mimeFor("a.tiff")).toBe("image/tiff");
    expect(_mimeFor("a.jpg")).toBe("image/jpeg");
    expect(_mimeFor("a.unknown")).toBe("image/jpeg");
  });
});
