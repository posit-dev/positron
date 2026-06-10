/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { SQLiteConnection } from './sqliteConnection.js';

/**
 * Type guard for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Creates the SQLite DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 */
export function createSQLiteDriver(
	context: vscode.ExtensionContext
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
		supportedLanguageIds: [],
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
			const connection = new SQLiteConnection(databasePath, readOnly);
			await connection.connect();
			return connection;
		},
	};
}
