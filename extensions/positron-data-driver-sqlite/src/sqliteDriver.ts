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
import { checkDatabaseFile, IDatabaseFileSignature, IDatabasePathEnvironment, resolveDatabasePath } from './databasePath.js';
import { SqliteDataExplorerRpcHandler } from './sqliteDataExplorerRpcHandler.js';

/**
 * Type guard for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * The machine database paths are resolved on: the extension host's, which is also where the
 * database file is opened.
 */
function databasePathEnvironment(): IDatabasePathEnvironment {
	return {
		pathLib: path,
		homedir: os.homedir(),
		workspaceFolderPaths: (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath),
		exists: existsSync,
	};
}

/**
 * The header every SQLite database file begins with. SQLite opens an empty file as an empty
 * database, so an empty file is accepted.
 */
const SQLITE_SIGNATURE: IDatabaseFileSignature = {
	magic: Buffer.from('SQLite format 3\0', 'latin1'),
	offset: 0,
	allowEmpty: true,
};

/**
 * Checks the database path the user entered in the configuration dialog, and resolves it to the
 * absolute path that is saved with the connection, so the connection keeps working when Positron is
 * opened on a different folder.
 * @param filePath The path as entered.
 * @returns The absolute path to save, or an error message to show beneath the field.
 */
async function validateDatabasePath(filePath: string): Promise<positron.DataConnectionParameterValidation> {
	// Reports an error with the database path.
	const error = (message: string) => ({ errors: { databasePath: message } });

	// A relative path can only be resolved against a workspace folder.
	const databasePath = resolveDatabasePath(filePath, databasePathEnvironment());
	if (!path.isAbsolute(databasePath)) {
		return error(vscode.l10n.t('Enter an absolute path, or open a folder to resolve a relative path against.'));
	}

	// The path must name an existing SQLite database file.
	switch (await checkDatabaseFile(databasePath, SQLITE_SIGNATURE)) {
		case 'missing':
			return error(vscode.l10n.t('"{0}" does not exist.', databasePath));
		case 'notFile':
			return error(vscode.l10n.t('"{0}" is not a file.', databasePath));
		case 'wrongKind':
			return error(vscode.l10n.t('"{0}" is not a SQLite database.', databasePath));
		case 'valid':
			return { normalizedValues: { databasePath } };
	}
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
 * @param logger Optional diagnostic log sink for connection lifecycle events.
 */
export function createSQLiteDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: SqliteDataExplorerRpcHandler,
	logger?: positron.DataConnectionLogger
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
		supportedLanguageIds: ['python', 'r', 'ggsql'],
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
						filters: { [vscode.l10n.t('SQLite Files')]: ['sqlite', 'sqlite3', 'db'] },
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
					const databasePath = resolveDatabasePath(rawDatabasePath, databasePathEnvironment());

					// Create the connection and open the database in the worker process.
					const connection = new SQLiteConnection(databasePath, readOnly, dataExplorerHandler, logger);
					await connection.connect();
					return connection;
				}
				default:
					throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
			}
		},
		async validateParameters(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnectionParameterValidation> {
			// Only the file mechanism has parameters to validate, and the dialog has already checked
			// that the required database path is present.
			if (mechanismId !== FILE_MECHANISM_ID || !isNonEmptyString(params.databasePath)) {
				return {};
			}

			// Validate the database path, saving it as an absolute path.
			return validateDatabasePath(params.databasePath);
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
			const escapedPath = escapeDoubleQuoted(resolveDatabasePath(databasePath, databasePathEnvironment()));

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
				case 'ggsql': {
					// ggsql connects via an `@connect` directive comment rather than executable code.
					// Forward slashes keep the path portion a valid URI on Windows, where the resolved
					// path uses backslashes.
					const uriPath = resolveDatabasePath(databasePath, databasePathEnvironment()).replace(/\\/g, '/');
					return [
						{
							id: 'ggsql',
							label: 'ggsql',
							code: `-- @connect: sqlite://${uriPath}`,
						},
					];
				}
				default:
					return [];
			}
		},
	};
}
