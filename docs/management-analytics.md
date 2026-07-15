# Management Analytics

Management Analytics extends the existing workspace Analytics area with CTO-oriented operational metrics. It reuses Plane workspace, project, member, issue, state, cycle, module, estimate, blocker, comment, and `IssueActivity` data. Production components must not use mock data.

## Architecture

- Backend endpoints live under `/api/workspaces/<slug>/management-analytics/`.
- `ManagementAnalyticsService` owns formulas, filtering, risk scoring, data quality checks, and CSV export.
- `ManagementAnalyticsSettings` stores workspace-specific thresholds and capacity settings.
- Frontend tabs live in the existing `/:workspaceSlug/analytics/:tabId` route.
- Управленческая аналитика, её настройки и CSV-экспорт доступны только роли `OG`.
- Обычные сотрудники получают только два личных drilldown-среза для страницы «Сегодня»: собственные активные и заблокированные задачи.

## Endpoints

- `GET /management-analytics/overview/`
- `GET /management-analytics/team/`
- `GET /management-analytics/projects/`
- `GET /management-analytics/workload/`
- `GET /management-analytics/delivery/`
- `GET /management-analytics/risks/`
- `GET /management-analytics/data-quality/`
- `GET/PATCH /management-analytics-settings/`
- `GET /management-analytics/<section>/export/`

All section endpoints accept shared query parameters: `period`, `start_date`, `end_date`, `project_ids`, `member_ids`, `assignee_ids`, `state_ids`, `priorities`, `label_ids`, `module_ids`, `cycle_ids`, and `planned`.

Пользовательский период ограничен 366 днями. Неизвестные периоды, метрики, разделы и некорректные даты возвращают HTTP 400. Настройки принимают только известную схему и безопасные диапазоны значений. CSV-экспорт экранирует значения, которые Excel может интерпретировать как формулы.

## Formulas

- Workload percentage: planned estimate in the selected period / available capacity x 100.
- On-time delivery: completed work items on or before target date / completed work items with target date x 100.
- Project progress: completed estimate / total estimate. If estimates are unavailable, progress falls back to completed count / total count and the response marks the method as `count`.
- Risk score: weighted sum of overdue ratio, blocked work, missing estimates, stale project activity, and bus factor.
- Data Quality Score: 100 minus weighted violation density across configured data quality checks.

## Historical Data

Delivery metrics use `IssueActivity` for state transitions. If activities are missing, the API returns `history.status = "partial"` and avoids inventing first-started or initial-estimate values. Current implementation does not backfill initial estimates or blocked intervals from old data.

## Settings

Settings are stored per workspace:

- estimation unit;
- weekly capacity defaults and member overrides;
- utilization thresholds;
- stale work and WIP age thresholds;
- review/testing state groups;
- risk weights and thresholds;
- required issue fields;
- unplanned work classification rules.

## Adding A Metric

1. Add the formula to `ManagementAnalyticsService`.
2. Include source-data and insufficient-data behavior in this document.
3. Add an i18n label and formula tooltip.
4. Add a backend unit test for the formula.
5. Render it through the existing KPI/table components.
