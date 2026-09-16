// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EActivityFilterType } from "@plane/constants";
import type { TIssue } from "@plane/types";

const mocks = vi.hoisted(() => ({ push: vi.fn(), setPeekIssue: vi.fn(), alreadyOpen: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({ getIsIssuePeeked: () => mocks.alreadyOpen, setPeekIssue: mocks.setPeekIssue }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ getProjectIdentifierById: () => "SPRINT" }),
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: () => "Комментарии" }) }));
vi.mock("@plane/propel/tooltip", () => ({ Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</> }));
import { IssueCommentCount } from "@/components/issues/issue-layouts/properties/comment-count";
import { useCommentNavigation } from "@/hooks/use-comment-navigation";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";

const savedFilters = [EActivityFilterType.ACTIVITY];
const saveFilters = vi.fn();
const cardClick = vi.fn();
const scroll = vi.fn();
let root: ReturnType<typeof createRoot>;

function Card({ mobile = false }: { mobile?: boolean }) {
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const issue = { id: "task", project_id: "project", sequence_id: 54 } as TIssue;
  return (
    <div role="presentation" onClick={cardClick} onKeyDown={cardClick}>
      <IssueCommentCount
        count={1}
        onClick={() => handleRedirection("payholder", issue, mobile, undefined, "comments")}
      />
    </div>
  );
}

function Discussion({
  ready,
  requestKey,
  issueId = "task",
}: {
  ready: boolean;
  requestKey?: number;
  issueId?: string;
}) {
  const { activityRef, filters, setFilters } = useCommentNavigation({
    requestKey,
    issueId,
    ready,
    savedFilters,
    saveFilters,
  });
  return (
    <div ref={activityRef} tabIndex={-1} data-testid="discussion">
      <span>{filters.join(",")}</span>
      <button onClick={() => setFilters([EActivityFilterType.COMMENT, EActivityFilterType.ACTIVITY])}>filters</button>
    </div>
  );
}
async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}
async function flushFrame() {
  await act(async () => vi.runAllTimers());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.alreadyOpen = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  // jsdom does not implement scrolling; observe the browser call.
  // eslint-disable-next-line no-extend-native
  HTMLElement.prototype.scrollIntoView = scroll;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("comment badge navigation", () => {
  it("opens the side peek once without triggering the card click", async () => {
    await render(<Card />);
    await act(async () => document.querySelector("button")!.click());
    expect(cardClick).not.toHaveBeenCalled();
    expect(mocks.setPeekIssue).toHaveBeenCalledTimes(1);
    expect(mocks.setPeekIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "task", commentsRequestedAt: expect.any(Number) })
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("lets keyboard activation stay on the badge and handles an already open task", async () => {
    mocks.alreadyOpen = true;
    await render(<Card />);
    const button = document.querySelector("button")!;
    button.focus();
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      button.click(); // Native buttons synthesize click for keyboard activation.
    });
    expect(cardClick).not.toHaveBeenCalled();
    expect(mocks.setPeekIssue).toHaveBeenCalledTimes(1);
  });
  it("uses the comments anchor on mobile", async () => {
    await render(<Card mobile />);
    await act(async () => document.querySelector("button")!.click());
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining("#comments"));
    expect(mocks.setPeekIssue).not.toHaveBeenCalled();
  });
  it("waits for the discussion, scrolls once, and shows comments without changing saved filters", async () => {
    await render(<Discussion ready={false} requestKey={1} />);
    await flushFrame();
    expect(scroll).not.toHaveBeenCalled();
    expect(document.querySelector("span")?.textContent).toBe("COMMENT");
    await render(<Discussion ready requestKey={1} />);
    await flushFrame();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.querySelector('[data-testid="discussion"]'));
    await act(async () => document.querySelector("button")!.click());
    await render(<Discussion ready requestKey={1} />);
    await flushFrame();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(saveFilters).not.toHaveBeenCalled();
    await render(<Discussion ready requestKey={2} />);
    await flushFrame();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(document.querySelector("span")?.textContent).toBe("COMMENT");
  });
  it("does not scroll on normal task opens and cancels pending scrolling on close", async () => {
    await render(<Discussion ready />);
    await flushFrame();
    expect(scroll).not.toHaveBeenCalled();
    expect(document.querySelector("span")?.textContent).toBe("ACTIVITY");
    await render(<Discussion ready requestKey={1} />);
    await render(null);
    await flushFrame();
    expect(scroll).not.toHaveBeenCalled();
  });
});
