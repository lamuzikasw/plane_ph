import { useLocation } from "react-router";
import useSWR from "swr";
import {
  BOARD_LINK_QUERY_PARAM,
  boardLinkKey,
  boardLinkService,
  isBoardLinkToken,
} from "@/services/board-link.service";

export function useSharedBoardLink() {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get(BOARD_LINK_QUERY_PARAM);
  const validToken = token && isBoardLinkToken(token);
  const { data, error, isLoading, mutate } = useSWR(
    validToken ? boardLinkKey(token) : null,
    () => boardLinkService.retrieve(token!),
    { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false }
  );
  const wrongBoard = data && data.path.replace(/\/$/, "") !== location.pathname.replace(/\/$/, "");
  return {
    link: token && !wrongBoard ? data : undefined,
    ready: !token || (!!data && !wrongBoard && !error),
    error: !!token && (!validToken || !!error || !!wrongBoard),
    isLoading,
    retry: () => void mutate(),
  };
}
