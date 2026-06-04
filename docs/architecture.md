# Architecture

`ai-command-bus` separates communication from execution.

## Queues

- `task_queue`: incoming work items waiting for routing
- `dispatch`: low-risk tasks ready for a worker lane
- `submissions`: worker outputs waiting for review
- `review_queue`: items a maintainer should inspect
- `decision_queue`: high-risk or external side-effect tasks requiring human approval

## Work Item Fields

Recommended fields:

- `id`: stable task identifier
- `title`: short task name
- `status`: `ready`, `blocked`, `review`, or `done`
- `risk`: `low`, `medium`, `high`, or `critical`
- `target`: worker lane such as `codex`, `research`, `editorial`, or `ops`
- `requiresHumanApproval`: explicit approval gate

## Approval Gate

The router moves high-risk work to `decision_queue`. This prevents agent workers from silently performing external actions.

Examples that should require approval:

- publish
- delete
- buy or pay
- refund
- send a customer-facing message
- change account or security settings

## Intended Maintainer Workflow

```text
issue/webhook/chat input
  -> normalize work item
  -> route task
  -> worker drafts or tests
  -> maintainer review
  -> release or close
```
