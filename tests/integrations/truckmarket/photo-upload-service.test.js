import { describe, it, expect, vi } from "vitest";
const { PhotoUploadService } = require("../../../src/integrations/truckmarket/services/photo-upload-service");

function makeRepo(photos) {
  return {
    findPendingPhotos: vi.fn().mockResolvedValue(photos),
    markPhotoUploaded: vi.fn().mockResolvedValue(),
    markPhotoFailed: vi.fn().mockResolvedValue(),
  };
}

describe("PhotoUploadService", () => {
  it("_pickFile: processed коли status='done' і шлях є", () => {
    const r = PhotoUploadService._pickFile({
      processed_status: "done",
      processed_path: "/p/processed.jpg",
      file_path: "/p/orig.png",
    });
    expect(r).toBe("/p/processed.jpg");
  });

  it("_pickFile: оригінал коли processed не готовий", () => {
    expect(PhotoUploadService._pickFile({
      processed_status: "skipped",
      processed_path: null,
      file_path: "/p/o.png",
    })).toBe("/p/o.png");

    expect(PhotoUploadService._pickFile({
      processed_status: "done",
      processed_path: null,  // no processed file
      file_path: "/p/o.png",
    })).toBe("/p/o.png");
  });

  it("uploadAllFor: успіх для всіх → counts", async () => {
    const api = { uploadListingImage: vi.fn().mockResolvedValue({}) };
    const repo = makeRepo([
      { id: 1, file_path: "/o.png", processed_path: "/p.jpg", processed_status: "done" },
      { id: 2, file_path: "/o2.png", processed_path: null, processed_status: "skipped" },
    ]);
    const svc = new PhotoUploadService({ api, repo });

    const result = await svc.uploadAllFor({ oilsId: 42, listingId: 100 });
    expect(result).toEqual({ uploaded: 2, failed: [] });
    expect(api.uploadListingImage).toHaveBeenCalledTimes(2);
    // Перший — processed_path, другий — file_path
    expect(api.uploadListingImage.mock.calls[0]).toEqual([100, "/p.jpg"]);
    expect(api.uploadListingImage.mock.calls[1]).toEqual([100, "/o2.png"]);
    expect(repo.markPhotoUploaded).toHaveBeenCalledTimes(2);
    expect(repo.markPhotoFailed).not.toHaveBeenCalled();
  });

  it("uploadAllFor: помилка одного не зупиняє інших", async () => {
    const api = {
      uploadListingImage: vi.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("TM 500"))
        .mockResolvedValueOnce({}),
    };
    const repo = makeRepo([
      { id: 1, file_path: "/a", processed_path: null, processed_status: null },
      { id: 2, file_path: "/b", processed_path: null, processed_status: null },
      { id: 3, file_path: "/c", processed_path: null, processed_status: null },
    ]);
    const svc = new PhotoUploadService({ api, repo });

    const result = await svc.uploadAllFor({ oilsId: 1, listingId: 1 });
    expect(result.uploaded).toBe(2);
    expect(result.failed).toEqual([{ file: "/b", error: "TM 500" }]);
    expect(repo.markPhotoFailed).toHaveBeenCalledWith(2, "TM 500");
    expect(repo.markPhotoUploaded).toHaveBeenCalledTimes(2);
  });

  it("uploadAllFor: пустий список → одразу {uploaded:0, failed:[]}", async () => {
    const api = { uploadListingImage: vi.fn() };
    const repo = makeRepo([]);
    const svc = new PhotoUploadService({ api, repo });

    const result = await svc.uploadAllFor({ oilsId: 1, listingId: 1 });
    expect(result).toEqual({ uploaded: 0, failed: [] });
    expect(api.uploadListingImage).not.toHaveBeenCalled();
  });
});
