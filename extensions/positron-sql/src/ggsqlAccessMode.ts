/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Whether a ggsql of this version opens a `duckdb://` URI's `?access_mode=read_only` read-only.
 *
 * ggsql 0.5.2 and earlier do not: 0.5.2 reads the query string as part of the file path, so it
 * quietly opens (and creates) an empty database named `f.duckdb?access_mode=read_only`. The fix,
 * posit-dev/ggsql#620, landed after 0.5.2, so any later version has it. An unknown version (ggsql
 * not installed, or a version that does not parse) counts as old: without the suffix the file opens
 * read-write, which at worst fails on DuckDB's lock with an error, rather than opening the wrong
 * database.
 *
 * The DuckDB driver checks this before adding the suffix, and positron-sql checks it to explain a
 * lock conflict. Each extension has its own copy of this file;
 * `extensions/ggsqlAccessMode-copies.vitest.ts` keeps them identical.
 *
 * @param version The installed ggsql extension's version, if it is installed.
 */
export function ggsqlHonorsAccessMode(version: string | undefined): boolean {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
	if (!match) {
		return false;
	}
	const [major, minor, patch] = match.slice(1).map(Number);
	return major > 0 || minor > 5 || (minor === 5 && patch > 2);
}
