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
 * Type guard for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

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

	// Return the driver.
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
				type: positron.DataConnectionParameterType.Password,
				required: true,
				placeholder: '',
			},
			{
				id: 'ssl',
				label: 'Use SSL',
				type: positron.DataConnectionParameterType.Boolean,
				defaultValue: false,
			},
			{
				id: 'read-only',
				label: 'Read only',
				type: positron.DataConnectionParameterType.Boolean,
				defaultValue: false,
			},
		],
		async connect(params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			// Extract parameters.
			const host = params.host;
			const port = typeof params.port === 'number' ? params.port : undefined;
			const database = params.database;
			const user = params.user;
			const password = params.password;
			const ssl = params.ssl as boolean ?? false;
			const readOnly = params.readOnly as boolean ?? false;

			// Validate parameters.
			if (!isNonEmptyString(host)) {
				return Promise.reject(new Error('Host is required'));
			}
			if (port === undefined) {
				return Promise.reject(new Error('Port is required'));
			}
			if (!isNonEmptyString(database)) {
				return Promise.reject(new Error('Database is required'));
			}
			if (!isNonEmptyString(user)) {
				return Promise.reject(new Error('User is required'));
			}
			if (!isNonEmptyString(password)) {
				return Promise.reject(new Error('Password is required'));
			}

			// Create the connection.
			const connection = new PostgreSQLConnection({
				host,
				port,
				database,
				user,
				password,
				ssl,
				readOnly
			});

			// Connect the connection.
			await connection.connect();

			// Return the connection.
			return connection;
		},
	};
}
