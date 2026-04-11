/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { PostgreSQLConnection } from './postgresqlConnection.js';

/**
 * Creates the PostgreSQL DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 */
export function createPostgreSQLDriver(
	context: vscode.ExtensionContext
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'postgresql.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	return {
		id: 'positron-postgresql',
		name: 'PostgreSQL',
		description: 'Connect to a PostgreSQL database server',
		iconSvg,
		supportedLanguageIds: [],
		parameters: [
			{
				id: 'host',
				label: 'Host',
				type: positron.DataConnectionParameterType.String,
				required: true,
				placeholder: 'localhost',
				defaultValue: 'localhost',
			},
			{
				id: 'port',
				label: 'Port',
				type: positron.DataConnectionParameterType.Number,
				required: true,
				defaultValue: 5432,
			},
			{
				id: 'database',
				label: 'Database',
				type: positron.DataConnectionParameterType.String,
				required: true,
				placeholder: 'postgres',
			},
			{
				id: 'user',
				label: 'User',
				type: positron.DataConnectionParameterType.String,
				required: true,
				placeholder: 'postgres',
			},
			{
				id: 'password',
				label: 'Password',
				type: positron.DataConnectionParameterType.String,
				required: false,
				placeholder: '',
			},
		],
		connect(params: positron.DataConnectionParameterValues): Thenable<positron.DataConnection> {
			const host = params.host as string;
			const port = params.port as number;
			const database = params.database as string;
			const user = params.user as string;
			const password = params.password as string ?? '';

			if (!host || !database || !user) {
				throw new Error('Host, database, and user are required');
			}

			return Promise.resolve(new PostgreSQLConnection(host, port, database, user, password));
		},
	};
}
