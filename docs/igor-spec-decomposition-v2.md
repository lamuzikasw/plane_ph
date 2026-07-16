# Igor specification decomposition v2

Status: deployed and verified  
Date: 2026-07-16  
Scope: audit, structured contract, and the implemented `technical_spec` map/reduce pipeline.

## Release validation

- 237 backend Igor tests pass, including 85 specification-capture tests;
- 40 frontend Igor tests pass;
- short specifications, large batched documents, contradictions, typos, duplicate requirements, prompt injection, malformed LLM output, retries, and an unavailable LLM are covered by regression tests;
- the production Structured Outputs pipeline passed a read-only anonymized smoke test: 16 source units, four deliverable tasks, no uncovered source IDs, no invented dates, and `quality_status=passed`;
- the production smoke exposed and fixed three additional failure modes: headings represented only as document metadata, headings omitted by the model, and unsupported priority/date/assignment hints;
- the supplied email and B2B scenarios are represented by local regression fixtures; their private source text was not sent to an external model by the automated smoke test;
- deployment updates only `api`, `worker`, and `web`; PostgreSQL, Redis, and RabbitMQ are not restarted.

## Implementation status

The `technical_spec` path now uses this contract end to end:

- headings, section paths, paragraph boundaries, and source offsets are preserved;
- semantic-map batches extract facts and do not create tasks;
- one global LLM reduce groups requirements into deliverable tasks;
- semantic map, global reduce, and the independent quality review use strict JSON Schema Structured Outputs;
- every proposed task includes a goal, description, source-backed acceptance criteria, and traceable source IDs;
- an independent semantic quality gate rejects coverage gaps, duplicated deliverables, sentence fragments, unsupported claims, and invented fields;
- deterministic validation repeats the critical duplicate, fragment, traceability, and completeness checks without trusting the LLM auditor;
- constraints, out-of-scope statements, open questions, and contradictions are shown separately in the review;
- the backend rejects malformed IDs, unknown source references, dangling dependencies, missing quality fields, and more than 25 tasks;
- the review exposes a source lineage for every proposed task and lets the user edit its description, acceptance criteria, and open questions;
- the user may create one editable parent work package and link all selected tasks as its children;
- a failed LLM analysis returns a retriable error instead of heuristic tasks;
- large specifications use the existing durable background job with map batching followed by a global reduce.

Meeting-note parsing remains on the existing path for backward compatibility and can be migrated separately.

## Goal

Igor must understand a technical specification as one coherent document and propose a small set of independently deliverable work items. Context, existing behavior, business rules, error cases, acceptance criteria, and out-of-scope statements must enrich tasks instead of becoming separate tasks.

The LLM is responsible for semantic understanding. Deterministic backend code remains responsible for permissions, validation, traceability, idempotent creation, and rejecting malformed or invented output.

## Current request path

1. `IgorChatEndpoint.post` detects a capture request.
2. `_extract_capture_source` removes the user command.
3. `_capture_spec_units` preserves headings, section paths, source text, and character offsets.
4. `_capture_batches` creates bounded semantic-map batches.
5. `_get_llm_spec_map_strict` extracts source-backed facts, constraints, questions, and contradictions with a strict JSON Schema.
6. `_normalize_spec_maps` rejects a map if any source unit was silently lost.
7. `_get_llm_spec_reduce_strict` synthesizes one global work package and a bounded set of deliverable tasks with a strict JSON Schema.
8. `_get_llm_spec_quality_report_strict` performs an independent semantic audit; deterministic validation verifies its references and repeats critical checks.
9. `_sanitize_spec_decomposition` builds the review model, including source lineage and the parent work package.
10. The frontend lets the user review and edit the parent and child tasks, questions, criteria, projects, assignees, dates, and priorities.
11. The create endpoint revalidates all edits and creates the selected hierarchy atomically and idempotently.

Relevant files:

- `apps/api/plane/app/views/external/igor_capture.py`
- `apps/api/plane/bgtasks/igor_capture_task.py`
- `apps/api/plane/app/views/external/base.py`
- `apps/web/core/services/ai.service.ts`
- `apps/web/core/components/ai/igor-chat.tsx`
- `apps/api/plane/tests/unit/views/test_igor_capture.py`

## Audit findings

