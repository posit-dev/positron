/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { PostgreSQLConnection } from './postgresqlConnection.js';
import { PostgresDataExplorerRpcHandler } from './postgresqlDataExplorerRpcHandler.js';

/**
 * Type guard for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages
 * treat backslash as an escape character in double-quoted strings, so values containing
 * backslashes or quotes must be escaped.
 */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The id of the username/password connection mechanism. Used both in the driver's mechanism list
 * and in the connect switch, so the two stay in sync.
 */
const PASSWORD_MECHANISM_ID = 'password';

/**
 * Creates the PostgreSQL DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 */
export function createPostgreSQLDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: PostgresDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'postgresql.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	// Return the driver.
	return {
		id: 'positron-data-driver-postgresql',
		name: 'PostgreSQL',
		description: vscode.l10n.t('Connect to a PostgreSQL database server'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [
			{
				id: PASSWORD_MECHANISM_ID,
				label: vscode.l10n.t('Username & Password'),
				description: vscode.l10n.t('Connect using a host, database, and username/password'),
				parameters: [
					{
						id: 'host',
						label: vscode.l10n.t('Host'),
						type: positron.DataConnectionParameterType.String,
						required: true,
						defaultValue: 'localhost',
					},
					{
						id: 'port',
						label: vscode.l10n.t('Port'),
						type: positron.DataConnectionParameterType.Number,
						required: true,
						defaultValue: 5432,
					},
					{
						id: 'database',
						label: vscode.l10n.t('Database'),
						type: positron.DataConnectionParameterType.String,
						required: true,
					},
					{
						id: 'user',
						label: vscode.l10n.t('User'),
						type: positron.DataConnectionParameterType.String,
						required: true,
					},
					{
						id: 'password',
						label: vscode.l10n.t('Password'),
						type: positron.DataConnectionParameterType.Password,
						secret: true,
						required: true,
					},
					{
						id: 'ssl',
						label: vscode.l10n.t('Use SSL'),
						type: positron.DataConnectionParameterType.Boolean,
						defaultValue: false,
					},
				],
			},
		],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			switch (mechanismId) {
				case PASSWORD_MECHANISM_ID: {
					// Extract parameters.
					const host = params.host;
					const port = typeof params.port === 'number' ? params.port : undefined;
					const database = params.database;
					const user = params.user;
					const password = params.password;
					const ssl = params.ssl as boolean ?? false;

					// Validate parameters.
					if (!isNonEmptyString(host)) {
						return Promise.reject(new Error(vscode.l10n.t('Host is required')));
					}
					if (port === undefined) {
						return Promise.reject(new Error(vscode.l10n.t('Port is required')));
					}
					if (!isNonEmptyString(database)) {
						return Promise.reject(new Error(vscode.l10n.t('Database is required')));
					}
					if (!isNonEmptyString(user)) {
						return Promise.reject(new Error(vscode.l10n.t('User is required')));
					}
					if (!isNonEmptyString(password)) {
						return Promise.reject(new Error(vscode.l10n.t('Password is required')));
					}

					// Create the connection.
					const connection = new PostgreSQLConnection({
						host,
						port,
						database,
						user,
						password,
						ssl
					}, dataExplorerHandler);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				default:
					return Promise.reject(new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId)));
			}
		},
		async generateConnectionCode(_mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			// The host, database, and user are required to generate valid connection code.
			const host = params.host;
			const database = params.database;
			const user = params.user;
			if (!isNonEmptyString(host) || !isNonEmptyString(database) || !isNonEmptyString(user)) {
				return [];
			}

			const port = typeof params.port === 'number' ? params.port : 5432;
			const password = isNonEmptyString(params.password) ? params.password : '';
			const ssl = params.ssl === true;

			switch (languageId) {
				case 'python': {
					// The psycopg2 connect arguments.
					const psycopg2Args = [
						`host="${escapeDoubleQuoted(host)}"`,
						`port=${port}`,
						`dbname="${escapeDoubleQuoted(database)}"`,
						`user="${escapeDoubleQuoted(user)}"`,
						`password="${escapeDoubleQuoted(password)}"`,
					];
					if (ssl) {
						psycopg2Args.push(`sslmode="require"`);
					}

					// The SQLAlchemy URL arguments. We build the engine from sa.URL.create(...)
					// rather than a URL string so the credentials are escaped by SQLAlchemy
					// instead of requiring manual percent-encoding of special characters.
					const sqlalchemyArgs = [
						`"postgresql+psycopg2"`,
						`host="${escapeDoubleQuoted(host)}"`,
						`port=${port}`,
						`database="${escapeDoubleQuoted(database)}"`,
						`username="${escapeDoubleQuoted(user)}"`,
						`password="${escapeDoubleQuoted(password)}"`,
					];
					if (ssl) {
						sqlalchemyArgs.push(`query={"sslmode": "require"}`);
					}

					return [
						{
							id: 'psycopg2',
							label: 'psycopg2',
							code: `import psycopg2\n\nconn = psycopg2.connect(\n${psycopg2Args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
						},
						{
							id: 'sqlalchemy',
							label: 'SQLAlchemy',
							code: `import sqlalchemy as sa\n\nengine = sa.create_engine(sa.URL.create(\n${sqlalchemyArgs.map(arg => `\t${arg},`).join('\n')}\n))\n`,
						},
					];
				}
				case 'r': {
					const args = [
						`RPostgres::Postgres()`,
						`host = "${escapeDoubleQuoted(host)}"`,
						`port = ${port}`,
						`dbname = "${escapeDoubleQuoted(database)}"`,
						`user = "${escapeDoubleQuoted(user)}"`,
						`password = "${escapeDoubleQuoted(password)}"`,
					];
					if (ssl) {
						args.push(`sslmode = "require"`);
					}
					return [
						{
							id: 'dbi',
							label: 'DBI',
							// R does not allow a trailing comma, so join the arguments with commas.
							code: `library(DBI)\n\ncon <- dbConnect(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\n`,
						},
					];
				}
				default:
					return [];
			}
		},
	};
}
