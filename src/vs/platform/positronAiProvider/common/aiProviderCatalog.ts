/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';

export const POSITRON_AI_PROVIDER_CHANNEL = 'positronAiProviderCatalog';

/**
 * Mirrors ai-config's ResolvedConnection as plain IPC-marshalable data,
 * hand-kept in sync with the pinned ai-lib commit (guarded by the shape-guard
 * test). A deliberate reduced view: fields no consumer reads are omitted.
 */
export interface IResolvedConnectionData {
	readonly baseUrl?: string;
	readonly endpoint?: string;
	readonly customHeaders?: Record<string, string>;
	readonly aws?: { readonly region?: string; readonly profile?: string };
	readonly googleCloud?: { readonly project?: string; readonly location?: string };
	readonly snowflake?: { readonly account?: string; readonly host?: string; readonly home?: string };
}

/** Mirrors ai-config's ResolvedProvider (id, enabled, connection). */
export interface IResolvedProviderData {
	readonly id: string;
	readonly enabled: boolean;
	readonly connection: IResolvedConnectionData;
}

/** Mirrors ai-config's ProviderCatalogChange. */
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
