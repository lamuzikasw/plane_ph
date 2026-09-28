import { describe, expect, it } from "vitest";
import { getFileMetaDataForUpload } from "@plane/services";

describe("Attachment file validation", () => {
  it("reports an unreadable Telegram clipboard file instead of returning an empty MIME type", async () => {
    const error = new DOMException("Clipboard file is no longer accessible", "NotReadableError");
    const file = {
      name: "telegram-cloud-photo-size.jpg",
      type: "image/jpeg",
      size: 27614,
      slice: () => ({ arrayBuffer: () => Promise.reject(error) }),
    } as unknown as File;
    await expect(getFileMetaDataForUpload(file)).rejects.toBe(error);
  });

  it("recognizes a readable clipboard PNG without relying on its filename", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
        "base64"
      )
    );
    await expect(getFileMetaDataForUpload(new File([png], "image.png", { type: "image/png" }))).resolves.toMatchObject({
      type: "image/png",
    });
  });
  it.each(["0011.md", "README.MD", "notes.markdown"])(
    "recognizes %s when the browser supplies no MIME type",
    async (name) => {
      const file = new File(["# Задача\n\nОписание и [ссылка](https://example.com)."], name);

      await expect(getFileMetaDataForUpload(file)).resolves.toEqual({
        name,
        size: file.size,
        type: "text/markdown",
      });
    }
  );

  it("keeps binary signature detection ahead of the extension fallback", async () => {
    const file = new File(["%PDF-1.7\n"], "document.md");

    await expect(getFileMetaDataForUpload(file)).resolves.toMatchObject({ type: "application/pdf" });
  });

  it("does not trust the browser MIME type for unknown extensions", async () => {
    const file = new File(["unknown content"], "document.unknown", { type: "text/markdown" });

    await expect(getFileMetaDataForUpload(file)).resolves.toMatchObject({ type: "" });
  });
});
