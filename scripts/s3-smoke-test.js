// Smoke-test S3-підключення: save → exists → openRead → getViewUrl → remove.
// Нічого в БД не чіпає, працює з тимчасовим key під _smoke-test/.
//
// Передумови: у .env заповнено STORAGE_DRIVER=s3 + S3_BUCKET/S3_REGION/ключі.
//
// Запуск:  node scripts/s3-smoke-test.js

require("dotenv").config();
const { createStorage } = require("../src/shared/infra/storage");

function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return Promise.resolve(stream);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

(async () => {
  const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  if (driver !== "s3") {
    console.error(`✗ STORAGE_DRIVER=${driver}. Для тесту S3 постав STORAGE_DRIVER=s3 у .env.`);
    process.exit(1);
  }

  console.log("Конфіг:");
  console.log(`  S3_BUCKET = ${process.env.S3_BUCKET || "(не задано!)"}`);
  console.log(`  S3_REGION = ${process.env.S3_REGION || "(не задано!)"}`);
  console.log(`  ключі     = ${process.env.S3_ACCESS_KEY_ID ? "задані" : "беруться з IAM-ролі / ланцюга AWS"}\n`);

  let storage;
  try {
    storage = createStorage(process.env);
  } catch (e) {
    console.error(`✗ Не вдалося ініціалізувати S3-адаптер: ${e.message}`);
    process.exit(1);
  }

  const key = "_smoke-test/hello.txt";
  const payload = `s3 smoke test ${process.env.S3_BUCKET}`;
  let failed = false;

  try {
    // 1) PutObject
    await storage.save(key, Buffer.from(payload, "utf8"));
    console.log(`✓ save        — залито s3:${key}`);

    // 2) HeadObject
    const ex = await storage.exists(key);
    console.log(`${ex ? "✓" : "✗"} exists      — ${ex}`);
    if (!ex) failed = true;

    // 3) GetObject
    const buf = await streamToBuffer(await storage.openRead(key));
    const ok = buf.toString("utf8") === payload;
    console.log(`${ok ? "✓" : "✗"} openRead    — вміст ${ok ? "збігається" : "НЕ збігається"}`);
    if (!ok) failed = true;

    // 4) Presigned URL (саме його віддає UI)
    const url = await storage.getViewUrl(key);
    const looksSigned = /X-Amz-Signature=/.test(url);
    console.log(`${looksSigned ? "✓" : "✗"} getViewUrl  — ${url.slice(0, 80)}...`);
    if (!looksSigned) failed = true;
  } catch (e) {
    console.error(`\n✗ ПОМИЛКА: ${e.name || ""} ${e.message}`);
    if (/credential|AccessDenied|SignatureDoesNotMatch/i.test(e.message)) {
      console.error("  → схоже на проблему з ключами або IAM-політикою (права на bucket).");
    } else if (/region|endpoint|getaddrinfo|ENOTFOUND/i.test(e.message)) {
      console.error("  → схоже на неправильний S3_REGION для цього бакета.");
    } else if (/NoSuchBucket/i.test(e.message)) {
      console.error("  → бакет з такою назвою не існує у вказаному регіоні.");
    }
    failed = true;
  } finally {
    // 5) Прибираємо за собою
    try {
      await storage.remove(key);
      console.log(`✓ remove      — тестовий файл видалено`);
    } catch (e) {
      console.error(`⚠ remove не вдалося (приберіть s3:${key} вручну): ${e.message}`);
    }
  }

  console.log(failed ? "\n✗ Тест провалено — див. помилки вище." : "\n✓ S3 підключено успішно. Можна мігрувати фото.");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
