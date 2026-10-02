import { useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { observer } from "mobx-react";
import { Link } from "lucide-react";
import { useSWRConfig } from "swr";
import { Button } from "@plane/propel/button";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type { IIssueFilters } from "@plane/types";
import { copyUrlToClipboard } from "@plane/utils";
import { getWorkItemDisplaySettings } from "@/helpers/work-item-display-settings";
import { useSharedBoardLink } from "@/hooks/work-item-filters/use-shared-board-link";
import { boardLinkKey, boardLinkService } from "@/services/board-link.service";

export const CopyBoardLink = observer(function CopyBoardLink({ filters }: { filters: IIssueFilters | undefined }) {
  const { workspaceSlug, projectId, cycleId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const shared = useSharedBoardLink();
  const [busy, setBusy] = useState(false);
  const latest = useRef("");
  const snapshot = JSON.stringify({
    filters: filters?.richFilters ?? {},
    display: getWorkItemDisplaySettings(filters),
    cycle_id: cycleId,
  });
  latest.current = location.key + snapshot;
  const copy = async () => {
    if (!workspaceSlug || !projectId || !filters || busy || !shared.ready) return;
    const started = latest.current;
    setBusy(true);
    try {
      const link = await boardLinkService.create(workspaceSlug, projectId, JSON.parse(snapshot));
      await mutate(boardLinkKey(link.token), link, { revalidate: false });
      await copyUrlToClipboard(`s/${link.token}`);
      // Do not navigate back or overwrite newer edits if the request completed late.
      if (latest.current === started) {
        const params = new URLSearchParams(location.search);
        for (const key of ["filters", "display", "layout"]) params.delete(key);
        params.set("share", link.token);
        void navigate(
          { pathname: location.pathname, search: `?${params}`, hash: location.hash },
          { replace: true, preventScrollReset: true, state: location.state }
        );
      }
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Ссылка скопирована",
        message: "Фильтры и отображение доски сохранены в короткой ссылке.",
      });
    } catch (error) {
      console.error("Unable to copy board link", error);
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось скопировать ссылку", message: "Попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="secondary"
      size="lg"
      disabled={busy || !filters || !shared.ready}
      onClick={() => void copy()}
      aria-label="Копировать ссылку на доску с фильтрами"
    >
      <Link className="size-3.5" />
      <span className="hidden @4xl:inline">{busy ? "Создаём ссылку…" : "Копировать ссылку"}</span>
    </Button>
  );
});