### P0 — the backend enforces one task per action-like sentence

The prompt says `Для каждого action создай задачу`. The sanitizer then recreates a standalone task for every uncovered action. This guarantee is suitable for short meeting action items but incorrect for a technical specification, where multiple requirements describe one deliverable.

For the email-ping specification, sending three letters, checking the Bitrix24 stage, stopping the chain, preventing duplicates, and logging are requirements of several coherent work items. They are not dozens of unrelated tasks.

### P0 — batches have no global synthesis step

Every batch produces final tasks independently. The results are concatenated and only compared by title similarity. A batch does not know the complete objective, all constraints, or tasks proposed by other batches.

Consequences:

- repeated tasks across adjacent sections;
- context in one batch cannot explain a task in another;
- acceptance criteria become tasks;
- section-level requirements are fragmented;
- overlap produces duplicated classifications and task candidates.

Large specifications need a map/reduce flow: extract facts per semantic section first, then synthesize one global work breakdown from all extracted facts.

### P0 — meeting notes and technical specifications share one ontology

The current categories are `action`, `decision`, `risk`, `question`, `context`, and `unclassified`. They do not represent important specification concepts:

- document objective;
- existing behavior;
- functional requirement;
- business rule;
- error case;
- invariant;
- acceptance criterion;
- in-scope and out-of-scope constraints;
- contradiction.

The document type must be detected first. Meeting notes may produce action items. A technical specification must produce requirements that are subsequently grouped into deliverables.

### P0 — degraded parsing is silent

If the LLM key is absent, the synchronous path returns a heuristic plan as if it were an AI result. If a synchronous LLM call raises an exception, `_get_llm_capture_plan` also silently returns that heuristic plan.

The heuristic searches broad verb fragments and converts matching sentences into tasks with empty goals and acceptance criteria. This closely matches the broken review shown by the user.

The production key is configured, but the timeout is 8 seconds and capture failures are not observable at the configured production log level. A timeout can therefore silently downgrade a synchronous request.

Target behavior: never present heuristic tasks as an AI decomposition. Preserve the draft and return a retriable `analysis_unavailable` state.

### P0 — semantic classification can be overridden by heuristics

When the LLM classifies a unit as `context` or `unclassified`, `_sanitize_capture_plan` can change it back to `action` using `_is_explicit_capture_action`. This makes deterministic keyword matching more authoritative than the semantic model.

Target behavior: deterministic validation may reject an invalid classification but must not convert context into a task. Uncertain items belong in `needs_review`.

### P1 — the coverage metric is misleading

`covered_count` counts every unit placed in any category, including `unclassified`. Because the sanitizer always assigns a category, the UI can display `Все пункты учтены` even when the work breakdown is unusable.

Coverage must mean that each source unit is deliberately linked to one or more of:

- document objective or context;
- an existing-behavior statement;
- a proposed task;
- a constraint;
- an open question;
- a contradiction;
- an explicit ignored/metadata classification.

### P1 — observability cannot explain a degraded result

`_log_safe_failure` emits warnings, while the production `plane.exception` logger is configured at `ERROR`. The relevant warning is discarded. The response also does not contain an analysis mode, schema version, trace ID, prompt version, or quality diagnostics.

Target telemetry must record only safe metadata:

- trace ID;
- schema and prompt version;
- model name;
- number of source characters, sections, and extracted facts;
- stage latency and token usage;
- retry and failure category;
- validation error codes.

Source text, API keys, environment values, and model responses must not be written to logs.

### P1 — source units are too syntactic

The current splitter removes headings and splits long lines by punctuation and conjunctions before semantic analysis. This destroys relationships between an objective, its workflow, and its acceptance criteria.

Target behavior: preserve the original document, headings, ordered lists, paragraph boundaries, and character ranges. Semantic chunks should be created by complete sections with controlled overlap, not by treating every line as a candidate task.

### P1 — task limits optimize for completeness instead of usability

The task limit equals the source-unit limit of 1,200. A review containing hundreds of tasks is technically complete but operationally unusable.

The target review should normally contain 3–15 tasks. More than 25 proposed tasks requires another hierarchy level or a visible warning that the document contains multiple independent projects.

## Target processing pipeline

### 1. Normalize without losing structure

Create stable source IDs for headings and paragraphs. Preserve:

