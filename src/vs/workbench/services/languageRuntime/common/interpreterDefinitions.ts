/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../base/common/hash.js';
import { ILanguageRuntimeMetadata } from './languageRuntimeService.js';

/** The setting that defines interpreter variants. */
export const INTERPRETER_DEFINITIONS_KEY = 'interpreters.definitions';

/**
 * An entry in the `interpreters.definitions` setting: a labeled variant of the
 * discovered interpreter at `path`, launched with extra environment variables
 * and/or a startup script.
 */
export interface IInterpreterDefinition {
	readonly language: string;
	readonly path: string;
	readonly label: string;
	readonly env?: Record<string, string>;
	readonly startupScript?: string;
}

/**
 * Drop incomplete entries and all but the first entry for each language and label.
 */
function validDefinitions(definitions: readonly IInterpreterDefinition[] | undefined): IInterpreterDefinition[] {
	const seen = new Set<string>();
	return (definitions ?? []).filter(d => {
		const key = `${d.language}\0${d.label}`;
		if (!d.language || !d.path || !d.label || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/**
 * Get the definitions that apply to a runtime (same language, exact same path).
 */
export function getMatchingDefinitions(definitions: readonly IInterpreterDefinition[] | undefined, runtime: ILanguageRuntimeMetadata): IInterpreterDefinition[] {
	return validDefinitions(definitions).filter(d => d.language === runtime.languageId && d.path === runtime.runtimePath);
}

/**
 * Create a variant of a runtime from a definition. The variant ID is derived
 * from the base ID and label, so it is stable across windows and distinct per
 * definition. Variants share their base's runtimePath, which keys the discovery
 * cache, so they are never cached.
 */
export function createInterpreterVariant(base: ILanguageRuntimeMetadata, definition: IInterpreterDefinition): ILanguageRuntimeMetadata {
	const sha = new StringSHA1();
	sha.update(`${base.runtimeId}\0${definition.label}`);
	return {
		...base,
		runtimeId: sha.digest().substring(0, 32),
		runtimeName: definition.label,
		interpreterDefinition: definition.label,
		cacheable: false,
	};
}

/**
 * Rebuild a stored variant from its validated base metadata, or return
 * undefined if the definition no longer exists or no longer matches the base.
 */
export function recreateInterpreterVariant(definitions: readonly IInterpreterDefinition[] | undefined, base: ILanguageRuntimeMetadata, label: string): ILanguageRuntimeMetadata | undefined {
	const definition = getMatchingDefinitions(definitions, base).find(d => d.label === label);
	return definition && createInterpreterVariant(base, definition);
}
