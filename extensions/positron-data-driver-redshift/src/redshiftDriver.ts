/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Cloned from positron-data-driver-postgresql's postgresqlDriver.ts, pared down to Amazon Redshift's
// first auth method: user & password. Redshift also supports IAM (AWS profile) and Okta federated
// sign-in; those mechanisms will be added later, each minting temporary credentials before handing
// off to the same `pg`-backed connection. Redshift differences baked in here: the database is
// required (a Redshift connection is always scoped to one database), the default port is 5439, and
// generated code targets redshift_connector (Python) rather than psycopg2.

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { RedshiftConnection } from './redshiftConnection.js';
import { RedshiftDataExplorerRpcHandler } from './redshiftDataExplorerRpcHandler.js';

/** The Redshift default port. */
const DEFAULT_PORT = 5439;

/** Type guard for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Parses the Host field, which may be a bare hostname or the full endpoint the AWS console shows as
 * a single copy-paste string: `host[:port][/database]` (optionally with a `redshift://` or
 * `jdbc:redshift://` scheme). Returns the bare host plus any port/database embedded in the string,
 * so pasting the console endpoint just works instead of being resolved verbatim as a hostname.
 */
export function parseRedshiftEndpoint(input: string): { host: string; port?: number; database?: string } {
	let s = input.trim();

	// Strip an optional scheme (everything up to and including "://"), e.g. jdbc:redshift:// .
	const schemeIdx = s.indexOf('://');
	if (schemeIdx !== -1) {
		s = s.slice(schemeIdx + 3);
	}

	// Split off the database path (first '/').
	let database: string | undefined;
	const slashIdx = s.indexOf('/');
	if (slashIdx !== -1) {
		database = s.slice(slashIdx + 1) || undefined;
		s = s.slice(0, slashIdx);
	}

	// Split off the port (last ':'), keeping it only when it is a valid integer.
	let port: number | undefined;
	const colonIdx = s.lastIndexOf(':');
	if (colonIdx !== -1) {
		const portStr = s.slice(colonIdx + 1);
		const parsed = Number(portStr);
		if (portStr.length > 0 && Number.isInteger(parsed)) {
			port = parsed;
			s = s.slice(0, colonIdx);
		}
	}

	return { host: s, port, database };
}

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages treat
 * backslash as an escape character in double-quoted strings, so values containing backslashes or
 * quotes must be escaped.
 */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The id of the user/password connection mechanism. Used both in the driver's mechanism list and in
 * the connect/generate switches, so they stay in sync.
 */
const PASSWORD_MECHANISM_ID = 'password';

/**
 * Normalized Redshift connection fields, independent of any client library. The renderers map these
 * to each library's argument names.
 */
interface RedshiftConnectionFields {
	host: string;
	port: number;
	database: string;
	user: string;
	password?: string;
	ssl?: boolean;
}

