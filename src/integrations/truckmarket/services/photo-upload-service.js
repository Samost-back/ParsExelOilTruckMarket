// SRP: лише завантаження фото для одного listing'а.
// Пріоритет: оброблений (processed_path, status='done') > оригінал.
// DIP: залежить від інтерфейсів api.uploadListingImage() і OilsRepo.
class PhotoUploadService {
  constructor({ api, repo }) {
    this.api = api;
    this.repo = repo;
  }

  static _pickFile(photo) {
    return photo.processed_status === "done" && photo.processed_path
      ? photo.processed_path
      : photo.file_path;
  }

  async uploadAllFor({ oilsId, listingId }) {
    const photos = await this.repo.findPendingPhotos(oilsId);
    const result = { uploaded: 0, failed: [] };
    for (const p of photos) {
      const file = PhotoUploadService._pickFile(p);
      try {
        await this.api.uploadListingImage(listingId, file);
        await this.repo.markPhotoUploaded(p.id);
        result.uploaded++;
      } catch (e) {
        await this.repo.markPhotoFailed(p.id, e.message);
        result.failed.push({ file, error: e.message });
      }
    }
    return result;
  }
}

module.exports = { PhotoUploadService };
