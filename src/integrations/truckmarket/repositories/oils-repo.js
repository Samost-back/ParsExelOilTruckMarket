// SRP: всі SQL-запити навколо olivs/oils_images зосереджені тут.
// Сервіси/оркестратор не пишуть SQL напряму.

// Беремо лише ті, що:
//   - ще не опубліковані (truck_listing_id IS NULL)
//   - статус НЕ 'unpublished' (картку зняли вручну — не повертати автоматично)
//   - статус НЕ 'in_progress' (вже в роботі іншого прогону)
const SELECT_PENDING = `
  SELECT o.id, o.name_type_oil, o.name, o.type_oil, o.viscosity_sae,
         o.low_level_saps, o.packaging_volume, o.articul, o.acea, o.api,
         o.manufacturers_tolerances, o.car_brand, o.quantity,
         o.iso_vg_viscosity_grade, o.color_liquid, o.dot,
         o.ai_description, o.brand, o.city,
         c.name_company AS company_name, c.city AS company_city,
         (SELECT p.price FROM oils_price p
            WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price
    FROM olivs o
    JOIN company_olivs c ON c.id = o.company_id
   WHERE o.truck_listing_id IS NULL
     AND COALESCE(o.truck_status, 'pending') NOT IN ('unpublished', 'in_progress')
     AND o.name_type_oil = ANY($2)
   ORDER BY o.name_type_oil, o.id
   LIMIT $1
`;

const SELECT_PENDING_PHOTOS = `
  SELECT id, file_path, processed_path, processed_status
    FROM oils_images
   WHERE oils_id = $1 AND uploaded_at IS NULL
ORDER BY sort_order, id
`;

const SELECT_ALL_PUBLISHED = `
  SELECT id, articul, name, truck_listing_id
    FROM olivs
   WHERE truck_listing_id IS NOT NULL
   ORDER BY truck_listing_id
`;

// Оливи, опубліковані на TM, чию ціну змінили після публікації
// (truck_status='outdated'). Беремо повний row + актуальну ціну — щоб
// зібрати payload оновлення (ціна/опис) для updateListing.
const SELECT_OUTDATED = `
  SELECT o.id, o.name_type_oil, o.name, o.type_oil, o.viscosity_sae,
         o.low_level_saps, o.packaging_volume, o.articul, o.acea, o.api,
         o.manufacturers_tolerances, o.car_brand, o.quantity,
         o.iso_vg_viscosity_grade, o.color_liquid, o.dot,
         o.ai_description, o.brand, o.city, o.truck_listing_id,
         c.name_company AS company_name, c.city AS company_city,
         (SELECT p.price FROM oils_price p
            WHERE p.oils_id = o.id AND p.valid_to IS NULL LIMIT 1) AS price
    FROM olivs o
    JOIN company_olivs c ON c.id = o.company_id
   WHERE o.truck_status = 'outdated'
     AND o.truck_listing_id IS NOT NULL
     AND o.name_type_oil = ANY($2)
   ORDER BY o.name_type_oil, o.id
   LIMIT $1
`;

class OilsRepo {
  constructor(db) { this.db = db; }

  findPending(limit, eligibleTypes) {
    return this.db.query(SELECT_PENDING, [limit, eligibleTypes]).then((r) => r.rows);
  }

  findPendingPhotos(oilsId) {
    return this.db.query(SELECT_PENDING_PHOTOS, [oilsId]).then((r) => r.rows);
  }

  // Скільки фото готові до заливки (ще не залиті). 0 → публікувати немає сенсу
  // (оголошення без фото не створюємо). Той самий критерій, що й SELECT_PENDING_PHOTOS.
  countUploadablePhotos(oilsId) {
    return this.db
      .query(`SELECT count(*)::int AS c FROM oils_images WHERE oils_id = $1 AND uploaded_at IS NULL`, [oilsId])
      .then((r) => r.rows[0].c);
  }

  findAllPublished() {
    return this.db.query(SELECT_ALL_PUBLISHED).then((r) => r.rows);
  }

  findOutdated(limit, eligibleTypes) {
    return this.db.query(SELECT_OUTDATED, [limit, eligibleTypes]).then((r) => r.rows);
  }

  // Після успішного updateListing — повертаємо статус 'done' (оголошення знову
  // синхронізоване), listing_id не змінюється.
  async markTruckUpdated(oilsId) {
    await this.db.query(
      `UPDATE olivs
          SET truck_status = 'done',
              truck_error = NULL,
              truck_at = NOW()
        WHERE id = $1`,
      [oilsId],
    );
  }

  async setListingId(oilsId, listingId) {
    await this.db.query(
      `UPDATE olivs
          SET truck_listing_id = $1,
              truck_status = 'done',
              truck_error = NULL,
              truck_at = NOW()
        WHERE id = $2`,
      [listingId, oilsId],
    );
  }

  async clearListingId(oilsId) {
    await this.db.query(
      `UPDATE olivs
          SET truck_listing_id = NULL,
              truck_status = NULL,
              truck_error = NULL,
              truck_at = NULL
        WHERE id = $1`,
      [oilsId],
    );
  }

  async markTruckInProgress(oilsId) {
    await this.db.query(
      `UPDATE olivs
          SET truck_status = 'in_progress',
              truck_error = NULL,
              truck_at = NOW()
        WHERE id = $1`,
      [oilsId],
    );
  }

  async markTruckFailed(oilsId, error) {
    await this.db.query(
      `UPDATE olivs
          SET truck_status = 'failed',
              truck_error = $1,
              truck_at = NOW()
        WHERE id = $2`,
      [error, oilsId],
    );
  }

  async markPhotoUploaded(photoId) {
    await this.db.query(
      `UPDATE oils_images SET uploaded_at = NOW(), upload_error = NULL WHERE id = $1`,
      [photoId],
    );
  }

  async markPhotoFailed(photoId, error) {
    await this.db.query(
      `UPDATE oils_images SET upload_error = $1 WHERE id = $2`,
      [error, photoId],
    );
  }

  async setAiDescriptionDone(oilsId, description) {
    await this.db.query(
      `UPDATE olivs
          SET ai_description = $1,
              ai_description_status = 'done',
              ai_description_error = NULL,
              ai_description_at = NOW()
        WHERE id = $2`,
      [description, oilsId],
    );
  }

  async setAiDescriptionFailed(oilsId, error) {
    await this.db.query(
      `UPDATE olivs
          SET ai_description_status = 'failed',
              ai_description_error = $1,
              ai_description_at = NOW()
        WHERE id = $2`,
      [error, oilsId],
    );
  }

  async resetPhotosUpload(oilsIds) {
    if (!oilsIds.length) return 0;
    const r = await this.db.query(
      `UPDATE oils_images SET uploaded_at = NULL, upload_error = NULL
        WHERE oils_id = ANY($1) AND uploaded_at IS NOT NULL RETURNING id`,
      [oilsIds],
    );
    return r.rowCount;
  }
}

module.exports = { OilsRepo };
