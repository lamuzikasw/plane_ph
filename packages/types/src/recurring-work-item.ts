/** Community recurring work item schedule. */
export type TRecurringFrequency = "daily" | "weekly";

export type TRecurringWorkItem = {
  id: string;
  source_issue_id: string;
  source_issue_name: string;
  source_issue_sequence_id: number;
  project_identifier: string;
  frequency: TRecurringFrequency;
  interval: number;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  run_time: string;
  timezone: string;
  due_offset_days: number;
  due_time: string;
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string;
  occurrence_count: number;
  created_at: string;
  updated_at: string;
};

export type TRecurringWorkItemPayload = Pick<
  TRecurringWorkItem,
  | "source_issue_id"
  | "frequency"
  | "interval"
  | "weekdays"
  | "start_date"
  | "end_date"
  | "run_time"
  | "due_offset_days"
  | "due_time"
  | "is_active"
>;
