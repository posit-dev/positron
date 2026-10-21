/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Setting keys for Positron-owned AI configuration.
 *
 * This module is deliberately free of imports and side effects so processes
 * without a Settings UI - notably the extension host - can read a key without
 * pulling in the configuration registry or re-registering the `ai` node. The
 * registrations themselves live in `positronAIConfiguration.ts`.
 */

/**
 * Main switch for Positron's AI features. When off, all of Positron's AI
 * features (Next Edit Suggestions, notebook AI, console Fix/Explain, etc.) are
 * turned off.
 *
 * Owned by Positron. It sits above the Posit Assistant extension's
 * `assistant.enabled` (which controls the chat UI): Posit Assistant also reads
 * `ai.enabled`, so when it's off the assistant is off regardless of
 * `assistant.enabled`. This setting seeds the `ai.*` namespace for
 * Positron-owned AI configuration.
 */
export const AI_ENABLED_KEY = 'ai.enabled';

/**
 * The id of the error action handler that console, notebook, and Quarto errors are sent
 * to when the user presses Fix or Explain, e.g. `'posit-assistant'` or
 * `'claude-code'`. Restricted, so an untrusted workspace can't choose one.
 * Its list of choices is the registered error action handlers, kept current by the
 * error action handler service.
 */
export const ERROR_ACTIONS_AGENT_KEY = 'ai.errorActions.agent';

/** The error action handler id of Posit Assistant, reserved for Positron. */
export const POSIT_ASSISTANT_ERROR_ACTION_HANDLER_ID = 'posit-assistant';

/**
 * The id of the default error action handler, the one users get without choosing
 * it: Posit Assistant.
 */
export const DEFAULT_ERROR_ACTION_HANDLER_ID = POSIT_ASSISTANT_ERROR_ACTION_HANDLER_ID;

/**
 * Whether this window offers its live sessions and its agent-compatible
 * commands to external coding agents (Claude Code, Codex, any MCP client)
 * through the kernel supervisor's Model Context Protocol server.
 *
 * Read by the `positron-supervisor` extension, which registers the window with
 * the supervisor and publishes the endpoint into integrated terminals. Sits
 * under {@link AI_ENABLED_KEY}: the server runs only when both are on.
 */
export const MCP_ENABLED_KEY = 'ai.mcp.enabled';

/**
 * Whether the status bar shows the coding agents connected to this window's
 * sessions. Off by default; the agents are always listed in the kernel
 * supervisor's Quick Pick.
 */
export const MCP_STATUS_BAR_KEY = 'ai.mcp.statusBar';

/**
 * Whether AI agents can work in console sessions of their own. Gates only the
 * ways to start one: the Start Agent Console Session command here, while an
 * agent is expected to read it before starting a session of its own. Existing
 * agent sessions are recorded and shown as such either way. The command also
 * requires {@link AI_ENABLED_KEY}.
 */
export const AGENT_SESSIONS_ENABLED_KEY = 'ai.agentSessions.enabled';
