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
 * Chooses which dialog the Configure Providers command opens. On, it opens the
 * Configure LLM Providers modal. Off, it opens the older Configure Language
 * Model Providers dialog.
 *
 * Defaults to on. The older dialog stays available as a way back: if something
 * in the current modal does not work for a user, they can turn this off and
 * carry on.
 */
export const NEW_PROVIDER_MODAL_KEY = 'assistant.newProviderModal';
