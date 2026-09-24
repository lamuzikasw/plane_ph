import { useMemo } from "react";
import { observer } from "mobx-react";
import { Reply } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueComment } from "@plane/types";
import { useMember } from "@/hooks/store/use-member";
import { getCommentReplyQuote } from "@/helpers/comment-threads";

export const CommentReplyContext = observer(function CommentReplyContext({ comment }: { comment: TIssueComment }) {
  const { t } = useTranslation();
  const { getUserDetails } = useMember();
  const author = getUserDetails(comment.actor) ?? comment.actor_detail;
  const name = author?.display_name || author?.first_name || t("common.unknown_user");
  const { comment_html, comment_stripped } = comment;
  const quote = useMemo(
    () => getCommentReplyQuote({ comment_html, comment_stripped }),
    [comment_html, comment_stripped]
  );

  return (
    <div
      className="flex min-w-0 gap-2 rounded-md border-l-2 border-accent-strong bg-layer-1 px-3 py-2"
      aria-live="polite"
      aria-atomic="true"
    >
      <Reply className="mt-0.5 size-3.5 shrink-0 text-accent-primary" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-caption-sm-medium text-primary">
          {t("issue.comments.replies.replying_to", { name })}
        </p>
        <blockquote className="mt-0.5 line-clamp-2 text-body-sm-regular break-words text-secondary">
          {quote || t("issue.comments.replies.without_text")}
        </blockquote>
      </div>
    </div>
  );
});
