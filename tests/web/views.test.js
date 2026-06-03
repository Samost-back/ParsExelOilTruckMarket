import { describe, it, expect } from "vitest";
const ejs = require("ejs");
const path = require("path");
const helpers = require("../../src/web/view-helpers");

const VIEWS = path.join(__dirname, "..", "..", "src", "web", "views");
// Хелпери інжектяться в defaultContext на проді — у тестах підмішуємо їх,
// щоб шаблони рендерились так само, як у застосунку.
const render = (name, data) =>
  ejs.renderFile(path.join(VIEWS, name), { ...helpers, ...data }, { async: false });

// Базовий рядок оливо у shape списку (listOils).
function listRow(over = {}) {
  return {
    id: 42, name_type_oil: "моторне оливо", name: "Test Oil 5W-30",
    company_name: "EUROLUB", brand: "EUROLUB", city: null,
    integration_name: "EUROLUB", articul: "ABC123", packaging_volume: "20.0",
    price: 999, img_total: 0, img_done: 0,
    truck_listing_id: null, truck_status: null, truck_error: null,
    ...over,
  };
}

describe("_oil-row.ejs — рядок таблиці", () => {
  it("рендерить id, назву, бренд, ціну та inline-форму ціни", async () => {
    const html = await render("_oil-row.ejs", { o: listRow() });
    expect(html).toContain('id="oil-row-42"');
    expect(html).toContain("Test Oil 5W-30");
    expect(html).toContain("EUROLUB");
    expect(html).toContain('hx-post="/oils/42/price"');
    expect(html).toContain('value="999"');
    // кнопки редагування й видалення присутні
    expect(html).toContain('hx-get="/oils/42/edit-row"');
    expect(html).toContain('hx-delete="/oils/42"');
  });

  it("статус 'pending' (не опубліковано) → кнопка опублікувати, без зняти з TM", async () => {
    const html = await render("_oil-row.ejs", { o: listRow() });
    expect(html).toContain('hx-post="/oils/42/publish"');
    expect(html).not.toContain("/oils/42/unpublish");
  });

  it("статус 'done' → бейдж #listing + зняти з TM", async () => {
    const html = await render("_oil-row.ejs", { o: listRow({ truck_status: "done", truck_listing_id: 5555 }) });
    expect(html).toContain("badge-done");
    expect(html).toContain("#5555");
    expect(html).toContain("/oils/42/unpublish");
  });

  it("статус 'outdated' → бейдж застаріло + кнопка оновити на TM", async () => {
    const html = await render("_oil-row.ejs", { o: listRow({ truck_status: "outdated", truck_listing_id: 7777 }) });
    expect(html).toContain("badge-warning");
    expect(html).toContain("застаріло");
    expect(html).toContain('hx-post="/oils/42/sync-tm"');
  });

  it("екранує HTML у назві (без XSS)", async () => {
    const html = await render("_oil-row.ejs", { o: listRow({ name: "<script>alert(1)</script>" }) });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("_oil-edit-row.ejs — рядок-редактор", () => {
  const editRow = {
    id: 42, name_type_oil: "моторне оливо", name: "Test Oil", brand: "EUROLUB",
    city: "Київ", packaging_volume: "20.0", quantity: 1000, price: 500,
    viscosity_sae: "5W-30", acea: "E7", api: "CK-4",
    manufacturers_tolerances: "MAN", dot: null, iso_vg_viscosity_grade: null, color_liquid: null,
  };

  it("рендерить форму PATCH з усіма полями", async () => {
    const html = await render("_oil-edit-row.ejs", {
      o: editRow, types: ["моторне оливо", "трансмісійне оливо"], TABLE_COLS: 13,
    });
    expect(html).toContain('hx-patch="/oils/42"');
    expect(html).toContain('colspan="13"');
    for (const f of ["name", "brand", "city", "packaging_volume", "quantity", "price", "viscosity_sae", "acea", "api"]) {
      expect(html).toContain(`name="${f}"`);
    }
    // поточні значення підставлені
    expect(html).toContain('value="EUROLUB"');
    expect(html).toContain('value="5W-30"');
    // селект типів з вибраним поточним
    expect(html).toContain("трансмісійне оливо");
  });

  it("кнопки Зберегти і Скасувати (cancel → /row)", async () => {
    const html = await render("_oil-edit-row.ejs", { o: editRow, types: [], TABLE_COLS: 13 });
    expect(html).toContain("Зберегти");
    expect(html).toContain('hx-get="/oils/42/row"');
  });
});

describe("_prompt-sim-result.ejs — результат симуляції", () => {
  it("ok=true → показує текст і примітку 'не збережено'", async () => {
    const html = await render("_prompt-sim-result.ejs", { ok: true, text: "Чудова олива.", oilName: "Test 5W-30" });
    expect(html).toContain("Чудова олива.");
    expect(html).toContain("Згенеровано");
    expect(html).toContain("нічого не збережено");
  });

  it("ok=false → показує помилку", async () => {
    const html = await render("_prompt-sim-result.ejs", { ok: false, error: "OPENAI_API_KEY не налаштований" });
    expect(html).toContain("flash-error");
    expect(html).toContain("OPENAI_API_KEY");
  });

  it("екранує текст відповіді", async () => {
    const html = await render("_prompt-sim-result.ejs", { ok: true, text: "<b>x</b>", oilName: "n" });
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("prompt-edit.ejs — сторінка з симулятором", () => {
  const base = {
    mode: "edit",
    prompt: { id: 1, name: "SEO", body: "PROMPT TEXT", is_default: true },
    oils: [
      { id: 10, name: "Oil A", articul: "A1", name_company: "EUROLUB" },
      { id: 11, name: "Oil B", articul: "B2", name_company: "Manager" },
    ],
  };

  it("містить блок симулятора з селектором олив і кнопкою", async () => {
    const html = await render("prompt-edit.ejs", base);
    expect(html).toContain("Симулятор опису");
    expect(html).toContain('hx-post="/prompts/simulate"');
    expect(html).toContain('id="simOil"');
    expect(html).toContain('id="promptBody"');
    // обидві оливи в селекторі
    expect(html).toContain("Oil A");
    expect(html).toContain("Oil B");
    // include тягне і промпт, і вибрану оливу
    expect(html).toContain('hx-include="#promptBody, #simOil"');
  });

  it("симулятор включає поточний текст промпту в textarea", async () => {
    const html = await render("prompt-edit.ejs", base);
    expect(html).toContain("PROMPT TEXT");
  });

  it("oils порожній — селектор все одно рендериться без падіння", async () => {
    const html = await render("prompt-edit.ejs", { ...base, oils: [] });
    expect(html).toContain("Симулятор опису");
    expect(html).toContain("— виберіть оливу —");
  });
});

describe("oils.ejs — повна сторінка списку", () => {
  const ctx = {
    filters: { company: "", type: "", status: "", integration: "", search: "" },
    counts: { total: 2, pending: 2, in_progress: 0, done: 0, outdated: 0, failed: 0 },
    facets: { companies: [], types: [], integrations: [] },
    total: 2, page: 1, perPage: 50,
    oils: [
      { id: 1, name_type_oil: "моторне оливо", name: "A", company_name: "E", brand: "E",
        city: null, integration_name: "EUROLUB", articul: "A1", packaging_volume: "20.0",
        price: 100, img_total: 0, img_done: 0, truck_listing_id: null, truck_status: null },
      { id: 2, name_type_oil: "моторне оливо", name: "B", company_name: "E", brand: "E",
        city: null, integration_name: "EUROLUB", articul: "B2", packaging_volume: "5.0",
        price: 200, img_total: 0, img_done: 0, truck_listing_id: null, truck_status: null },
    ],
  };

  it("рендерить рядки через партіал + вкладку 'Застарілі'", async () => {
    const html = await render("oils.ejs", ctx);
    expect(html).toContain('id="oil-row-1"');
    expect(html).toContain('id="oil-row-2"');
    expect(html).toContain("Застарілі");
    // банер outdated прихований коли 0
    expect(html).not.toContain("мають змінену ціну");
  });

  it("банер 'Оновити всі застарілі' зʼявляється коли outdated > 0", async () => {
    const html = await render("oils.ejs", { ...ctx, counts: { ...ctx.counts, outdated: 3 } });
    expect(html).toContain("Оновити всі застарілі на TM");
    expect(html).toContain('action="/oils/sync-outdated"');
  });

  it("таблиця обгорнута в .table-scroll з col-класами (адаптив)", async () => {
    const html = await render("oils.ejs", ctx);
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain("oils-table");
    expect(html).toContain("col-company");
    expect(html).toContain("col-actions");
  });
});

describe("_job-summary.ejs — картка-зведення імпорту", () => {
  const STEP_LABELS = {
    "parse": "Парсинг прайсу", "company-meta": "Метадані компанії",
    "import-photos": "Імпорт фото", "process-photos": "Обробка фото",
  };
  const STEP_ICON = { pending: "○", running: "▸", done: "✓", failed: "✗" };

  function fullSummary(over = {}) {
    return {
      mode: "xlsx+photos", company: "EUROLUB", integration: "EUROLUB",
      steps: [
        { name: "parse", status: "done" },
        { name: "company-meta", status: "done" },
        { name: "import-photos", status: "running" },
        { name: "process-photos", status: "pending" },
      ],
      diff: { inserted: 3, updated: 5, pricesSet: 2, priceUnchanged: 7, outdated: 1,
              newExamples: ["A1 — Oil A"], priceChanges: ["B2: 100 → 120 ₴"] },
      photoLink: { files: 10, linked: 8, dup: 2, unmatched: 0, oilsWithoutPhoto: 1 },
      photoProcess: { candidates: 8, done: 8, skipped: 0, failed: 0 },
      ...over,
    };
  }

  it("рендерить кроки, бейджі режиму та diff-числа", async () => {
    const html = await render("_job-summary.ejs", { summary: fullSummary(), STEP_LABELS, STEP_ICON });
    expect(html).toContain("Режим:");
    expect(html).toContain("xlsx+photos");
    expect(html).toContain("Парсинг прайсу");
    expect(html).toContain("Обробка фото");
    // diff-числа
    expect(html).toContain("створено");
    expect(html).toContain("зміни ціни");
    expect(html).toContain("треба оновити на TM");
    // приклади
    expect(html).toContain("A1 — Oil A");
    expect(html).toContain("B2: 100 → 120");
  });

  it("режим тільки фото: без diff-секції, але з прив'язкою/обробкою", async () => {
    const html = await render("_job-summary.ejs", {
      summary: fullSummary({ mode: "photos-only", diff: null,
        steps: [{ name: "import-photos", status: "done" }, { name: "process-photos", status: "done" }] }),
      STEP_LABELS, STEP_ICON,
    });
    expect(html).toContain("photos-only");
    expect(html).not.toContain("Оливи / ціни");
    expect(html).toContain("Фото — прив'язка");
    expect(html).toContain("Фото — обробка");
  });

  it("summary=null → нічого не падає (порожньо)", async () => {
    const html = await render("_job-summary.ejs", { summary: null, STEP_LABELS, STEP_ICON });
    expect(html.trim()).toBe("");
  });
});

describe("job.ejs — сторінка задачі (укр статуси + Київ час)", () => {
  function job(over = {}) {
    return {
      id: 7, kind: "import", status: "done",
      created_at: "2026-06-02T12:00:00Z",
      started_at: "2026-06-02T12:00:01Z",
      finished_at: "2026-06-02T12:00:30Z",
      log: "рядок логу",
      error: null,
      params: { summary: {
        mode: "xlsx+photos", company: "EUROLUB", integration: "EUROLUB",
        steps: [{ name: "parse", status: "done" }, { name: "process-photos", status: "running" }],
        diff: { inserted: 2, updated: 3, pricesSet: 1, priceUnchanged: 4, outdated: 0 },
        photoLink: null, photoProcess: null,
      } },
      ...over,
    };
  }

  it("тип і статус задачі — українською, не сирим кодом", async () => {
    const html = await render("job.ejs", { job: job(), canCancel: false });
    expect(html).toContain("Імпорт / оновлення");  // jobKindLabel(import)
    expect(html).toContain("готово");               // jobStatusLabel(done)
    expect(html).not.toMatch(/badge-done">\s*done\s*</); // не лишилось сире "done"
  });

  it("дати — у Київському часі (UTC+3 влітку)", async () => {
    const html = await render("job.ejs", { job: job(), canCancel: false });
    expect(html).toContain("15:00:00"); // 12:00 UTC → 15:00 Kyiv
  });

  it("картка-зведення рендериться з diff і кроками українською", async () => {
    const html = await render("job.ejs", { job: job(), canCancel: false });
    expect(html).toContain("Зведення");
    expect(html).toContain("Парсинг прайсу");
    expect(html).toContain("створено");
    // step-status українською
    expect(html).toContain("виконується");
  });

  it("без summary — картка прихована, сторінка не падає", async () => {
    const html = await render("job.ejs", { job: job({ params: {} }), canCancel: false });
    expect(html).toContain('id="summary-card"');
    expect(html).toContain("display:none");
  });

  it("params як JSON-рядок (з БД) теж парситься", async () => {
    const j = job();
    j.params = JSON.stringify(j.params);
    const html = await render("job.ejs", { job: j, canCancel: false });
    expect(html).toContain("Зведення");
    expect(html).toContain("Парсинг прайсу");
  });
});

describe("jobs.ejs / dashboard.ejs — список задач українською", () => {
  const jobs = [
    { id: 1, kind: "import", status: "done", created_at: "2026-06-02T12:00:00Z", finished_at: "2026-06-02T12:01:00Z" },
    { id: 2, kind: "tm-delete", status: "running", created_at: "2026-06-02T12:05:00Z", finished_at: null },
  ];

  it("jobs.ejs: kind/status українською, час Київ, finished=null → тире", async () => {
    const html = await render("jobs.ejs", { jobs });
    expect(html).toContain("Імпорт / оновлення");
    expect(html).toContain("Видалення з TM");
    expect(html).toContain("готово");
    expect(html).toContain("виконується");
    expect(html).toContain("15:00:00");  // Київ
    expect(html).toContain("—");          // finished_at=null
  });

  it("dashboard.ejs: ті самі переклади", async () => {
    const html = await render("dashboard.ejs", {
      jobs, stats: { oils: 56, photos: 38, processed: 38, published: 10 },
    });
    expect(html).toContain("Імпорт / оновлення");
    expect(html).toContain("готово");
  });
});

describe("import.ejs — форма з опціональним xlsx", () => {
  const ctx = { integrations: [{ code: "EUROLUB", name: "EUROLUB" }], companies: [] };

  it("xlsx-інпут БЕЗ required (необов'язковий)", async () => {
    const html = await render("import.ejs", ctx);
    const xlsxTag = html.match(/<input[^>]*id="xlsxInput"[^>]*>/)[0];
    expect(xlsxTag).not.toContain("required");
  });

  it("містить інфо-картку 'Як це працює'", async () => {
    const html = await render("import.ejs", ctx);
    expect(html).toContain("Як це працює");
    expect(html).toContain("тільки прайс, або тільки фото");
  });

  it("перемикач режиму: дві кнопки 'Додати нову' / 'Оновити наявну'", async () => {
    const html = await render("import.ejs", ctx);
    expect(html).toContain("mode-switch");
    expect(html).toContain("Додати нову компанію");
    expect(html).toContain("Оновити наявну");
    expect(html).toContain('name="mode"');
  });

  it("режим 'Додати': текстове поле нової компанії (companyNew)", async () => {
    const html = await render("import.ejs", ctx);
    expect(html).toContain('name="companyNew"');
    expect(html).toContain('id="companyInput"');
  });

  it("'Оновити' показує ЛИШЕ вибір компанії: інтеграція/місто/країна — add-only", async () => {
    const html = await render("import.ejs", ctx);
    // поле інтеграції позначене як add-блок (ховається в update)
    expect(html).toMatch(/data-mode-block="add"[^>]*>\s*<span class="field-label">Інтеграція/);
    // місто й країна теж add-only
    const cityBlock = html.match(/<label[^>]*data-field="city"[^>]*>/)[0];
    const countryBlock = html.match(/<label[^>]*data-field="country"[^>]*>/)[0];
    expect(cityBlock).toContain('data-mode-block="add"');
    expect(countryBlock).toContain('data-mode-block="add"');
    // блок вибору наявної компанії — update-only
    const updCompany = html.match(/<label[^>]*data-mode-block="update"[^>]*>/)[0];
    expect(updCompany).toContain('data-field="company"');
  });

  it("без компаній — кнопка 'Оновити наявну' disabled", async () => {
    const html = await render("import.ejs", { ...ctx, companies: [] });
    const updBtn = html.match(/<button[^>]*data-mode="update"[^>]*>/)[0];
    expect(updBtn).toContain("disabled");
  });

  it("з компаніями — dropdown наявних (companyExisting) з опціями", async () => {
    const html = await render("import.ejs", {
      ...ctx,
      companies: [
        { name_company: "EUROLUB", country: "DE", xlsx_path: null, xlsx_at: null, photos_dir: null, photos_at: null },
        { name_company: "Manager", country: null, xlsx_path: null, xlsx_at: null, photos_dir: null, photos_at: null },
      ],
    });
    expect(html).toContain('name="companyExisting"');
    expect(html).toContain('id="companySelect"');
    // обидві компанії як опції
    expect(html).toContain('value="EUROLUB"');
    expect(html).toContain('value="Manager"');
    // кнопка 'Оновити' НЕ disabled, коли компанії є
    const updBtn = html.match(/<button[^>]*data-mode="update"[^>]*>/)[0];
    expect(updBtn).not.toContain("disabled");
  });
});

describe("company.ejs — редагування компанії", () => {
  const ctx = {
    company: { id: 5, name_company: "EUROLUB", country: "Німеччина" },
    counts: { total: 10, pending: 10, in_progress: 0, done: 0, failed: 0 },
    oils: [], search: "", status: "",
  };

  it("містить згортну форму редагування з name+country", async () => {
    const html = await render("company.ejs", ctx);
    expect(html).toContain('action="/companies/5/edit"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="country"');
    // поточні значення підставлені
    expect(html).toContain('value="EUROLUB"');
    expect(html).toContain('value="Німеччина"');
    expect(html).toContain("Зберегти зміни");
  });

  it("таблиця компанії обгорнута в .table-scroll", async () => {
    const html = await render("company.ejs", ctx);
    expect(html).toContain('class="table-scroll"');
  });
});
