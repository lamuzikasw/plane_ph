import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueComment } from "@plane/types";
import { Avatar, AvatarGroup } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";
import { getThreadReplyTime } from "@/helpers/comment-threads";

export const CommentThreadSummary = observer(function CommentThreadSummary({ replies }: { replies: TIssueComment[] }) {
  const { t, currentLocale } = useTranslation();
  const { getUserDetails } = useMember();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const participants = [...new Map(replies.map((reply) => [reply.actor, reply])).values()];
  const latest = replies.reduce<TIssueComment | undefined>(
    (last, reply) => (!last || Date.parse(reply.created_at) > Date.parse(last.created_at) ? reply : last),
    undefined
  );
  const timestamp = latest ? Date.parse(latest.created_at) : NaN;

  return (
    <>
      <span className="shrink-0" aria-hidden>
        <AvatarGroup max={2} size="sm" showTooltip={false}>
          {participants.map((reply) => {
            const author = getUserDetails(reply.actor) ?? reply.actor_detail;
            const name = reply.actor_detail?.is_bot
              ? `${reply.actor_detail.first_name}Bot`
              : author?.display_name || author?.first_name || t("common.unknown_user");
            return <Avatar key={reply.actor} name={name} src={getFileURL(author?.avatar_url)} />;
          })}
        </AvatarGroup>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1">
        <span className="whitespace-nowrap text-accent-primary">
          {t("issue.comments.replies.count", { count: replies.length })}
        </span>
        {Number.isFinite(timestamp) && (
          <>
            <span aria-hidden className="text-tertiary">
              ·
            </span>
            <time
              dateTime={latest!.created_at}
              title={new Date(timestamp).toLocaleString(currentLocale)}
              className="text-body-sm-regular whitespace-nowrap text-tertiary"
            >
              {getThreadReplyTime(timestamp, now, currentLocale)}
            </time>
          </>
        )}
      </span>
    </>
  );
});
