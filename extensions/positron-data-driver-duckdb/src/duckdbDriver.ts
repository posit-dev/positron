/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBDataExplorerRpcHandler } from 'positron-data-explorer-duckdb';
import { escapeDoubleQuoted } from './codeEscaping.js';
import { DuckDBConnection } from './duckdbConnection.js';
import { checkDatabaseFile, IDatabaseFileSignature, IDatabasePathEnvironment, resolveDatabasePath } from './databasePath.js';

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
 * The magic bytes in a DuckDB database file's header, which follow an 8-byte checksum. DuckDB does
 * not open an empty file, so an empty file is rejected.
 */
const DUCKDB_SIGNATURE: IDatabaseFileSignature = {
	magic: Buffer.from('DUCK', 'latin1'),
	offset: 8,
	allowEmpty: false,
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

	// The path must not be blank, and a relative path can only be resolved against a workspace
	// folder.
	const databasePath = resolveDatabasePath(filePath, databasePathEnvironment());
	if (!databasePath) {
		return error(vscode.l10n.t("Enter the path to a database file."));
	}
	if (!path.isAbsolute(databasePath)) {
		return error(vscode.l10n.t("Enter an absolute path, or open a folder to resolve a relative path against."));
	}

	// The path must name an existing DuckDB database file.
	switch (await checkDatabaseFile(databasePath, DUCKDB_SIGNATURE)) {
		case 'missing':
			return error(vscode.l10n.t("'{0}' does not exist.", databasePath));
		case 'notFile':
			return error(vscode.l10n.t("'{0}' is not a file.", databasePath));
		case 'wrongKind':
			return error(vscode.l10n.t("'{0}' is not a DuckDB database.", databasePath));
		case 'valid':
			return { normalizedValues: { databasePath } };
	}
}

/**
 * The id of the file-based connection mechanism. Used both in the driver's mechanism list and in
 * the connect switch, so the two stay in sync.
 */
const FILE_MECHANISM_ID = 'file';

/**
 * Reads the `readOnly` parameter, defaulting to true to match the parameter's declared
 * `defaultValue` so that a profile which omits the value behaves like one created today. Read-only
 * is the default because DuckDB locks a database file per process and permits concurrent opens only
 * when every process opens it read-only: it is what lets the Data Connections panel browse a
 * database while a Python or R session is connected to the same file. Both the live connection and
 * the generated connection code read the parameter through here so the two cannot disagree.
 */
function isReadOnly(params: positron.DataConnectionParameterValues): boolean {
	return params.readOnly !== false;
}

/**
 * Creates the DuckDB DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views for previewing tables/views in the Data Explorer.
 * @param logger Optional diagnostic log sink passed through to each connection it creates.
 */
export function createDuckDBDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: DuckDBDataExplorerRpcHandler,
	logger?: positron.DataConnectionLogger
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
		supportedLanguageIds: ['python', 'r', 'ggsql'],
		mechanisms: [
			{
				id: FILE_MECHANISM_ID,
				label: vscode.l10n.t('Database File'),
				description: vscode.l10n.t('Connect to a DuckDB database file on disk'),
				parameters: [
					{
						id: 'databasePath',
						label: vscode.l10n.t('Database File'),
						type: positron.DataConnectionParameterType.File,
						required: true,
						placeholder: databasePathPlaceholder,
						filters: { [vscode.l10n.t('DuckDB Files')]: ['duckdb', 'ddb'] },
					},
					{
						id: 'readOnly',
						label: vscode.l10n.t('Read Only'),
						description: vscode.l10n.t('Allows other sessions to open the same database file while this connection is open.'),
						type: positron.DataConnectionParameterType.Boolean,
						defaultValue: true,
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
					const readOnly = isReadOnly(params);

					// Validate parameters.
					if (!isNonEmptyString(rawDatabasePath)) {
						throw new Error(vscode.l10n.t('Database file path is required'));
					}

					// Resolve `~` and workspace-relative paths to an absolute path before opening the file.
					const databasePath = resolveDatabasePath(rawDatabasePath, databasePathEnvironment());

					// Create the connection and establish it.
					const connection = new DuckDBConnection({
						databasePath,
						readOnly,
					}, dataExplorerHandler, logger);

					// Connect.
					await connection.connect();

					// Return the live connection.
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
			// Extract parameters.
			const databasePath = params.databasePath;
			const readOnly = isReadOnly(params);

			// A file path is required to generate valid connection code.
			if (!isNonEmptyString(databasePath)) {
				return [];
			}

			// Resolve `~` and workspace-relative paths so the generated code references a concrete,
			// absolute path (Python and R do not expand `~`, and the console's working directory may
			// differ from the workspace folder).
			const escapedPath = escapeDoubleQuoted(resolveDatabasePath(databasePath, databasePathEnvironment()));

			// Generate code variants for supported languages. Return an empty array for
			// unsupported languages or when code cannot be generated.
			switch (languageId) {
				case 'python': {
					// The duckdb.connect(...) call, shared by the duckdb and SQLAlchemy variants.
					const duckdbConnect = `duckdb.connect("${escapedPath}"${readOnly ? ', read_only=True' : ''})`;

					// The SQLAlchemy (duckdb_engine) engine expression.
					const sqlalchemyEngine = readOnly
						? `sa.create_engine("duckdb:///${escapedPath}", connect_args={"read_only": True})`
						: `sa.create_engine("duckdb:///${escapedPath}")`;

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
					// The dbConnect expression for the DBI variant.
					const dbConnect = `dbConnect(duckdb::duckdb(), dbdir = "${escapedPath}"${readOnly ? ', read_only = TRUE' : ''})`;
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
							code: `-- @connect: duckdb://${uriPath}`,
						},
					];
				}
				default:
					return [];
			}
		},
	};
}
