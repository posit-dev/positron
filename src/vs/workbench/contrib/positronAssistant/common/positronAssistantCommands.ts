/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command (owned by the Posit Assistant extension) that opens provider
 * configuration. This is the Assistant's canonical entry point: it owns the
 * routing decision, so callers do not choose a surface.
 */
export const CONFIGURE_PROVIDERS_COMMAND = 'posit-assistant.configureProviders';

/**
 * Positron's command for opening provider configuration: runs
 * {@link CONFIGURE_PROVIDERS_COMMAND}, or tells the user how to get Posit
 * Assistant when it's turned off or not installed.
 */
export const CONFIGURE_PROVIDERS_ACTION_ID = 'workbench.action.positronAssistant.configureProvidersFromAccounts';