- document title;
- section path;
- list nesting;
- original text;
- start and end character offsets;
- explicit owner, date, project, or priority hints.

### 2. Detect document type

Supported values:

- `technical_spec`;
- `meeting_notes`;
- `project_brief`;
- `incident_report`;
- `mixed`;
- `unknown`.

Technical specifications and meeting notes must use different decomposition instructions.

### 3. Semantic map

For each complete section, the LLM extracts source-backed facts. It does not create final tasks at this stage. Every extracted fact references source IDs and uses one of the defined fact kinds.

### 4. Global reduce

A second LLM pass receives the document objective plus compact extracted facts from every section. It groups requirements into independently deliverable tasks, produces descriptions and acceptance criteria, detects dependencies, and lists unresolved questions.

For very large inputs, intermediate reducers merge related sections before the final reducer. Final task synthesis always has a global view.

### 5. Strict structured contract

The semantic-map, global-reduce, and quality-audit stages use OpenAI-compatible `json_schema` response formats with `strict: true` and `additionalProperties: false`. This prevents malformed or shape-shifting model output from entering the application contract. It does not replace semantic quality validation.

### 6. Deterministic validation

Backend validation must enforce:

- strict schema and no unknown fields;
- references only to existing source, task, and question IDs;
- unique IDs and titles;
- no task without a source-backed deliverable;
- no invented project, assignee, deadline, or priority;
- no dangling dependencies;
- no source coverage gaps hidden from the user;
- safe limits for titles, descriptions, lists, and task count.

### 7. Quality gate

If the result fails validation, Igor retries the failed semantic stage with validation errors. If it still fails, the UI shows a retriable failure and never substitutes heuristic tasks.

The quality gate has two independent layers:

- an LLM auditor compares every source unit with the proposed work breakdown and reports coverage, duplicates, fragments, unsupported claims, and invented fields;
- deterministic code validates the audit itself and checks title similarity, sentence fragments, required descriptions, source references, deadlines, projects, assignees, and priorities.

### 8. Human confirmation

The existing confirmation, permission, project-membership, and idempotent-creation guards remain authoritative. The LLM only proposes a draft. The review uses a work-package hierarchy instead of a flat wall of cards:

- one optional editable parent task describes the business result;
- each child task contains an editable goal, implementation description, acceptance criteria, and open questions;
- each child exposes links back to the exact source sections used to derive it;
- clicking a source link scrolls to the preserved source item in the review;
- selected tasks are created only after projects and other required fields are validated again by the API.

## Versioned result contract

The LLM output contract is `igor.spec_decomposition.v2`. All fields are required in the structured schema; unknown values use `null` or an empty array instead of omitted fields. Unknown fields are rejected. Source IDs in the example below are illustrative; production IDs come from the preserved source map.

