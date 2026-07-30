/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProviderCatalogChangeData, IResolvedProviderData } from '../../../../platform/positronAiProvider/common/aiProviderCatalog.js';

export const IAiProviderService = createDecorator<IAiProviderService>('aiProviderService');

/**
 * The lifecycle of the service's cached catalog snapshot: `initializing` before
 * the first fetch attempt completes, `ready` once a snapshot exists, `error`
 * when the first fetch failed (a later change event can recover to `ready`).
 */
export type AiProviderServiceStatus = 'initializing' | 'ready' | 'error';

/**
 * A warmed, synchronous view of the node-side AI provider catalog. The service
 * mirrors the catalog over the provider-catalog channel into a snapshot that
 * consumers can read synchronously, and fires {@link onDidChangeProviders} when
 * the snapshot is refreshed. Providers, their enabled state, and their resolved
 * connection details all come from the node catalog; this service owns only the
 * renderer-side cache and change notification.
 */
export interface IAiProviderService {
	readonly _serviceBrand: undefined;
	/** Resolves after the first catalog fetch ATTEMPT (success or failure); never rejects. */
	readonly whenInitialized: Promise<void>;
	readonly status: AiProviderServiceStatus;
	readonly lastError: Error | undefined;
	/** Synchronous read over the cached snapshot; undefined before initialization. */
	getProvider(id: string): IResolvedProviderData | undefined;
	/** Synchronous; false before initialization and for unknown ids. */
	isEnabled(id: string): boolean;
	getProviders(): readonly IResolvedProviderData[];
	/** Fires after the snapshot has been refreshed. */
	readonly onDidChangeProviders: Event<IProviderCatalogChangeData>;
	/** providers.json as an openable URI (file:// on desktop, remote-authority URI on remote). */
	getConfigFileUri(): Promise<URI>;
}
