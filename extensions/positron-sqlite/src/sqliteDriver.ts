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
 * Creates the SQLite DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 */
export function createSQLiteDriver(
	context: vscode.ExtensionContext
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'sqlite.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	return {
		id: 'positron-sqlite',
		name: 'SQLite',
		description: 'Connect to a local SQLite database file',
		iconSvg,
		supportedLanguageIds: [],
		parameters: [
			{
				id: 'databasePath',
				label: 'Database File',
				type: positron.DataConnectionParameterType.File,
				required: true,
				placeholder: '/path/to/database.sqlite',
			},
			{
				id: 'readOnly',
				label: 'Read Only',
				type: positron.DataConnectionParameterType.Boolean,
				defaultValue: false,
			},
		],
		connect(params: positron.DataConnectionParameterValues): Thenable<positron.DataConnection> {
			const databasePath = params.databasePath as string;
			const readOnly = params.readOnly as boolean ?? false;

			if (!databasePath) {
				throw new Error('Database file path is required');
			}

			return Promise.resolve(new SQLiteConnection(databasePath, readOnly));
		},
	};
}
