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
		supportedLanguageIds: [],
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
			await connection.connect();
			return connection;
		},
	};
}
