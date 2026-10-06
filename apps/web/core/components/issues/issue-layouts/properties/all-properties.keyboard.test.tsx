// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IUserLite, TIssue } from "@plane/types";
import { IssueProperties } from "./all-properties";

const mocks = vi.hoisted(() => ({
  updateIssue: vi.fn().mockResolvedValue(undefined),
  cardKeyDown: vi.fn(),
  cardClick: vi.fn(),
  fetchProjectMembers: vi.fn(),
}));

const members: Record<string, IUserLite> = {
  "alex-id": { id: "alex-id", display_name: "Алексей", first_name: "Алексей", last_name: "Смирнов" } as IUserLite,
  "maria-id": { id: "maria-id", display_name: "Мария", first_name: "Мария", last_name: "Иванова" } as IUserLite,
};
const issue = {
  id: "issue-124",
  project_id: "project-1",
  name: "Search assignees on the Kanban card",
  assignee_ids: [],
  label_ids: [],
  module_ids: [],
} as unknown as TIssue;

vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "payholder", projectId: "project-1" }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/dropdowns/buttons", () => ({
  DropdownButton: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-popper", () => ({ usePopper: () => ({ styles: {}, attributes: {} }) }));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/hooks/store/use-member", () => ({
  useMember: () => ({
    getUserDetails: (id: string) => members[id],
    project: { getProjectMemberIds: () => Object.keys(members), fetchProjectMembers: mocks.fetchProjectMembers },
    workspace: { workspaceMemberIds: Object.keys(members), isUserSuspended: () => false },
  }),
}));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "other-user" } }) }));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ getProjectById: () => ({ cycle_view: false, module_view: false }) }),
}));
vi.mock("@/hooks/store/use-label", () => ({ useLabel: () => ({ labelMap: {} }) }));
vi.mock("@/hooks/store/use-project-state", () => ({ useProjectState: () => ({ getStateById: () => undefined }) }));
vi.mock("@/hooks/store/estimates", () => ({
  useProjectEstimates: () => ({ areEstimateEnabledByProjectId: () => false }),
}));
vi.mock("@/hooks/use-issue-layout-store", () => ({ useIssueStoreType: () => "PROJECT" }));
vi.mock("@/hooks/store/use-issues", () => ({ useIssues: () => ({ issues: {} }) }));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-issue-peek-overview-redirection", () => ({ default: () => ({ handleRedirection: vi.fn() }) }));
vi.mock("@/plane-web/components/issues/issue-layouts/additional-properties", () => ({
  WorkItemLayoutAdditionalProperties: () => null,
}));
vi.mock("./comment-count", () => ({ IssueCommentCount: () => null }));
vi.mock("./labels", () => ({ IssuePropertyLabels: () => null }));
vi.mock("@/components/dropdowns/state/dropdown", () => ({ StateDropdown: () => null }));
vi.mock("@/components/dropdowns/priority", () => ({ PriorityDropdown: () => null }));
vi.mock("@/components/dropdowns/date", () => ({ DateDropdown: () => null }));
vi.mock("@/components/dropdowns/date-range", () => ({ DateRangeDropdown: () => null }));
vi.mock("@/components/dropdowns/estimate", () => ({ EstimateDropdown: () => null }));
vi.mock("@/components/dropdowns/cycle", () => ({ CycleDropdown: () => null }));
vi.mock("@/components/dropdowns/module/dropdown", () => ({ ModuleDropdown: () => null }));

describe("searching assignees from issue card properties", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderCard(readOnly = false) {
    await act(async () =>
      root.render(
        <div onKeyDown={mocks.cardKeyDown} onClick={mocks.cardClick} role="presentation">
          <IssueProperties
            issue={issue}
            updateIssue={mocks.updateIssue}
            displayProperties={{ assignee: true }}
            isReadOnly={readOnly}
            className=""
            activeLayout="Kanban"
          />
        </div>
      )
    );
  }

  async function openAssignees() {
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    // Desktop cards mount their real ComboDropDown on hover.
    await act(async () => trigger.parentElement!.dispatchEvent(new MouseEvent("mouseenter")));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    return document.body.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  }

  async function keyDown(input: HTMLInputElement, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(event));
    return event;
  }

  async function changeInput(input: HTMLInputElement, value: string) {
    // jsdom does not insert text on keydown: issue the native input event after
    // checking the real React/Headless UI event chain allows that browser default.
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it.each(["а", "A", " ", "Backspace", "Tab"])("allows %s without forwarding the key to the card", async (key) => {
    await renderCard();
    const input = await openAssignees();

    expect(input).not.toBeNull();
    expect(container.contains(input)).toBe(false);
    const event = await keyDown(input, key);

    expect(event.defaultPrevented).toBe(false);
    expect(mocks.cardKeyDown).not.toHaveBeenCalled();
    expect(mocks.updateIssue).not.toHaveBeenCalled();
  });

  it("filters the real portal options and assigns only the selected member", async () => {
    await renderCard();
    const input = await openAssignees();
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(2);

    expect((await keyDown(input, "М")).defaultPrevented).toBe(false);
    await changeInput(input, "мАрИя");

    expect(input.value).toBe("мАрИя");
    const options = document.body.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Мария");
    await act(async () => options[0].click());

    expect(mocks.updateIssue).toHaveBeenCalledExactlyOnceWith("project-1", "issue-124", {
      assignee_ids: ["maria-id"],
    });
    expect(mocks.cardKeyDown).not.toHaveBeenCalled();
    expect(mocks.cardClick).not.toHaveBeenCalled();
  });

  it("restores the complete member list after deleting the query", async () => {
    await renderCard();
    const input = await openAssignees();
    await changeInput(input, "смирнов");
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);

    expect((await keyDown(input, "Backspace")).defaultPrevented).toBe(false);
    await changeInput(input, "");

    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(mocks.cardKeyDown).not.toHaveBeenCalled();
    expect(mocks.updateIssue).not.toHaveBeenCalled();
  });

  it("preserves Headless UI arrow and Enter selection without forwarding keys to the card", async () => {
    await renderCard();
    const input = await openAssignees();
    await changeInput(input, "иванова");

    expect((await keyDown(input, "ArrowDown")).defaultPrevented).toBe(true);
    expect((await keyDown(input, "Enter")).defaultPrevented).toBe(true);

    expect(mocks.updateIssue).toHaveBeenCalledExactlyOnceWith("project-1", "issue-124", {
      assignee_ids: ["maria-id"],
    });
    expect(mocks.cardKeyDown).not.toHaveBeenCalled();
  });

  it("keeps read-only assignees disabled and does not open the portal", async () => {
    await renderCard(true);
    const trigger = container.querySelector<HTMLButtonElement>("button")!;

    expect(trigger.disabled).toBe(true);
    await act(async () => trigger.click());

    expect(document.body.querySelector('input[role="combobox"]')).toBeNull();
    expect(mocks.updateIssue).not.toHaveBeenCalled();
  });
});
