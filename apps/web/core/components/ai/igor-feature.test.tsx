import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const instance = vi.hoisted(() => ({ config: undefined as { is_igor_enabled?: boolean } | undefined }));
vi.mock("@/hooks/store/use-instance", () => ({ useInstance: () => instance }));
import { IgorFeature } from "./igor-feature";

it.each([undefined, {}, { is_igor_enabled: false }])("does not mount Igor when config is %j", (config) => {
  instance.config = config;
  const Chat = vi.fn(() => <button>Игорь</button>);
  expect(
    renderToStaticMarkup(
      <IgorFeature>
        <Chat />
      </IgorFeature>
    )
  ).toBe("");
  expect(Chat).not.toHaveBeenCalled();
});

it("allows the preserved chat to mount when explicitly re-enabled", () => {
  instance.config = { is_igor_enabled: true };
  expect(
    renderToStaticMarkup(
      <IgorFeature>
        <button>Игорь</button>
      </IgorFeature>
    )
  ).toContain("Игорь");
});
