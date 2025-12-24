/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider mapping tables.
 * These are populated during extension activation by calling configureProvider()
 * for each available language model provider.
 */
const displayNameToId = new Map<string, string>();
const idToDisplayName = new Map<string, string>();

/**
 * Configures a provider's ID and display name in the mappings.
 * This should be called during extension initialization for all available providers.
 *
 * @param providerId - The internal provider ID (e.g., "anthropic-api")
 * @param displayName - The display name (e.g., "Anthropic")
 */
export function configureProvider(providerId: string, displayName: string): void {
	displayNameToId.set(displayName, providerId);
	idToDisplayName.set(providerId, displayName);
}

/**
 * Maps a UI display name to its internal provider ID.
 *
 * @param displayName - UI display name (e.g., "Anthropic", "GitHub Copilot")
 * @returns Internal provider ID, or undefined if not found (e.g., "anthropic-api", "copilot")
 */
export function uiNameToProviderId(displayName: string): string | undefined {
	return displayNameToId.get(displayName);
}

/**
 * Maps an internal provider ID to its UI display name.
 *
 * @param providerId - Internal provider ID (e.g., "anthropic-api", "copilot")
 * @returns UI display name, or undefined if not found (e.g., "Anthropic", "GitHub Copilot")
 */
export function providerIdToUiName(providerId: string): string | undefined {
	return idToDisplayName.get(providerId);
}
