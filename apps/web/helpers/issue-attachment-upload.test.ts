import { describe, expect, it } from "vitest";
import { getFileMetaDataForUpload } from "@plane/services";

describe("Markdown attachment uploads", () => {
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
