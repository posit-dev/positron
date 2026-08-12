/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
 *
 * This module is deliberately free of imports and side effects so processes
 * without a Settings UI - notably the extension host - can read the key without
 * pulling in the configuration registry or re-registering the `ai` node. The
 * registration itself lives in `positronAIConfiguration.ts`.
 */
export const AI_ENABLED_KEY = 'ai.enabled';
