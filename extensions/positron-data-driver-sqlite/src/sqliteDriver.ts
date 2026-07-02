/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
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
 * Resolves a user-entered database path to an absolute path.
 */
function resolveDatabasePath(filePath: string): string {
	// A leading `~/` is the home directory. `~` is a Unix shell convention with no native meaning on
	// Windows, so this only applies on macOS and Linux. The result is absolute, so return it directly.
	if (process.platform !== 'win32' && filePath.startsWith('~/')) {
		return path.join(os.homedir(), filePath.slice(2));
	}

	// Absolute paths are used as-is.
	if (path.isAbsolute(filePath)) {
		return filePath;
	}

	// Resolve a relative path against the workspace folders.
	const candidatePaths = (vscode.workspace.workspaceFolders ?? []).map(folder => path.join(folder.uri.fsPath, filePath));
	return candidatePaths.find(candidate => existsSync(candidate)) ?? candidatePaths[0] ?? filePath;
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
 * The id of the file-based connection mechanism. Used both in the driver's mechanism list and in
 * the connect switch, so the two stay in sync.
 */
const FILE_MECHANISM_ID = 'file';

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
		mechanisms: [
			{
				id: FILE_MECHANISM_ID,
				label: vscode.l10n.t('Database File'),
				description: vscode.l10n.t('Connect to a SQLite database file on disk'),
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
			},
		],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			// Connect to the database based on the mechanism. The driver is expected to throw on failure; let it propagate.
			switch (mechanismId) {
				case FILE_MECHANISM_ID: {
					// Extract parameters.
					const rawDatabasePath = params.databasePath;
					const readOnly = params.readOnly as boolean ?? false;

					// Validate parameters.
					if (!isNonEmptyString(rawDatabasePath)) {
						throw new Error(vscode.l10n.t('Database file path is required'));
					}

					// Resolve `~` and workspace-relative paths to an absolute path before opening the file.
					const databasePath = resolveDatabasePath(rawDatabasePath);

					// Create the connection and open the database in the worker process.
					const connection = new SQLiteConnection(databasePath, readOnly, dataExplorerHandler);
					await connection.connect();
					return connection;
				}
				default:
					throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
			}
		},
		async generateConnectionCode(_mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			// The database file path is required to generate valid connection code.
			const databasePath = params.databasePath;
			if (!isNonEmptyString(databasePath)) {
				return [];
			}

			// Extract parameters. Resolve `~` and workspace-relative paths so the generated code
			// references a concrete, absolute path (Python and R do not expand `~`, and the console's
			// working directory may differ from the workspace folder).
			const readOnly = params.readOnly === true;
			const escapedPath = escapeDoubleQuoted(resolveDatabasePath(databasePath));

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