```json
{
  "schema_version": "igor.spec_decomposition.v2",
  "document": {
    "type": "technical_spec",
    "title": "Email-пинги клиентов по стадиям Пинг 1 / Пинг 2",
    "goal": "Возвращать к оформлению заявки клиентов, которые перестали отвечать.",
    "summary": "Добавить параллельную email-цепочку, не изменяя существующие сообщения в чате ЛК.",
    "source_ids": ["S1", "S2"]
  },
  "facts": [
    {
      "id": "F1",
      "kind": "functional_requirement",
      "text": "Первое письмо отправляется сразу после попадания сделки в Пинг 1 или Пинг 2.",
      "source_ids": ["S24", "S25"]
    }
  ],
  "work_package": {
    "title": "Email-пинги клиентов",
    "goal": "Вернуть клиента к незавершённой заявке с помощью контролируемой email-цепочки.",
    "description": "Родительский результат для реализации, проверки и безопасного запуска цепочки.",
    "source_ids": ["S1", "S2", "S18", "S24"]
  },
  "tasks": [
    {
      "id": "T1",
      "kind": "implementation",
      "title": "Реализовать состояние и запуск email-цепочки",
      "goal": "Запускать одну управляемую цепочку на каждое попадание сделки в пинг и исключить дубли писем.",
      "description": "Создавать экземпляр цепочки для Пинг 1 и Пинг 2, хранить состояние отправки и разрешать новый запуск после повторного попадания сделки в пинг.",
      "acceptance_criteria": [
        {
          "text": "В рамках одного запуска каждое из трёх писем отправляется не более одного раза.",
          "source_ids": ["S61", "S62", "S63"]
        }
      ],
      "fact_ids": ["F1"],
      "source_ids": ["S18", "S24", "S61", "S62", "S63"],
      "dependency_task_ids": [],
      "open_question_ids": ["Q1"],
      "project_hint": null,
      "assignee_hint": null,
      "target_date": null,
      "priority": "none",
      "confidence": "high"
    }
  ],
  "constraints": [
    {
      "id": "C1",
      "kind": "invariant",
      "text": "Текущая логика сообщений в чат ЛК продолжает работать без изменений.",
      "source_ids": ["S4"]
    },
    {
      "id": "C2",
      "kind": "out_of_scope",
      "text": "Автоматическое применение скидки не входит в задачу.",
      "source_ids": ["S45"]
    }
  ],
  "open_questions": [
    {
      "id": "Q1",
      "question": "Переход между Пинг 1 и Пинг 2 продолжает текущую цепочку или запускает новую?",
      "reason": "От этого зависит ключ идемпотентности и повторный запуск.",
      "blocking": true,
      "source_ids": ["S58", "S59"],
      "related_task_ids": ["T1"]
    }
  ],
  "contradictions": [
    {
      "id": "X1",
      "description": "В полной схеме одновременно упомянуты интервалы 3 и 5 часов.",
      "source_ids": ["S33"],
      "related_task_ids": ["T2"]
    }
  ],
  "source_coverage": [
    {
      "source_id": "S1",
      "classification": "objective",
      "fact_ids": [],
      "task_ids": [],
      "constraint_ids": [],
      "question_ids": [],
      "contradiction_ids": []
    }
  ]
}
```

### Fact kinds

- `objective`
- `context`
- `existing_behavior`
- `functional_requirement`
- `non_functional_requirement`
- `business_rule`
- `error_case`
- `acceptance_criterion`
- `decision`
- `risk`
- `metadata`

### Constraint kinds

- `in_scope`
- `out_of_scope`
- `invariant`
- `prohibition`

### Task kinds

- `implementation`
- `integration`
- `content`
- `testing`
- `migration`
- `observability`
- `research`

## Backend-computed quality metadata

Quality metadata is calculated after schema validation and is not trusted from the LLM:

```json
{
  "analysis": {
    "trace_id": "opaque-id",
    "mode": "llm",
    "schema_version": "igor.spec_decomposition.v2",
    "prompt_version": "spec-v2.1",
    "source_count": 148,
    "linked_source_count": 148,
    "unresolved_source_ids": [],
    "task_count": 6,
    "validation_warnings": [],
    "requires_human_review": true
  }
}
```

The frontend must never claim that all points are covered solely because every source received a category.

## Expected decomposition of the email-ping specification

One parent work package and approximately six tasks:

1. Implement chain state, triggering, idempotency, and repeat entry.
2. Implement scheduling and Bitrix24 status/payment checks.
3. Configure SMTP, three templates, variables, and cabinet links.
4. Implement the final transition to `Перестал выходить на связь`.
5. Add error handling and safe operational logging.
6. Add integration and regression tests, including unchanged chat behavior.

Open questions must include at least:

- the conflicting 3/5-hour sentence;
- retry policy after an SMTP failure;
- whether moving from `Пинг 1` to `Пинг 2` restarts the chain;
- ownership and storage of final templates;
- third-email behavior before the discount is defined.

Out-of-scope statements, current behavior, and the acceptance criteria from section 19 must be linked to the relevant tasks and constraints, not proposed as standalone tasks.

## Migration plan for the next stage

1. Introduce typed backend models for `igor.spec_decomposition.v2`.
2. Separate `technical_spec` and `meeting_notes` prompts.
3. Replace independent task-producing batches with semantic map plus global reduce.
4. Remove silent heuristic task generation.
5. Add validator error codes and safe analysis metadata.
6. Adapt the existing review widget to work packages, constraints, contradictions, and global questions.
7. Add golden tests using the email-ping and B2B specifications.

No production behavior should switch to v2 until golden tests demonstrate stable grouping, complete source traceability, no invented fields, and safe failure when the LLM is unavailable.
