/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../base/common/hash.js';
import { ILanguageRuntimeMetadata } from './languageRuntimeService.js';

/** The setting that defines interpreter variants. */
export const INTERPRETER_DEFINITIONS_KEY = 'interpreters.definitions';

/**
 * The setting that controls interpreter discovery. When it is
 * `definitionsOnly` for a language, only the interpreters in
 * `interpreters.definitions` are available for that language.
 */
export const INTERPRETER_DISCOVERY_KEY = 'interpreters.discovery';

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
 * Drop malformed or incomplete entries and all but the first entry for each
 * language and label. Setting values are not type-checked when read, so a
 * hand-edited value can be any JSON.
 */
function validDefinitions(definitions: readonly IInterpreterDefinition[] | undefined): IInterpreterDefinition[] {
	const isText = (value: unknown) => typeof value === 'string' && value.length > 0;
	const isStringRecord = (value: unknown) =>
		!!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
	const seen = new Set<string>();
	return (Array.isArray(definitions) ? definitions : []).filter(d => {
		if (!d || !isText(d.language) || !isText(d.path) || !isText(d.label)) {
			return false;
		}
		if ((d.env !== undefined && !isStringRecord(d.env)) || (d.startupScript !== undefined && typeof d.startupScript !== 'string')) {
			return false;
		}
		const key = `${d.language}\0${d.label}`;
		if (seen.has(key)) {
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
 * cache, so they are never cached. Variants are always shown, even when their
 * base is definition-only.
 */
export function createInterpreterVariant(base: ILanguageRuntimeMetadata, definition: IInterpreterDefinition): ILanguageRuntimeMetadata {
	const sha = new StringSHA1();
	sha.update(`${base.runtimeId}\0${definition.label}`);
	return {
		...base,
		runtimeId: sha.digest().substring(0, 32),
		runtimeName: definition.label,
		interpreterDefinition: definition.label,
		definitionOnly: false,
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
