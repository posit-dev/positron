/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

/**
 * The console session of a language that code can still run in, if there is
 * one. An exited session is none: the console service starts or picks a live
 * one in its place, unless the code is pinned to the exited one by its ID.
 */
export function liveConsoleSession(languageId: string, runtimeSessionService: IRuntimeSessionService): ILanguageRuntimeSession | undefined {
	const session = runtimeSessionService.getConsoleSessionForLanguage(languageId);
	return session && session.getRuntimeState() !== RuntimeState.Exited ? session : undefined;
}

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
 * Whether a language can host a kernel or a console session, i.e. whether an
 * extension provides runtimes for it. Extension metadata answers this, so it
 * holds before the extension activates and discovers interpreters.
 */
export function hasRuntimeProvider(language: string, runtimeStartupService: IRuntimeStartupService): boolean {
	return runtimeStartupService.hasLanguageRuntimeProvider(language.toLowerCase());
}

/**
 * Whether a cell's language can be executed: a shell language (terminal) or a
 * language with runtimes (kernel or console). Diagram and markup languages such
 * as mermaid, dot, or plantuml match neither.
 */
export function isExecutableLanguage(language: string, runtimeStartupService: IRuntimeStartupService): boolean {
	return isShellLanguage(language) || hasRuntimeProvider(language, runtimeStartupService);
}

/** The language ggsql registers its runtime under. */
export const GGSQL_LANGUAGE = 'ggsql';

/** What a cell needs to know about its document to decide which runtime runs it. */
export interface ICellRuntimeContext {
	readonly primaryLanguage: string | undefined;
	/** The engine the frontmatter declares: knitr (true), another (false), or none. */
	readonly knitrEngine: boolean | undefined;
	readonly cells: readonly { readonly language: string }[];
}

/**
 * Whether Quarto renders the document with knitr: the engine its frontmatter
 * declares (`engine`, else a `knitr` or `jupyter` key) or, when it declares
 * none, whether it has any `{r}` cell. This is how Quarto picks the engine,
 * and how the Quarto extension's `isKnitrDocument` decides which cells it
 * can run, so the two agree on `{sql}` cells.
 */
export function rendersWithKnitr(document: ICellRuntimeContext): boolean {
	return document.knitrEngine
		?? document.cells.some(cell => cell.language.toLowerCase() === 'r');
}

/**
 * The language of the runtime that runs a cell, which is the cell's own
 * language except for SQL.
 *
 * A `{sql}` cell runs in ggsql, as a `{ggsql}` cell does: ggsql is SQL with
 * a visualization clause on the end, and the only SQL runtime there is. Not
 * under knitr, though, which renders `{sql}` cells with DBI against the R
 * connection the chunk names; running them in ggsql would query some other
 * database than the one the document renders from.
 */
export function runtimeLanguageOf(cellLanguage: string, document: ICellRuntimeContext): string {
	const language = cellLanguage.toLowerCase();
	return language === 'sql' && !rendersWithKnitr(document) ? GGSQL_LANGUAGE : language;
}

/**
 * Whether a cell can be run in its document: something runs its language, or
 * it is the document's primary language, whose kernel the run starts even when
 * no extension provides runtimes for it.
 */
export function isRunnableCell(
	cellLanguage: string,
	document: ICellRuntimeContext,
	runtimeStartupService: IRuntimeStartupService,
): boolean {
	const language = runtimeLanguageOf(cellLanguage, document);
	return isExecutableLanguage(language, runtimeStartupService)
		|| language === document.primaryLanguage?.toLowerCase();
}

/** A ggsql connection directive, matched exactly as ggsql matches it. */
const CONNECT_DIRECTIVE = /^\s*-- @connect:(.*)$/;

/**
 * Lines ggsql reads past among an execution's leading directives, as its
 * `take_leading_meta` does: blank lines and exactly `-- @uncache`. Anything
 * else, a cell option that wasn't stripped or a misspelled directive
 * included, ends them.
 */
const LEADING_NOISE = /^\s*(-- @uncache\s*)?$/;

/**
 * The `-- @connect: <uri>` line a piece of ggsql starts with, in the form ggsql
 * reports the connection back in, or undefined if it starts with none. Of
 * several, the last: ggsql applies each in turn.
 *
 * Mirrors ggsql's own reading of an execution's leading directives, and
 * positron-sql's `connectIn`, which decides the tables a cell completes from;
 * the three must agree on which database a cell runs against.
 *
 * Reads `code` as ggsql would receive it: a cell's source must have its
 * option lines stripped first (see `extractExecutableCode`).
 */
export function leadingConnectLine(code: string): string | undefined {
	let uri: string | undefined;
	for (const line of code.split(/\r?\n/)) {
		const match = CONNECT_DIRECTIVE.exec(line)?.[1].trim();
		if (match) {
			uri = match;
		} else if (!LEADING_NOISE.test(line)) {
			break;
		}
	}
	return uri ? `-- @connect: ${uri}` : undefined;
}
