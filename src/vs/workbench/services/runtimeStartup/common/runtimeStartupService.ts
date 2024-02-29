/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export const IRuntimeStartupService =
	createDecorator<IRuntimeStartupService>('runtimeStartupService');

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
	 * Start all affiliated runtimes for the workspace.
	 */
	startAffiliatedLanguageRuntimes(): void;
}
