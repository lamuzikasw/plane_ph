// @vitest-environment jsdom

import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  mutate: vi.fn(),
  refresh: vi.fn(),
  modalOpen: false,
  toggleIssueProjectsModal: vi.fn(),
}));
vi.mock("mobx-react", () => ({ observer: (component: unknown) => component }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@headlessui/react", () => ({
  Dialog: { Title: ({ children }: React.PropsWithChildren) => <h3>{children}</h3> },
}));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({ toggleIssueProjectsModal: mocks.toggleIssueProjectsModal }),
}));
vi.mock("@/hooks/store/use-issues", () => ({
  useIssues: () => ({ issues: { fetchIssuesWithExistingPagination: mocks.refresh } }),
}));
vi.mock("@/services/issue/issue-placement.service", () => ({
  IssuePlacementService: class {
    attach = mocks.attach;
  },
}));
vi.mock("swr", () => ({
  default: () => ({
    mutate: mocks.mutate,
    data: {
      enabled: true,
      can_manage: true,
      placements: [],
      available_projects: [{ id: "sprint", name: "Общий спринт ТО", identifier: "SPRINT" }],
    },
  }),
}));
vi.mock("@plane/propel/button", () => ({
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: {}, setToast: vi.fn() }));
vi.mock("@plane/ui", () => ({
  EModalPosition: {},
  EModalWidth: {},
  ModalCore: ({ isOpen, children }: React.PropsWithChildren<{ isOpen: boolean }>) =>
    isOpen ? createPortal(<section role="dialog">{children}</section>, document.body) : null,
}));
vi.mock("@/components/common/layout/sidebar/property-list-item", () => ({
  SidebarPropertyListItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

import { IssueProjectsProperty } from "@/components/issues/issue-detail/projects-property";
import usePeekOverviewOutsideClickDetector from "@/hooks/use-peek-overview-outside-click";

function PeekHarness() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  usePeekOverviewOutsideClickDetector(
    ref,
    () => {
      if (!mocks.modalOpen) setOpen(false);
    },
    "work-item"
  );
  return open ? (
    <div ref={ref} data-testid="peek">
      <IssueProjectsProperty workspaceSlug="payholder" projectId="seva" issueId="work-item" disabled={false} />
    </div>
  ) : null;
}

let root: ReturnType<typeof createRoot>;
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text)!;
async function click(node: HTMLElement) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    node.click();
  });
}
async function openDialog() {
  await click(button("issue_projects.add"));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(mocks.modalOpen).toBe(true);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.modalOpen = false;
  mocks.toggleIssueProjectsModal.mockImplementation((open: boolean) => {
    mocks.modalOpen = open;
  });
  mocks.attach.mockReset().mockResolvedValue(undefined);
  mocks.mutate.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<PeekHarness />);
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("adding a project from a side peek", () => {
  it("keeps the popup and task open when selecting a project, then saves the selection", async () => {
    await openDialog();
    await click(document.querySelector("label")!);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(document.querySelector('[data-testid="peek"]')).not.toBeNull();
    expect(mocks.attach).not.toHaveBeenCalled();
    await click(button("issue_projects.add_selected"));
    expect(mocks.attach).toHaveBeenCalledWith("payholder", "seva", "work-item", "sprint");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-testid="peek"]')).not.toBeNull();
    expect(mocks.modalOpen).toBe(false);
  });
  it("cancel closes only the popup and unmount releases the modal guard", async () => {
    await openDialog();
    await click(button("cancel"));
    expect(document.querySelector('[data-testid="peek"]')).not.toBeNull();
    expect(mocks.modalOpen).toBe(false);
    await openDialog();
    await act(async () => {
      root.render(null);
    });
    expect(mocks.modalOpen).toBe(false);
  });
  it("keeps the selection and shows an error if saving fails", async () => {
    mocks.attach.mockRejectedValue(new Error("Request failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await openDialog();
      await click(document.querySelector("label")!);
      await click(button("issue_projects.add_selected"));
      expect(document.querySelector('[role="alert"]')?.textContent).toBe("issue_projects.save_error");
      expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
      expect(document.querySelector('[data-testid="peek"]')).not.toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});
