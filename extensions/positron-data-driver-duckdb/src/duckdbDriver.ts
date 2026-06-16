/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBConnection } from './duckdbConnection.js';
import { DuckDBDataExplorerRpcHandler } from './duckdbDataExplorerRpcHandler.js';

/**
 * Type guard for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages
 * treat backslash as an escape character in double-quoted strings, so Windows paths such as
 * `C:\db.duckdb` must have their separators doubled.
 */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Creates the DuckDB DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views for previewing tables/views in the Data Explorer.
 */
export function createDuckDBDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: DuckDBDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'duckdb.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	const isWindows = process.platform === 'win32';
	const databasePathPlaceholder = isWindows
		? vscode.l10n.t('example: C:\\path\\to\\database.duckdb')
		: vscode.l10n.t('example: /path/to/database.duckdb');

	// Return the driver.
	return {
		id: 'positron-data-driver-duckdb',
		name: 'DuckDB',
		description: vscode.l10n.t('Connect to a DuckDB database file'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		parameters: [
			{
				id: 'databasePath',
				label: vscode.l10n.t('Database File'),
				type: positron.DataConnectionParameterType.File,
				// Not required: an in-memory database needs no file path.
				required: false,
				placeholder: databasePathPlaceholder,
			},
			{
				id: 'readOnly',
				label: vscode.l10n.t('Read Only'),
				type: positron.DataConnectionParameterType.Boolean,
				defaultValue: false,
			},
			{
				id: 'inMemory',
				label: vscode.l10n.t('In-Memory Database'),
				type: positron.DataConnectionParameterType.Boolean,
				defaultValue: false,
			},
		],
		async connect(params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			// Extract parameters.
			const inMemory = params.inMemory as boolean ?? false;
			const databasePath = params.databasePath;
			const readOnly = params.readOnly as boolean ?? false;

			// A file path is required unless connecting to an in-memory database.
			if (!inMemory && !isNonEmptyString(databasePath)) {
				throw new Error(vscode.l10n.t('Database file path is required'));
			}

			// Create the connection and establish it.
			const connection = new DuckDBConnection({
				databasePath: isNonEmptyString(databasePath) ? databasePath : undefined,
				readOnly,
				inMemory,
			}, dataExplorerHandler);

			// Connect.
			await connection.connect();

			// Return the live connection.
			return connection;
		},
		async generateConnectionCode(languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			// Extract parameters.
			const inMemory = params.inMemory === true;
			const databasePath = params.databasePath;
			const readOnly = params.readOnly === true;

			// An in-memory database needs no file. A file-backed database needs a path before we
			// can generate valid connection code.
			if (!inMemory && !isNonEmptyString(databasePath)) {
				return [];
			}

			// Read-only mode only applies to a file-backed database; an in-memory database is
			// always freshly created and writable.
			const fileReadOnly = readOnly && !inMemory;
			const escapedPath = isNonEmptyString(databasePath) ? escapeDoubleQuoted(databasePath) : '';

			// Generate code variants for supported languages. Return an empty array for
			// unsupported languages or when code cannot be generated.
			switch (languageId) {
				case 'python': {
					// The duckdb.connect(...) call, shared by the duckdb and SQLAlchemy variants.
					// An in-memory database uses the no-argument default.
					const duckdbConnect = inMemory
						? 'duckdb.connect()'
						: `duckdb.connect("${escapedPath}"${fileReadOnly ? ', read_only=True' : ''})`;

					// The SQLAlchemy (duckdb_engine) engine expression. The target is ':memory:'
					// for an in-memory database or the file path otherwise.
					const sqlalchemyTarget = inMemory ? ':memory:' : escapedPath;
					const sqlalchemyEngine = fileReadOnly
						? `sa.create_engine("duckdb:///${sqlalchemyTarget}", connect_args={"read_only": True})`
						: `sa.create_engine("duckdb:///${sqlalchemyTarget}")`;

					return [
						{
							id: 'duckdb',
							label: 'duckdb',
							code: `import duckdb\n\nconn = ${duckdbConnect}\n`,
						},
						{
							id: 'sqlalchemy',
							label: 'SQLAlchemy',
							code: `import sqlalchemy as sa\n\nengine = ${sqlalchemyEngine}\n`,
						},
					];
				}
				case 'r': {
					// The dbConnect expression for the DBI variant. An in-memory database uses
					// duckdb's default dbdir; read-only applies only to a file-backed database.
					const dbConnect = inMemory
						? 'dbConnect(duckdb::duckdb())'
						: `dbConnect(duckdb::duckdb(), dbdir = "${escapedPath}"${fileReadOnly ? ', read_only = TRUE' : ''})`;
					return [
						{
							id: 'dbi',
							label: 'DBI',
							code: `library(DBI)\n\ncon <- ${dbConnect}\n`,
						},
					];
				}
				default:
					return [];
			}
		},
	};
}
