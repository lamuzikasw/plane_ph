import type { TIssueComment } from "@plane/types";
import { sanitizeHTML } from "@plane/utils";

/** Relative age of the newest reply, independent of edits to older messages. */
export function getThreadReplyTime(timestamp: number, now: number, locale: string) {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (seconds < 60) return formatter.format(0, "second");
  const units = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ] as const;
  const [divisor, unit] = units.find(([size]) => seconds >= size)!;
  return formatter.format(-Math.floor(seconds / divisor), unit);
}

/** Extract inert text for the short reply preview, keeping words in adjacent blocks apart. */
export function getCommentReplyQuote(comment: Pick<TIssueComment, "comment_html" | "comment_stripped">) {
  const html = comment.comment_html || comment.comment_stripped || "";
  const sanitized = sanitizeHTML(html.replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]|pre|blockquote|tr))>/gi, " "));
  const decoded =
    typeof DOMParser === "undefined"
      ? sanitized
      : (new DOMParser().parseFromString(sanitized, "text/html").body.textContent ?? "");
  const text = decoded.replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  return characters.length > 180 ? `${characters.slice(0, 180).join("").trimEnd()}…` : text;
}

/** Keep legacy/orphan comments visible; replies within a thread are always chronological. */
export function groupCommentThreads(comments: TIssueComment[]) {
  const ids = new Set(comments.map((comment) => comment.id));
  const roots: TIssueComment[] = [];
  const replies = new Map<string, TIssueComment[]>();
  for (const comment of comments) {
    if (comment.parent && ids.has(comment.parent)) {
      const thread = replies.get(comment.parent) ?? [];
      thread.push(comment);
      replies.set(comment.parent, thread);
    } else {
      roots.push(comment);
    }
  }
  for (const thread of replies.values()) {
    thread.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }
  return { roots, replies };
}
