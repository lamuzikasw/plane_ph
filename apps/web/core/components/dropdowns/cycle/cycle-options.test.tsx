// @vitest-environment jsdom
import React, { act, forwardRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CycleOptions } from "./cycle-options";

const store = vi.hoisted(() => ({
  getProjectCycleIds: vi.fn(),
  getCycleById: vi.fn(),
  fetchAllCycles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("mobx-react", () => ({ observer: (component: unknown) => component }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "workspace" }) }));
vi.mock("@/hooks/store/use-cycle", () => ({ useCycle: () => store }));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("react-popper", () => ({ usePopper: () => ({ styles: {}, attributes: {} }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/icons", () => ({
  CheckIcon: () => null,
  CycleGroupIcon: () => null,
  CycleIcon: () => null,
  SearchIcon: () => null,
}));
vi.mock("@headlessui/react", () => ({
  Combobox: {
    Options: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Input: forwardRef<
      HTMLInputElement,
      React.InputHTMLAttributes<HTMLInputElement> & { displayValue?: unknown; as?: string }
    >(({ displayValue: _displayValue, as: _as, ...props }, ref) => <input {...props} ref={ref} />),
    Option: ({ children }: { children: (state: { selected: boolean }) => ReactNode }) => (
      <div role="option" aria-selected={false}>
        {children({ selected: false })}
      </div>
    ),
  },
}));

describe("cycle destination options", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = async (projectId = "project") => {
    await act(async () =>
      root.render(
        <CycleOptions
          projectId={projectId}
          referenceElement={null}
          placement="bottom-start"
          isOpen
          canRemoveCycle
          currentCycleId="source"
        />
      )
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.getProjectCycleIds.mockReturnValue(null);
    store.getCycleById.mockImplementation((id: string) => ({ id, name: id, status: "upcoming" }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("fetches an unloaded project's cycles when opened and shows loading", async () => {
    await render();
    expect(store.fetchAllCycles).toHaveBeenCalledExactlyOnceWith("workspace", "project");
    expect(container.textContent).toContain("common.loading");
    expect(container.textContent).not.toContain("common.search.no_matches_found");
    expect(document.activeElement).toBe(container.querySelector("input"));
  });

  it("does not fetch a loaded empty project again", async () => {
    store.getProjectCycleIds.mockReturnValue([]);
    await render();
    expect(store.fetchAllCycles).not.toHaveBeenCalled();
    expect(container.textContent).toContain("cycle.no_cycle");
    expect(container.textContent).not.toContain("common.loading");
  });

  it("loads destinations after the open dropdown changes to another project", async () => {
    store.getProjectCycleIds.mockImplementation((id: string) => (id === "project" ? [] : null));
    await render();
    await render("other-project");
    expect(store.fetchAllCycles).toHaveBeenCalledExactlyOnceWith("workspace", "other-project");
  });

  it("offers current, upcoming and draft destinations while excluding the source and completed cycles", async () => {
    store.getProjectCycleIds.mockReturnValue(["source", "ended", "active", "upcoming", "draft"]);
    store.getCycleById.mockImplementation((id: string) => ({
      id,
      name: id,
      status: (
        { source: "Completed", ended: "COMPLETED", active: "current", upcoming: "upcoming", draft: "draft" } as Record<
          string,
          string
        >
      )[id],
    }));
    await render();
    const options = Array.from(container.querySelectorAll('[role="option"]'), (option) => option.textContent);
    expect(options).toEqual(["cycle.no_cycle", "active", "upcoming", "draft"]);
    expect(store.fetchAllCycles).not.toHaveBeenCalled();
  });
});
