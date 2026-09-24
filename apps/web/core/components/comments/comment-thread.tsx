import { Fragment, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { observer } from "mobx-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueComment } from "@plane/types";
import { CommentCard } from "./card/root";
import type { TCommentCard } from "./card/root";
import { CommentCreate } from "./comment-create";
import { CommentThreadSummary } from "./comment-thread-summary";
import { useCommentRead } from "@/hooks/use-comment-read";

export const CommentThread = observer(function CommentThread(props: TCommentCard & { replies: TIssueComment[] }) {
  const { comment, replies, disabled, enableReplies, workspaceSlug, entityId, activityOperations, projectId } = props;
  const { t } = useTranslation();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [replyToId, setReplyToId] = useState<string>();
  const [unreadBoundary, setUnreadBoundary] = useState<string>();
  const unreadReplies = activityOperations.markCommentsRead ? replies.filter((reply) => reply.is_unread) : [];
  const firstUnreadId = unreadReplies[0]?.id;
  const readRef = useCommentRead(
    expanded,
    unreadReplies.map((reply) => reply.id),
    activityOperations.markCommentsRead
  );

  useEffect(() => {
    if (!expanded) setUnreadBoundary(undefined);
    else if (!unreadBoundary && firstUnreadId) setUnreadBoundary(firstUnreadId);
  }, [expanded, firstUnreadId, unreadBoundary]);
  const replyToComment = replyToId === comment?.id ? comment : replies.find((reply) => reply.id === replyToId);
  const targetReply = replies.find((reply) => location.hash === `#comment-${reply.id}`)?.id;

  useEffect(() => {
    if (targetReply) setExpanded(true);
  }, [targetReply, location.key]);

  if (!comment) return null;
  const onReply =
    enableReplies && !disabled && !comment.deleted_at
      ? (target: TIssueComment) => {
          setExpanded(true);
          setReplyToId(target.id);
        }
      : undefined;
  const threadId = `thread-${comment.id}`;

  return (
    <div className="min-w-0">
      <CommentCard {...props} onReply={onReply ? () => onReply(comment) : undefined} />
      {(replies.length > 0 || replyToComment) && (
        <div className="mb-3 ml-10 min-w-0">
          {replies.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={threadId}
              aria-label={`${t("issue.comments.replies.count", { count: replies.length })}${unreadReplies.length ? ` · ${t("issue.comments.replies.new_count", { count: unreadReplies.length })}` : ""}`}
              onClick={() => setExpanded((value) => !value)}
              className="flex max-w-full items-center gap-2 rounded px-1 py-1 text-left text-body-sm-medium text-secondary hover:bg-layer-1 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {expanded ? (
                <ChevronDown className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              )}
              <CommentThreadSummary replies={replies} />
              {unreadReplies.length > 0 && (
                <span className="shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-caption-sm-medium text-accent-primary">
                  {t("issue.comments.replies.new_count", { count: unreadReplies.length })}
                </span>
              )}
            </button>
          )}
          <div
            ref={readRef}
            id={threadId}
            hidden={!expanded}
            className="mt-1 min-w-0 border-l border-subtle pl-3 sm:pl-4"
          >
            {expanded &&
              replies.map((reply) => (
                <Fragment key={reply.id}>
                  {reply.id === unreadBoundary && (
                    <div
                      role="separator"
                      aria-label={t("issue.comments.replies.new_replies")}
                      className="my-3 flex items-center gap-3 text-caption-sm-medium text-accent-primary"
                    >
                      <span className="flex-1 border-t border-accent-strong" />
                      {t("issue.comments.replies.new_replies")}
                      <span className="flex-1 border-t border-accent-strong" />
                    </div>
                  )}
                  {reply.is_unread && <div data-unread-reply={reply.id} className="h-px" aria-hidden />}
                  <CommentCard
                    {...props}
                    comment={reply}
                    isReply
                    onReply={onReply ? () => onReply(reply) : undefined}
                  />
                </Fragment>
              ))}
            {replyToComment && onReply && (
              <div className="py-3">
                <CommentCreate
                  workspaceSlug={workspaceSlug}
                  entityId={entityId}
                  projectId={projectId}
                  activityOperations={activityOperations}
                  parentComment={comment}
                  replyToComment={replyToComment}
                  showToolbarInitially
                  onCancel={() => setReplyToId(undefined)}
                  onSubmitCallback={() => {
                    setReplyToId(undefined);
                    setExpanded(true);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
