/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

/**
 * Shell languages that are executed via terminal.
 */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'fish', 'shell', 'powershell', 'pwsh', 'cmd']);

/**
 * Check if a language should be executed via terminal.
 */
export function isShellLanguage(language: string): boolean {
	return SHELL_LANGUAGES.has(language.toLowerCase());
}

/**
 * A cell language that no runtime runs, but whose cells run as code in another
 * language, as knitr's engines do. Such a cell runs as a whole, in the session
 * of its host language, because its code can't run statement by statement.
 */
export interface IHostedCellLanguage {
	/** The language whose runtime runs the cell, e.g. `r`. */
	readonly hostLanguage: string;
	/** The comment characters that start the cell's option lines, e.g. `//`. */
	readonly optionComment: string;
	/** The host language code that runs the cell's code. */
	toHostCode(code: string): string;
}

/**
 * Wraps C++ code in a call to `Rcpp::sourceCpp()`, which compiles it and makes
 * its exported functions available in R, as knitr's Rcpp engine does.
 *
 * The code goes in an R raw string. C++ raw strings use the same `)--"` syntax,
 * so the delimiter gets as many dashes as it takes not to occur in the code.
 */
export function rcppWithSourceCpp(code: string): string {
	let dashes = '--';
	while (code.includes(`)${dashes}"`)) {
		dashes += '-';
	}
	return `Rcpp::sourceCpp(code = r"${dashes}(${code})${dashes}")`;
}

/**
 * Hosted cell languages, by lower-cased fence language.
 */
const HOSTED_CELL_LANGUAGES: ReadonlyMap<string, IHostedCellLanguage> = new Map([
	['rcpp', { hostLanguage: 'r', optionComment: '//', toHostCode: rcppWithSourceCpp }],
]);

/**
 * The fence languages of the hosted cell languages, lower-cased, e.g. `rcpp`.
 */
export function hostedCellLanguages(): string[] {
	return [...HOSTED_CELL_LANGUAGES.keys()];
}

/**
 * The hosted cell language for a cell's fence language, if it is one.
 */
export function getHostedCellLanguage(language: string): IHostedCellLanguage | undefined {
	return HOSTED_CELL_LANGUAGES.get(language.toLowerCase());
}

/**
 * The language of the runtime that runs a cell: the host language of a hosted
 * cell language (`r` for an `{Rcpp}` cell), otherwise the cell's own language.
 */
export function cellRuntimeLanguage(language: string): string {
	return getHostedCellLanguage(language)?.hostLanguage ?? language;
}

/**
 * Whether a language can host a kernel or a console session, i.e. whether an
 * extension provides runtimes for it. Extension metadata answers this, so it
 * holds before the extension activates and discovers interpreters.
 */
export function hasRuntimeProvider(language: string, runtimeStartupService: IRuntimeStartupService): boolean {
	return runtimeStartupService.hasLanguageRuntimeProvider(language.toLowerCase());
}

/**
 * Whether a cell's language can be executed: a shell language (terminal) or a
 * language that runs in a runtime (kernel or console), either its own or, for
 * a hosted cell language such as Rcpp, its host language's. Diagram and markup
 * languages such as mermaid, dot, or plantuml match neither.
 */
export function isExecutableLanguage(language: string, runtimeStartupService: IRuntimeStartupService): boolean {
	return isShellLanguage(language) || hasRuntimeProvider(cellRuntimeLanguage(language), runtimeStartupService);
}
