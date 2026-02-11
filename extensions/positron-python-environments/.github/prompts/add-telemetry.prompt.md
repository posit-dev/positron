---
mode: agent
---

If the user does not specify an event name or properties, pick an informative and descriptive name for the telemetry event based on the task or feature. Add properties as you see fit to collect the necessary information to achieve the telemetry goal, ensuring they are relevant and useful for diagnostics or analytics.

When adding telemetry:

-   If the user wants to record when an action is started (such as a command invocation), place the telemetry call at the start of the handler or function.
-   If the user wants to record successful completions or outcomes, place the telemetry call at the end of the action, after the operation has succeeded (and optionally, record errors or failures as well).

Instructions to add a new telemetry event:

1. Add a new event name to the `EventNames` enum in `src/common/telemetry/constants.ts`.
2. Add a corresponding entry to the `IEventNamePropertyMapping` interface in the same file, including a GDPR comment and the expected properties.
3. In the relevant code location, call `sendTelemetryEvent` with the new event name and required properties. Example:
    ```typescript
    sendTelemetryEvent(EventNames.YOUR_EVENT_NAME, undefined, { property: value });
    ```
4. If the event is triggered by a command, ensure the call is placed at the start of the command handler.

Expected output: The new event is tracked in telemetry and follows the GDPR and codebase conventions.