/** Renders redshift_connector (Amazon's official Python driver) connection code. */
function renderRedshiftConnectorCode(fields: RedshiftConnectionFields): positron.ConnectionCodeVariant {
	const args: string[] = [];
	args.push(`host="${escapeDoubleQuoted(fields.host)}"`);
	args.push(`port=${fields.port}`);
	args.push(`database="${escapeDoubleQuoted(fields.database)}"`);
	args.push(`user="${escapeDoubleQuoted(fields.user)}"`);
	if (fields.password) { args.push(`password="${escapeDoubleQuoted(fields.password)}"`); }
	if (fields.ssl === false) { args.push(`ssl=False`); }
	return {
		id: 'redshift_connector',
		label: 'redshift_connector',
		code: `import redshift_connector\n\nconn = redshift_connector.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/**
 * Renders DBI/RPostgres connection code. RPostgres speaks the PostgreSQL wire protocol, so it
 * connects to Redshift directly using the cluster endpoint as the host.
 */
function renderDbiCode(fields: RedshiftConnectionFields): positron.ConnectionCodeVariant {
	const args: string[] = [`RPostgres::Postgres()`];
	args.push(`host = "${escapeDoubleQuoted(fields.host)}"`);
	args.push(`port = ${fields.port}`);
	args.push(`dbname = "${escapeDoubleQuoted(fields.database)}"`);
	args.push(`user = "${escapeDoubleQuoted(fields.user)}"`);
	if (fields.password) { args.push(`password = "${escapeDoubleQuoted(fields.password)}"`); }
	if (fields.ssl !== false) { args.push(`sslmode = "require"`); }
	return {
		id: 'dbi',
		label: 'DBI',
		// R does not allow a trailing comma, so join the arguments with commas.
		code: `library(DBI)\n\ncon <- dbConnect(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\n`,
	};
}

/**
 * Maps the user/password mechanism's parameter values to normalized fields. Returns undefined when a
 * required field (host, database, or user) is missing.
 */
function passwordConnectionFields(params: positron.DataConnectionParameterValues): RedshiftConnectionFields | undefined {
	const hostInput = isNonEmptyString(params.host) ? params.host : undefined;
	const database = isNonEmptyString(params.database) ? params.database : undefined;
	const user = isNonEmptyString(params.user) ? params.user : undefined;
	if (!hostInput || !database || !user) {
		return undefined;
	}
	// Accept a full `host:port/database` endpoint in the Host field; embedded values win over the
	// individual fields.
	const endpoint = parseRedshiftEndpoint(hostInput);
	return {
		host: endpoint.host,
		port: endpoint.port ?? (typeof params.port === 'number' ? params.port : DEFAULT_PORT),
		database: endpoint.database ?? database,
		user,
		password: isNonEmptyString(params.password) ? params.password : undefined,
		ssl: params.ssl !== false,
	};
}

/**
 * Generates the connection code variants for the given language from normalized fields. Returns an
 * empty array when the fields could not be built (a required parameter was missing) or the language
 * is unsupported.
 */
function generateConnectionCodeForFields(languageId: string, fields: RedshiftConnectionFields | undefined): positron.ConnectionCodeVariant[] {
	if (!fields) {
		return [];
	}
	switch (languageId) {
		case 'python':
			return [renderRedshiftConnectorCode(fields)];
		case 'r':
			return [renderDbiCode(fields)];
		default:
			return [];
	}
}

/**
 * Creates the Amazon Redshift DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views previewed from Redshift connections.
 */
export function createRedshiftDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: RedshiftDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'redshift.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	// User & password mechanism: host, port, database, user, and password. Unlike PostgreSQL, the
	// database is required because a Redshift connection is always scoped to a single database.
	const passwordMechanism: positron.DataConnectionMechanism = {
		id: PASSWORD_MECHANISM_ID,
		label: vscode.l10n.t('User & Password'),
		description: vscode.l10n.t('Connect to a Redshift cluster with a user and password.'),
		parameters: [
			{
				id: 'host',
				label: vscode.l10n.t('Host'),
				description: vscode.l10n.t('The cluster or workgroup endpoint. You can paste the full endpoint including port and database (host:port/database).'),
				type: positron.DataConnectionParameterType.String,
				required: true,
			},
			{
				id: 'port',
				label: vscode.l10n.t('Port'),
				type: positron.DataConnectionParameterType.Number,
				required: true,
				defaultValue: DEFAULT_PORT,
			},
			{
				id: 'database',
				label: vscode.l10n.t('Database'),
				type: positron.DataConnectionParameterType.String,
				required: true,
				defaultValue: 'dev',
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
				// Redshift expects an encrypted connection, so default SSL on.
				defaultValue: true,
			},
		],
	};

	// Return the driver.
	return {
		id: 'positron-data-driver-redshift',
		name: 'Redshift',
		description: vscode.l10n.t('Connect to a Redshift cluster or workgroup'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [passwordMechanism],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			switch (mechanismId) {
				case PASSWORD_MECHANISM_ID: {
					// Host, port, database, user, and password are all required for this mechanism.
					const hostInput = params.host;
					if (!isNonEmptyString(hostInput)) {
						throw new Error(vscode.l10n.t('Host is required'));
					}
					const database = params.database;
					if (!isNonEmptyString(database)) {
						throw new Error(vscode.l10n.t('Database is required'));
					}
					const user = params.user;
					if (!isNonEmptyString(user)) {
						throw new Error(vscode.l10n.t('User is required'));
					}

					// The AWS console presents the endpoint as `host:port/database`; accept that whole
					// string in the Host field and let any embedded port/database override the fields.
					const endpoint = parseRedshiftEndpoint(hostInput);
					const port = endpoint.port ?? (typeof params.port === 'number' ? params.port : DEFAULT_PORT);

					// Create the connection.
					const connection = new RedshiftConnection({
						kind: 'fields',
						host: endpoint.host,
						port,
						database: endpoint.database ?? database,
						user,
						password: isNonEmptyString(params.password) ? params.password : undefined,
						ssl: params.ssl !== false,
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
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			switch (mechanismId) {
				case PASSWORD_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, passwordConnectionFields(params));
				default:
					return [];
			}
		},
	};
}
