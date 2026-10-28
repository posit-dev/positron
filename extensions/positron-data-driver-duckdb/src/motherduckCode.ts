/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeDoubleQuoted } from './codeEscaping.js';

/**
 * The parameters needed to generate MotherDuck connection code. There is no token: generated code
 * relies on the `motherduck_token` environment variable where it runs.
 */
export interface MotherDuckCodeParams {
	database: string | undefined;
	readOnly: boolean;
}

/** Same shape as `positron.ConnectionCodeVariant`. */
export interface MotherDuckCodeVariant {
	id: string;
	label: string;
	code: string;
}

/** Returns the non-blank trimmed value, or undefined. */
function nonBlank(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/** The DuckDB path for a MotherDuck database: `md:` or `md:<database>`. */
export function motherduckPath(database: string | undefined): string {
	return 'md:' + (nonBlank(database) ?? '');
}

/**
 * The languages MotherDuck connection code can target on the given platform (a Node
 * `process.platform` value). R is left out on Windows: R duckdb there is a MinGW build, and
 * MotherDuck publishes no extension for the `windows_amd64_mingw` platform.
 */
export function motherduckLanguageIds(platform: string): string[] {
	return platform === 'win32' ? ['python', 'ggsql'] : ['python', 'r', 'ggsql'];
}

/**
 * The R duckdb package does not auto-install the MotherDuck extension when it opens `md:`,
 * so the snippet installs it through a throwaway connection first.
 */
const R_INSTALL_EXTENSION = [
	'library(DBI)',
	'',
	'install_con <- dbConnect(duckdb::duckdb())',
	'invisible(dbExecute(install_con, "INSTALL motherduck"))',
	'dbDisconnect(install_con, shutdown = TRUE)',
	'',
].join('\n');

/** The comment each Python and R snippet carries above its connect call. */
const TOKEN_COMMENT = '# MotherDuck reads your access token from the motherduck_token environment variable.\n';

/** Generates connection code for the given language, or no variants for an unknown language. */
export function generateMotherDuckCode(languageId: string, params: MotherDuckCodeParams): MotherDuckCodeVariant[] {
	const path = motherduckPath(params.database);
	const escapedPath = escapeDoubleQuoted(path);

	switch (languageId) {
		case 'ggsql':
			// ggsql passes `access_mode` from the query string to DuckDB and never percent-decodes the
			// URI, so the URI is not encoded. No comment: the kernel reads `-- @connect:` only as the
			// first line and runs any later lines as a query.
			return [{
				id: 'ggsql',
				label: 'ggsql',
				code: `-- @connect: duckdb://${path}` + (params.readOnly ? '?access_mode=read_only' : ''),
			}];
		case 'python': {
			const readOnlyArg = params.readOnly ? ', read_only=True' : '';
			const connectArgs = params.readOnly ? ', connect_args={"read_only": True}' : '';
			return [
				{
					id: 'duckdb',
					label: 'duckdb',
					code: `import duckdb\n\n${TOKEN_COMMENT}conn = duckdb.connect("${escapedPath}"${readOnlyArg})\n`,
				},
				{
					id: 'sqlalchemy',
					label: 'SQLAlchemy',
					code: `import sqlalchemy as sa\n\n${TOKEN_COMMENT}engine = sa.create_engine("duckdb:///${escapedPath}"${connectArgs})\n`,
				},
			];
		}
		case 'r': {
			const readOnlyArg = params.readOnly ? ', read_only = TRUE' : '';
			return [{
				id: 'dbi',
				label: 'DBI',
				code: `${R_INSTALL_EXTENSION}\n${TOKEN_COMMENT}con <- dbConnect(duckdb::duckdb(), dbdir = "${escapedPath}"${readOnlyArg})\n`,
			}];
		}
		default:
			return [];
	}
}

/** Replaces every occurrence of a non-blank token with `<redacted>`. */
export function scrubToken(text: string, token: string | undefined): string {
	if (token === undefined || token.trim() === '') {
		return text;
	}
	return text.split(token).join('<redacted>');
}

export type MotherDuckOpenErrorKind = 'auth' | 'databaseNotFound' | 'extensionDownload' | 'other';

/** Classifies an error message from opening an `md:` database. */
export function classifyMotherDuckOpenError(detail: string): MotherDuckOpenErrorKind {
	if (/not authenticated|check your MotherDuck token/i.test(detail)) {
		return 'auth';
	}
	if (/no database\/share named/i.test(detail)) {
		return 'databaseNotFound';
	}
	if (/Failed to download extension "motherduck"/i.test(detail)) {
		return 'extensionDownload';
	}
	return 'other';
}
