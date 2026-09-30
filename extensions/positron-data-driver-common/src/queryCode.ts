/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared query code generation for the data driver extensions.
 *
 * Every SQL driver answers `generateQueryCode` the same way: quote the user's query as a string
 * literal, then hand it to whatever the connection code variant created. The quoting rules belong
 * to the language, not the driver, and the handful of ways a connection object is queried are
 * shared across drivers too -- pandas reads from any DBAPI2 connection or SQLAlchemy connectable,
 * and DBI queries every R connection these drivers make. What is genuinely per-driver is only
 * which variant ids map to which of those recipes.
 *
 * So the recipes and the quoting live here and each driver declares its map. See
 * `createQueryCodeGenerator`.
 */

/**
 * What a driver is asked to write query code for. Structurally identical to
 * `positron.QueryCodeRequest`, restated here so this package needs no `positron` types of its own;
 * a driver passes its request straight through.
 */
export interface QueryCodeRequest {
	/** The language to generate code for (e.g. 'python', 'r'). */
	readonly languageId: string;

	/** The id of the connection code variant the connection was made with. */
	readonly variantId: string;

	/** The name of the variable the connection is bound to in the session. */
	readonly connectionVariable: string;

	/** The query to run, exactly as the user wrote it. */
	readonly query: string;
}

/**
 * Writes the code that runs a query through one connection object. One recipe per shape of
 * connection object, not per driver: a psycopg2 connection and a pyodbc connection are both read
 * by pandas the same way.
 */
export type QueryCodeRecipe = (connectionVariable: string, query: string) => string;

/**
 * A driver's variant ids, by language, mapped to the recipe that queries what each variant built.
 * A language or variant absent from the map is one the driver cannot query.
 */
export type QueryCodeRecipes = Readonly<Record<string, Readonly<Record<string, QueryCodeRecipe>>>>;

// --- Quoting ---
//
// The query comes from the user's editor, so it is quoted as a string literal rather than
// concatenated into the surrounding call. The escaping rules differ enough between R and Python that
// each language gets its own quoting helper.

/**
 * Quotes a query as an R double-quoted string literal. R treats backslash as an escape character, so
 * backslashes and double quotes have to be escaped; literal newlines are legal inside an R string, so
 * multi-line SQL needs no further treatment.
 */
export function rStringLiteral(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Quotes a query as a Python triple-quoted string literal. Backslashes are escaped so the SQL reaches
 * the server as the user wrote it, and any embedded `"""` is escaped so it cannot close the literal
 * early.
 *
 * The query goes on its own lines. The leading and trailing newlines look removable and are not: a
 * query ending in a double quote would otherwise run straight into the closing delimiter and be read
 * as a fourth quote. The whitespace they add around the SQL is insignificant to the server.
 */
export function pythonStringLiteral(value: string): string {
	const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
	return `"""\n${escaped}\n"""`;
}

// --- Recipes ---

/**
 * Reads the query through pandas, which returns a data frame worth printing rather than a cursor
 * the user then has to fetch from. pandas reads from a DBAPI2 connection and a SQLAlchemy
 * connectable alike, taking the query as a plain string in both cases, so both kinds of variant
 * use this recipe.
 */
export const pandasReadSql: QueryCodeRecipe = (connectionVariable, query) =>
	`import pandas as pd\n\npd.read_sql_query(${pythonStringLiteral(query)}, ${connectionVariable})`;

/**
 * Queries a DuckDB connection through DuckDB's own relational API, which returns a data frame from
 * `.df()`, so this variant needs no pandas import of its own.
 */
export const duckdbRelational: QueryCodeRecipe = (connectionVariable, query) =>
	`${connectionVariable}.sql(${pythonStringLiteral(query)}).df()`;

/**
 * Queries an R DBI connection. Fully qualified with `::` so the code needs no library(DBI) line of
 * its own.
 */
export const dbiGetQuery: QueryCodeRecipe = (connectionVariable, query) =>
	`DBI::dbGetQuery(${connectionVariable}, ${rStringLiteral(query)})`;

// --- Generator ---

/**
 * Builds a driver's `generateQueryCode` from its variant map.
 *
 * The result returns undefined for a language or a variant the map does not name, which is how a
 * driver reports that it cannot query the connection that variant creates.
 *
 * @param recipes The driver's variant ids, by language, mapped to the recipe for each.
 * @returns A function suitable for a driver's `generateQueryCode`.
 */
export function createQueryCodeGenerator(recipes: QueryCodeRecipes): (request: QueryCodeRequest) => string | undefined {
	// Copied into Maps rather than indexed directly: both ids arrive from outside the driver, and a
	// plain object lookup for 'constructor' or '__proto__' would resolve to an inherited member that
	// is not a recipe.
	const byLanguage = new Map(
		Object.entries(recipes).map(
			([languageId, variants]) => [languageId, new Map(Object.entries(variants))] as const
		)
	);

	return (request: QueryCodeRequest) =>
		byLanguage.get(request.languageId)?.get(request.variantId)?.(request.connectionVariable, request.query);
}
