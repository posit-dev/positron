# Positron Coding Agents

This extension integrates third-party coding agents with Positron. Each agent
is registered with `positron.ai.registerErrorActionHandler` (proposed API
`positronErrorActions`), so the user can choose it in the
`ai.errorActions.agent` setting and send errors to it with Fix and Explain.

## Activation

The extension activates on two events, for different reasons:

- **`onAiEnabled`**, declared in `package.json`. The setting lists only agents
  that have registered, and an agent registers only while it's installed,
  which takes running code to find out (e.g. looking for a command on the
  PATH). So the extension has to activate before anyone clicks, or the user
  could never choose its agents. `onAiEnabled` is the cheapest point for that:
  it fires only while `ai.enabled` is on, and late in startup.
- **`onErrorActionHandler:<id>`**, generated from each agent declared in
  `contributes.errorActionHandlers`. A chosen agent's buttons show before
  `onAiEnabled` fires, so a click in that window activates this extension and
  waits for the agent to register, rather than saying it isn't available.

Activating only on the second event would be lazier, but the setting would
never list the agents. Listing every declared agent instead, installed or not,
would let the first event go, at the cost of offering agents the user doesn't
have.
