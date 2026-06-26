/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { SQLiteConnection } from './sqliteConnection.js';
import { SqliteDataExplorerRpcHandler } from './sqliteDataExplorerRpcHandler.js';

/**
 * Type guard for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages
 * treat backslash as an escape character in double-quoted strings, so Windows paths such as
 * `C:\db.sqlite` must have their separators doubled.
 */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Creates the SQLite DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views for previewing tables/views in the Data Explorer.
 */
export function createSQLiteDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: SqliteDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'sqlite.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	const isWindows = process.platform === 'win32';
	const databasePathPlaceholder = isWindows
		? vscode.l10n.t('example: C:\\path\\to\\database.sqlite')
		: vscode.l10n.t('example: /path/to/database.sqlite');

	// Return the driver.
	return {
		id: 'positron-data-driver-sqlite',
		name: 'SQLite',
		description: vscode.l10n.t('Connect to a SQLite database file'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		parameters: [
			{
				id: 'databasePath',
				label: vscode.l10n.t('Database File'),
				type: positron.DataConnectionParameterType.File,
				required: true,
				placeholder: databasePathPlaceholder,
			},
			{
				id: 'readOnly',
				label: vscode.l10n.t('Read Only'),
				type: positron.DataConnectionParameterType.Boolean,
				defaultValue: false,
			},
		],
		async connect(params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			// Extract parameters.
			const databasePath = params.databasePath;
			const readOnly = params.readOnly as boolean ?? false;

			// Validate parameters.
			if (!isNonEmptyString(databasePath)) {
				throw new Error(vscode.l10n.t('Database file path is required'));
			}

			// Create the connection and open the database in the worker process.
			const connection = new SQLiteConnection(databasePath, readOnly, dataExplorerHandler);
			await connection.connect();
			return connection;
		},
		async generateConnectionCode(languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			// The database file path is required to generate valid connection code.
			const databasePath = params.databasePath;
			if (!isNonEmptyString(databasePath)) {
				return [];
			}

			// Extract parameters.
			const readOnly = params.readOnly === true;
			const escapedPath = escapeDoubleQuoted(databasePath);

			// Generate code variants for supported languages. Return an empty array for unsupported
			// languages or when code cannot be generated.
			switch (languageId) {
				case 'python': {
					// The sqlite3 connection expression, shared by the sqlite3 and pandas variants.
					// Honors read-only mode via SQLite's URI filename syntax.
					const sqlite3Connect = readOnly
						? `sqlite3.connect("file:${escapedPath}?mode=ro", uri=True)`
						: `sqlite3.connect("${escapedPath}")`;
					return [
						{
							id: 'sqlite3',
							label: 'sqlite3',
							code: `import sqlite3\n\nconn = ${sqlite3Connect}\n`,
						},
						{
							id: 'sqlalchemy',
							label: 'SQLAlchemy',
							code: readOnly
								? `import sqlalchemy as sa\n\nengine = sa.create_engine("sqlite:///file:${escapedPath}?mode=ro&uri=true")\n`
								: `import sqlalchemy as sa\n\nengine = sa.create_engine("sqlite:///${escapedPath}")\n`,
						},
					];
				}
				case 'r': {
					// The dbConnect expression, shared by the DBI and dplyr variants. Honors
					// read-only mode via RSQLite's SQLITE_RO flag.
					const dbConnect = readOnly
						? `dbConnect(RSQLite::SQLite(), "${escapedPath}", flags = RSQLite::SQLITE_RO)`
						: `dbConnect(RSQLite::SQLite(), "${escapedPath}")`;
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
