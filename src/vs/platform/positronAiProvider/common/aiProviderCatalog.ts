/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';

export const POSITRON_AI_PROVIDER_CHANNEL = 'positronAiProviderCatalog';

/** A catalog entry as the provider module's headless entry reports it; connection values stay node-side. */
export interface IResolvedProviderData {
	readonly id: string;
	readonly enabled: boolean;

	/** Present, and true, only for a provider from a custom providers.json entry. */
	readonly custom?: true;

	/** The resolved `connection.baseUrl`, served by `positron.ai.getProviderBaseUrl`. */
	readonly baseUrl?: string;

	/** The resolved `connection.positaiLogin.scope`, read by the one-time legacy credential copy. */
	readonly positaiLoginScope?: string;

	/**
	 * Dotted names of the connection fields whose resolved value differs from
	 * ai-config's built-in default for this provider, e.g. 'baseUrl' or
	 * 'aws.profile'. Omitted when nothing differs, so a stock install reports none.
	 */
	readonly customizedConnection?: readonly string[];
}

/** A catalog change as the headless entry reports it. */
export interface IProviderCatalogChangeData {
	readonly catalog: readonly IResolvedProviderData[];
	readonly enabledChanged: boolean;
	readonly connectionChanged: boolean;
	readonly modelsChanged: boolean;
}

/** Node-side catalog surface, reachable over POSITRON_AI_PROVIDER_CHANNEL. */
export interface IAiProviderCatalog {
	readonly onDidChangeCatalog: Event<IProviderCatalogChangeData>;
	getCatalog(): Promise<readonly IResolvedProviderData[]>;
	/** The providers.json location as a URI, built on the node host that owns the path. */
	getConfigFileUri(): Promise<URI>;
}
