import { API_BASE_URL } from "@plane/constants";
import type { TWorkItemFilterExpression } from "@plane/types";
import { parseWorkItemFilters } from "@/helpers/work-item-filter-url";
import { parseWorkItemDisplaySettings, type TWorkItemDisplaySettings } from "@/helpers/work-item-display-settings";
import { APIService } from "./api.service";

export type TBoardLink = {
  token: string;
  path: string;
  filters: TWorkItemFilterExpression;
  display: TWorkItemDisplaySettings;
};
export const BOARD_LINK_QUERY_PARAM = "share";
export const boardLinkKey = (token: string) => `BOARD_LINK_${token}`;
export const isBoardLinkToken = (token: string) => /^[A-Za-z0-9_-]{12}$/.test(token);

export function validateBoardLink(data: TBoardLink): TBoardLink {
  const filters = parseWorkItemFilters(JSON.stringify(data.filters));
  const display = parseWorkItemDisplaySettings(JSON.stringify(data.display));
  if (
    !isBoardLinkToken(data.token) ||
    !/^\/[\w-]+\/projects\/[\da-f-]+\/(issues|cycles\/[\da-f-]+)\/$/i.test(data.path) ||
    !filters ||
    !display
  )
    throw new Error("Invalid board link");
  return { ...data, filters, display };
}

class BoardLinkService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  async create(
    workspace: string,
    project: string,
    data: Pick<TBoardLink, "filters" | "display"> & { cycle_id?: string }
  ): Promise<TBoardLink> {
    const response = await this.post(`/api/workspaces/${workspace}/projects/${project}/board-links/`, data);
    return validateBoardLink(response.data);
  }
  async retrieve(token: string): Promise<TBoardLink> {
    if (!isBoardLinkToken(token)) throw new Error("Invalid board link");
    const response = await this.get(`/api/board-links/${token}/`);
    return validateBoardLink(response.data);
  }
}
export const boardLinkService = new BoardLinkService();
