# Task Center Module

The task foundation creates and tracks asynchronous work items.

Current implementation:

- `src/tasks.js`
- in-memory task center
- queued and updated task status
- owner-checked task reads
- persisted PPT generation task reads through `GET /api/ppt/tasks/{task_id}`

Future work:

- queue backend
- worker processes
- retry and dead-letter handling
- detailed progress event streams
