/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeDoubleQuoted } from './codeEscaping.js';

/** The parameters needed to generate MotherDuck connection code. */
export interface MotherDuckCodeParams {
	/** The access token, or undefined when the dialog leaves secrets out. */
	token: string | undefined;
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

/** Generates connection code for the given language, or no variants for an unknown language. */
export function generateMotherDuckCode(languageId: string, params: MotherDuckCodeParams): MotherDuckCodeVariant[] {
	const path = motherduckPath(params.database);
	const escapedPath = escapeDoubleQuoted(path);
	const token = nonBlank(params.token);
	const escapedToken = token === undefined ? undefined : escapeDoubleQuoted(token);

	switch (languageId) {
		case 'ggsql':
			return [{
				id: 'ggsql',
				label: 'ggsql',
				code: `-- @connect: duckdb://${path}` + (token === undefined ? '' : `?motherduck_token=${token}`),
			}];
		case 'python': {
			const duckdbArgs = [`"${escapedPath}"`];
			const engineArgs: string[] = [];
			if (params.readOnly) {
				duckdbArgs.push('read_only=True');
				engineArgs.push('"read_only": True');
			}
			if (escapedToken !== undefined) {
				duckdbArgs.push(`config={"motherduck_token": "${escapedToken}"}`);
				engineArgs.push(`"config": {"motherduck_token": "${escapedToken}"}`);
			}
			const connectArgs = engineArgs.length > 0 ? `, connect_args={${engineArgs.join(', ')}}` : '';
			return [
				{
					id: 'duckdb',
					label: 'DuckDB',
					code: `import duckdb\n\nconn = duckdb.connect(${duckdbArgs.join(', ')})\n`,
				},
				{
					id: 'sqlalchemy',
					label: 'SQLAlchemy',
					code: `import sqlalchemy as sa\n\nengine = sa.create_engine("duckdb:///${escapedPath}"${connectArgs})\n`,
				},
			];
		}
		case 'r': {
			const args = [`duckdb::duckdb()`, `dbdir = "${escapedPath}"`];
			if (params.readOnly) {
				args.push('read_only = TRUE');
			}
			if (escapedToken !== undefined) {
				args.push(`config = list(motherduck_token = "${escapedToken}")`);
			}
			return [{
				id: 'dbi',
				label: 'DBI',
				code: `library(DBI)\n\ncon <- dbConnect(${args.join(', ')})\n`,
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

export type MotherDuckOpenErrorKind = 'auth' | 'extensionDownload' | 'other';

/** Classifies an error message from opening an `md:` database. */
export function classifyMotherDuckOpenError(detail: string): MotherDuckOpenErrorKind {
	if (/not authenticated|check your MotherDuck token/i.test(detail)) {
		return 'auth';
	}
	if (/Failed to download extension "motherduck"/i.test(detail)) {
		return 'extensionDownload';
	}
	return 'other';
}
