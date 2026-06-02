// Спільні хелпери для EJS-шаблонів. Інжектяться у defaultContext @fastify/view,
// тож доступні в КОЖНОМУ шаблоні без передачі вручну. Тримаємо тут єдине місце
// перекладу статусів і форматування дат (Київський час).

// Часовий пояс UI — Київ. Усі дати в інтерфейсі показуємо в ньому, незалежно
// від TZ контейнера/хоста.
const TZ = process.env.UI_TZ || "Europe/Kyiv";

// === Статуси фонових задач (web_jobs.status) ===
const JOB_STATUS_LABELS = {
  pending: "очікує",
  running: "виконується",
  done: "готово",
  failed: "помилка",
  cancelled: "скасовано",
};
function jobStatusLabel(status) {
  return JOB_STATUS_LABELS[status] || status || "";
}

// === Тип задачі (web_jobs.kind) ===
const JOB_KIND_LABELS = {
  "import": "Імпорт / оновлення",
  "update-prices": "Оновлення цін",
  "company-delete": "Видалення компанії",
  "integrations-run": "Публікація на TM",
  "tm-delete": "Видалення з TM",
  "tm-publish-one": "Публікація оливи на TM",
  "tm-update-one": "Оновлення оливи на TM",
  "tm-update-outdated": "Оновлення застарілих на TM",
};
function jobKindLabel(kind) {
  return JOB_KIND_LABELS[kind] || kind || "";
}

// === Статуси публікації на TruckMarket (olivs.truck_status) ===
const TRUCK_STATUS_LABELS = {
  pending: "очікує",
  in_progress: "в роботі",
  done: "опубліковано",
  outdated: "застаріло",
  failed: "помилка",
};
function truckStatusLabel(status) {
  return TRUCK_STATUS_LABELS[status] || status || "";
}

// === Статуси обробки фото (oils_images.processed_status) ===
const PHOTO_STATUS_LABELS = {
  pending: "очікує",
  done: "оброблено",
  skipped: "пропущено",
  failed: "помилка",
};
function photoStatusLabel(status) {
  return PHOTO_STATUS_LABELS[status] || status || "";
}

// === Кроки імпорту (summary.steps[].name / .status) ===
const IMPORT_STEP_LABELS = {
  "parse": "Парсинг прайсу",
  "company-meta": "Метадані компанії",
  "import-photos": "Імпорт фото",
  "process-photos": "Обробка фото",
};
const STEP_STATUS_LABELS = {
  pending: "очікує",
  running: "виконується",
  done: "готово",
  failed: "помилка",
};
const STEP_ICON = { pending: "○", running: "▸", done: "✓", failed: "✗" };
function importStepLabel(name) {
  return IMPORT_STEP_LABELS[name] || name || "";
}
function stepStatusLabel(status) {
  return STEP_STATUS_LABELS[status] || status || "";
}

// === Дати у Київському часі ===
// fmtDate — повна дата+час; fmtDateShort — лише дата. Приймає Date | string |
// number | null. Порожнє/невалідне → "—".
function _toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(v) {
  const d = _toDate(v);
  if (!d) return "—";
  return d.toLocaleString("uk-UA", { timeZone: TZ });
}
function fmtDateShort(v) {
  const d = _toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("uk-UA", { timeZone: TZ });
}

module.exports = {
  TZ,
  JOB_STATUS_LABELS, jobStatusLabel,
  JOB_KIND_LABELS, jobKindLabel,
  TRUCK_STATUS_LABELS, truckStatusLabel,
  PHOTO_STATUS_LABELS, photoStatusLabel,
  IMPORT_STEP_LABELS, STEP_STATUS_LABELS, STEP_ICON,
  importStepLabel, stepStatusLabel,
  fmtDate, fmtDateShort,
};
