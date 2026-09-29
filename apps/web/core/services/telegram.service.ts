import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TelegramPreferences = {
  enabled: boolean;
  assignments: boolean;
  mentions: boolean;
  replies: boolean;
  comments: boolean;
  watching: boolean;
  scheduled: boolean;
  timezone: string;
  weekdays_only: boolean;
  start_hour: number;
  end_hour: number;
};
export type TelegramSettings = TelegramPreferences & {
  available: boolean;
  connected: boolean;
  telegram_name: string;
  pending_name: string | null;
  pending_id: string | null;
  blocked: boolean;
  paused_until: string | null;
  next_day_pause_until: string;
  queued_count: number;
  deliveries: { id: string; created_at: string; status: string; error_code: string }[];
  mutes: { issue_id: string; name: string }[];
};

export class TelegramService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  async settings(): Promise<TelegramSettings> {
    return (await this.get("/api/users/me/telegram/")).data;
  }
  async update(data: Partial<TelegramPreferences>): Promise<TelegramSettings> {
    return (await this.patch("/api/users/me/telegram/", data)).data;
  }
  async link(): Promise<{ url: string }> {
    return (await this.post("/api/users/me/telegram/", { action: "link" })).data;
  }
  async action(action: string, data: Record<string, string> = {}): Promise<TelegramSettings> {
    return (await this.post("/api/users/me/telegram/", { action, ...data })).data;
  }
  async disconnect(): Promise<void> {
    await this.delete("/api/users/me/telegram/");
  }
}
