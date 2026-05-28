// Тонкий обгортка console з єдиним форматом. SRP: лише виведення.
// Якщо знадобиться файл-лог, JSON-вивід тощо — змінюємо тільки тут.

const log = {
  info: (msg)  => console.log(msg),
  ok:   (msg)  => console.log(`✓ ${msg}`),
  warn: (msg)  => console.log(`⚠ ${msg}`),
  skip: (msg)  => console.log(`⊘ ${msg}`),
  err:  (msg)  => console.log(`✗ ${msg}`),
  head: (msg)  => console.log(`\n→ ${msg}`),
  raw:  (...a) => console.log(...a),
  table:(rows) => console.table(rows),
};

module.exports = { log };
