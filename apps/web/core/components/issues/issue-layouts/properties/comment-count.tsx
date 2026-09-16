import { MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";

export function IssueCommentCount({
  count,
  isMobile = false,
  onClick,
}: {
  count?: number;
  isMobile?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  if (!count || count < 0) return null;
  const label = `${t("common.comments")}: ${count}`;

  return (
    <Tooltip tooltipContent={label} isMobile={isMobile} renderByDefault={false}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={label}
        className="focus-visible:outline-primary flex h-5 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm border-[0.5px] border-strong px-2 text-secondary hover:bg-layer-1 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <MessageSquare className="h-3 w-3 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
        <span className="text-caption-sm-regular tabular-nums">{count}</span>
      </button>
    </Tooltip>
  );
}
