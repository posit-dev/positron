/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimeMetadata, IRuntimeManager } from '../../languageRuntime/common/languageRuntimeService.js';

export const IRuntimeStartupService =
	createDecorator<IRuntimeStartupService>('runtimeStartupService');

/**
 * The IRuntimeStartupService is responsible for coordinating the process by
 * which runtimes are automatically started when a workspace is opened, and
 * reconnected to when a workspace is reloaded or reopened.
 */
export interface IRuntimeStartupService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Get the preferred runtime for a language. This approximates "the runtime
	 * the user probably wants to start for the given language" and takes a
	 * number of variables into account, including the what's active now, what
	 * they've used recently, etc.
	 *
	 * @param languageId The language identifier.
	 */
	getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata;

	/**
	 * Whether the workspace has affiliated runtimes.
	 */
	hasAffiliatedRuntime(): boolean;

	/**
	 * Gets metadata for the runtime affiliated with the workspace for the given
	 * languageId, or undefined if no runtimes with the given languageId are
	 * affiliated with the workspace.
	 *
	 * @param languageId The language identifier.
	 */
	getAffiliatedRuntimeMetadata(languageId: string): ILanguageRuntimeMetadata | undefined;

	/**
	 * Signal that discovery of language runtimes is completed for an extension host.
	 *
	 * @param id the id of the MainThreadLanguageRuntime instance for the extension host
	 */
	completeDiscovery(id: number): void;

	/**
	 * Register a runtime manager with the service; returns a disposable that
	 * can be used to unregister the manager.
	 *
	 * @param manager The runtime manager
	 */
	registerRuntimeManager(manager: IRuntimeManager): IDisposable;
}
