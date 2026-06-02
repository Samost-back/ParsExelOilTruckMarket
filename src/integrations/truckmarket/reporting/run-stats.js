// SRP: тільки збір і презентація статистики прогону.
// Розділена з оркестратором, щоб у нього не було знання про "як виводити".

class RunStats {
  constructor() {
    this.buckets = {
      created: [], blacklist: [], no_integration: [],
      mapping_error: [], api_error: [], no_photos: [],
    };
  }

  addBlacklist(row)      { this.buckets.blacklist.push(this._slim(row)); }
  addNoIntegration(row)  { this.buckets.no_integration.push(this._slim(row)); }
  addMappingError(row,r) { this.buckets.mapping_error.push({ ...this._slim(row), reason: r }); }
  addApiError(row,r)     { this.buckets.api_error.push({ ...this._slim(row), reason: r }); }
  addNoPhotos(row)       { this.buckets.no_photos.push(this._slim(row)); }
  addCreated(row, listingId, photos) {
    this.buckets.created.push({
      ...this._slim(row),
      listingId,
      photosUploaded: photos ? photos.uploaded : 0,
      photosFailed:   photos ? photos.failed.length : 0,
    });
  }

  _slim(row) { return { id: row.id, type: row.name_type_oil, name: row.name }; }

  summaryTable() {
    const u = this.buckets.created.reduce((s, x) => s + x.photosUploaded, 0);
    const f = this.buckets.created.reduce((s, x) => s + x.photosFailed,   0);
    return [
      { status: "✓ created",          count: this.buckets.created.length },
      { status: "⊘ blacklist",        count: this.buckets.blacklist.length },
      { status: "⊘ no_integration",   count: this.buckets.no_integration.length },
      { status: "⊘ no_photos",        count: this.buckets.no_photos.length },
      { status: "✗ mapping_error",    count: this.buckets.mapping_error.length },
      { status: "✗ api_error",        count: this.buckets.api_error.length },
      { status: "📷 photos uploaded", count: u },
      { status: "📷 photos failed",   count: f },
    ];
  }

  byTypeTable() {
    const out = {};
    for (const [status, items] of Object.entries(this.buckets)) {
      for (const it of items) {
        const t = it.type || "—";
        out[t] = out[t] || { created: 0, blacklist: 0, no_integration: 0, mapping_error: 0, api_error: 0, no_photos: 0 };
        out[t][status]++;
      }
    }
    return out;
  }

  errorList() {
    return [...this.buckets.mapping_error, ...this.buckets.api_error];
  }
}

module.exports = { RunStats };
