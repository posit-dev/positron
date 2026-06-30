/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as os from 'os';
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
 * The id of the user/password connection mechanism. Used both in the driver's mechanism list
 * and in the connect/generate switches, so they stay in sync.
 */
const PASSWORD_MECHANISM_ID = 'password';

/**
 * The id of the local-server connection mechanism. Connects over a local Unix domain socket as the
 * operating system account with no password, relying on the server's local socket authentication
 * (PostgreSQL peer or trust). Used both in the driver's mechanism list and in the connect/generate
 * switches, so they stay in sync.
 */
const LOCAL_SERVER_MECHANISM_ID = 'localServer';

/**
 * The id of the client-certificate connection mechanism. The client authenticates over SSL by
 * presenting a certificate and key rather than a password. Used both in the driver's mechanism list
 * and in the connect/generate switches, so they stay in sync.
 */
const CERT_MECHANISM_ID = 'clientCert';

/**
 * The id of the connection-string mechanism. The user pastes a single libpq connection string (URL
 * or key=value DSN), which is handed to the client verbatim. Used both in the driver's mechanism list
 * and in the connect/generate switches, so they stay in sync.
 */
const CONNECTION_STRING_MECHANISM_ID = 'connectionString';

// --- Parameter fragments ---
//
// Mechanisms are assembled from these shared fragments rather than repeating parameter definitions.
// They are functions (not constants) because they call vscode.l10n.t, which must run after the l10n
// bundle is initialized; each is invoked while building the driver inside createPostgreSQLDriver.

/** The TCP endpoint parameters (host and port), shared by the password and client-cert mechanisms. */
function hostPortParams(): positron.DataConnectionParameter[] {
	return [
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
	];
}

/** The required database parameter, shared by every mechanism. */
function databaseParam(): positron.DataConnectionParameter {
	return {
		id: 'database',
		label: vscode.l10n.t('Database'),
		type: positron.DataConnectionParameterType.String,
		required: true,
	};
}

/** The optional user parameter, shared by every mechanism. Blank defaults to the OS account. */
function userParam(): positron.DataConnectionParameter {
	return {
		// Blank lets the pg client default to the operating system account (via PGUSER).
		id: 'user',
		label: vscode.l10n.t('User'),
		description: vscode.l10n.t('Leave empty to use your operating system account.'),
		type: positron.DataConnectionParameterType.String,
	};
}

/** The optional password parameter, used by the user/password mechanism. */
function passwordParam(): positron.DataConnectionParameter {
	return {
		// Blank connects without a password, which works when the server does not require one for this
		// user (e.g. trust authentication, or credentials supplied via .pgpass or PGPASSWORD).
		id: 'password',
		label: vscode.l10n.t('Password'),
		description: vscode.l10n.t('Leave empty if the server does not require a password for this user.'),
		type: positron.DataConnectionParameterType.Password,
		secret: true,
	};
}

/** The optional "Use SSL" toggle, used by the user/password mechanism. */
function sslParam(): positron.DataConnectionParameter {
	return {
		id: 'ssl',
		label: vscode.l10n.t('Use SSL'),
		type: positron.DataConnectionParameterType.Boolean,
		defaultValue: false,
	};
}

/** The client-certificate parameters (CA, client cert, client key), used by the cert mechanism. */
function clientCertParams(): positron.DataConnectionParameter[] {
	return [
		{
			// Blank skips server certificate verification; the connection is still encrypted.
			id: 'sslrootcert',
			label: vscode.l10n.t('CA Certificate'),
			description: vscode.l10n.t('Leave empty to skip server certificate verification.'),
			type: positron.DataConnectionParameterType.File,
		},
		{
			id: 'sslcert',
			label: vscode.l10n.t('Client Certificate'),
			type: positron.DataConnectionParameterType.File,
			required: true,
		},
		{
			id: 'sslkey',
			label: vscode.l10n.t('Client Key'),
			type: positron.DataConnectionParameterType.File,
			required: true,
		},
	];
}

/** The single connection-string parameter, used by the connection-string mechanism. */
function connectionStringParam(): positron.DataConnectionParameter {
	return {
		// Secret: a connection string typically embeds a password, so it must go to secret storage
		// rather than plain settings.
		id: 'connectionString',
		label: vscode.l10n.t('Connection String'),
		description: vscode.l10n.t('The connection string (URL) from your database provider.'),
		type: positron.DataConnectionParameterType.String,
		secret: true,
		// Render in plaintext so the user can read back the string they paste. It still goes to
		// secret storage because it typically embeds a password.
		masked: false,
		required: true,
		placeholder: 'postgresql://user:password@host:5432/database',
	};
}

// --- Connection code generation ---
//
// Each mechanism maps its parameter values to a normalized PostgresConnectionFields, and the shared
// renderers turn those fields into client-library code. Only fields that are set are emitted, so the
// same renderers serve every mechanism; the renderers own the per-library argument-name differences
// (e.g. dbname vs database, user vs username).

/**
 * Normalized PostgreSQL connection fields, independent of any client library. The renderers map
 * these to each library's argument names. Optional fields are omitted from the generated code.
 */
interface PostgresConnectionFields {
	host?: string;
	port?: number;
	database: string;
	user?: string;
	password?: string;
	sslmode?: string;
	sslrootcert?: string;
	sslcert?: string;
	sslkey?: string;
}

/** Renders psycopg2 connection code from normalized fields. */
function renderPsycopg2Code(fields: PostgresConnectionFields): positron.ConnectionCodeVariant {
	const args: string[] = [];
	if (fields.host) { args.push(`host="${escapeDoubleQuoted(fields.host)}"`); }
	if (fields.port !== undefined) { args.push(`port=${fields.port}`); }
	args.push(`dbname="${escapeDoubleQuoted(fields.database)}"`);
	if (fields.user) { args.push(`user="${escapeDoubleQuoted(fields.user)}"`); }
	if (fields.password) { args.push(`password="${escapeDoubleQuoted(fields.password)}"`); }
	if (fields.sslmode) { args.push(`sslmode="${escapeDoubleQuoted(fields.sslmode)}"`); }
	if (fields.sslrootcert) { args.push(`sslrootcert="${escapeDoubleQuoted(fields.sslrootcert)}"`); }
	if (fields.sslcert) { args.push(`sslcert="${escapeDoubleQuoted(fields.sslcert)}"`); }
	if (fields.sslkey) { args.push(`sslkey="${escapeDoubleQuoted(fields.sslkey)}"`); }
	return {
		id: 'psycopg2',
		label: 'psycopg2',
		code: `import psycopg2\n\nconn = psycopg2.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/**
 * Renders SQLAlchemy connection code from normalized fields. We build the engine from
 * sa.URL.create(...) rather than a URL string so the credentials are escaped by SQLAlchemy instead
 * of requiring manual percent-encoding of special characters; SSL options go in the query dict.
 */
function renderSqlAlchemyCode(fields: PostgresConnectionFields): positron.ConnectionCodeVariant {
	const args: string[] = [`"postgresql+psycopg2"`];
	if (fields.host) { args.push(`host="${escapeDoubleQuoted(fields.host)}"`); }
	if (fields.port !== undefined) { args.push(`port=${fields.port}`); }
	args.push(`database="${escapeDoubleQuoted(fields.database)}"`);
	if (fields.user) { args.push(`username="${escapeDoubleQuoted(fields.user)}"`); }
	if (fields.password) { args.push(`password="${escapeDoubleQuoted(fields.password)}"`); }

	const queryEntries: string[] = [];
	if (fields.sslmode) { queryEntries.push(`"sslmode": "${escapeDoubleQuoted(fields.sslmode)}"`); }
	if (fields.sslrootcert) { queryEntries.push(`"sslrootcert": "${escapeDoubleQuoted(fields.sslrootcert)}"`); }
	if (fields.sslcert) { queryEntries.push(`"sslcert": "${escapeDoubleQuoted(fields.sslcert)}"`); }
	if (fields.sslkey) { queryEntries.push(`"sslkey": "${escapeDoubleQuoted(fields.sslkey)}"`); }
	if (queryEntries.length > 0) { args.push(`query={${queryEntries.join(', ')}}`); }

	return {
		id: 'sqlalchemy',
		label: 'SQLAlchemy',
		code: `import sqlalchemy as sa\n\nengine = sa.create_engine(sa.URL.create(\n${args.map(arg => `\t${arg},`).join('\n')}\n))\n`,
	};
}

/** Renders DBI/RPostgres connection code from normalized fields. */
function renderDbiCode(fields: PostgresConnectionFields): positron.ConnectionCodeVariant {
	const args: string[] = [`RPostgres::Postgres()`];
	if (fields.host) { args.push(`host = "${escapeDoubleQuoted(fields.host)}"`); }
	if (fields.port !== undefined) { args.push(`port = ${fields.port}`); }
	args.push(`dbname = "${escapeDoubleQuoted(fields.database)}"`);
	if (fields.user) { args.push(`user = "${escapeDoubleQuoted(fields.user)}"`); }
	if (fields.password) { args.push(`password = "${escapeDoubleQuoted(fields.password)}"`); }
	if (fields.sslmode) { args.push(`sslmode = "${escapeDoubleQuoted(fields.sslmode)}"`); }
	if (fields.sslrootcert) { args.push(`sslrootcert = "${escapeDoubleQuoted(fields.sslrootcert)}"`); }
	if (fields.sslcert) { args.push(`sslcert = "${escapeDoubleQuoted(fields.sslcert)}"`); }
	if (fields.sslkey) { args.push(`sslkey = "${escapeDoubleQuoted(fields.sslkey)}"`); }
	return {
		id: 'dbi',
		label: 'DBI',
		// R does not allow a trailing comma, so join the arguments with commas.
		code: `library(DBI)\n\ncon <- dbConnect(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\n`,
	};
}

/**
 * Generates the connection code variants for the given language from normalized fields. Returns an
 * empty array when the fields could not be built (a required parameter was missing) or the language
 * is unsupported.
 */
function generateConnectionCodeForFields(languageId: string, fields: PostgresConnectionFields | undefined): positron.ConnectionCodeVariant[] {
	if (!fields) {
		return [];
	}
	switch (languageId) {
		case 'python':
			return [renderPsycopg2Code(fields), renderSqlAlchemyCode(fields)];
		case 'r':
			return [renderDbiCode(fields)];
		default:
			return [];
	}
}

/**
 * Maps the usern/password mechanism's parameter values to normalized fields. The user and
 * password are optional. Returns undefined when the host or database is missing.
 */
function passwordConnectionFields(params: positron.DataConnectionParameterValues): PostgresConnectionFields | undefined {
	const host = isNonEmptyString(params.host) ? params.host : undefined;
	const database = isNonEmptyString(params.database) ? params.database : undefined;
	if (!host || !database) {
		return undefined;
	}
	return {
		host,
		port: typeof params.port === 'number' ? params.port : 5432,
		database,
		user: isNonEmptyString(params.user) ? params.user : undefined,
		password: isNonEmptyString(params.password) ? params.password : undefined,
		sslmode: params.ssl === true ? 'require' : undefined,
	};
}

/**
 * Maps the local-server mechanism's parameter values to normalized fields. The connection is over a
 * local socket, so no host, port, or password is emitted; the user is included only when set
 * (otherwise the client defaults to the OS account). Returns undefined when the database is missing.
 */
function localServerConnectionFields(params: positron.DataConnectionParameterValues): PostgresConnectionFields | undefined {
	const database = isNonEmptyString(params.database) ? params.database : undefined;
	if (!database) {
		return undefined;
	}
	return {
		database,
		user: isNonEmptyString(params.user) ? params.user : undefined,
	};
}

/**
 * Maps the client-certificate mechanism's parameter values to normalized fields. The server
 * certificate is verified (sslmode "verify-full") only when a CA certificate is supplied; otherwise
 * the connection is encrypted but unverified (sslmode "require"). Returns undefined when the host,
 * database, client certificate, or client key is missing.
 */
function certConnectionFields(params: positron.DataConnectionParameterValues): PostgresConnectionFields | undefined {
	const host = isNonEmptyString(params.host) ? params.host : undefined;
	const database = isNonEmptyString(params.database) ? params.database : undefined;
	const sslcert = isNonEmptyString(params.sslcert) ? params.sslcert : undefined;
	const sslkey = isNonEmptyString(params.sslkey) ? params.sslkey : undefined;
	if (!host || !database || !sslcert || !sslkey) {
		return undefined;
	}
	const sslrootcert = isNonEmptyString(params.sslrootcert) ? params.sslrootcert : undefined;
	return {
		host,
		port: typeof params.port === 'number' ? params.port : 5432,
		database,
		user: isNonEmptyString(params.user) ? params.user : undefined,
		sslmode: sslrootcert ? 'verify-full' : 'require',
		sslrootcert,
		sslcert,
		sslkey,
	};
}

/**
 * Parses a libpq URL connection string into normalized fields so the same renderers can generate
 * code for it. Only the URL form (postgresql:// or postgres://) is understood; key=value DSN strings
 * return undefined (they are still handed to the client verbatim at connect time, but cannot be
 * turned into structured code). Returns undefined when the string does not parse or has no database.
 */
function parseConnectionString(connectionString: string): PostgresConnectionFields | undefined {
	let url: URL;
	try {
		url = new URL(connectionString);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
		return undefined;
	}
	const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
	if (!database) {
		return undefined;
	}
	return {
		host: url.hostname || undefined,
		port: url.port ? Number(url.port) : undefined,
		database,
		user: url.username ? decodeURIComponent(url.username) : undefined,
		password: url.password ? decodeURIComponent(url.password) : undefined,
		sslmode: url.searchParams.get('sslmode') ?? undefined,
		sslrootcert: url.searchParams.get('sslrootcert') ?? undefined,
		sslcert: url.searchParams.get('sslcert') ?? undefined,
		sslkey: url.searchParams.get('sslkey') ?? undefined,
	};
}

/** The mask substituted for a password when redacting a connection string for display. */
const REDACTED_PASSWORD = '****';

/**
 * Produces a display-safe form of a connection string by masking the embedded password, used as the
 * field placeholder when editing an existing connection-string connection. Handles the URL form
 * (postgresql://user:password@host/db) by parsing and re-serializing with the password masked, and
 * the key=value DSN form (password=secret) by masking the password value in place. Returns the input
 * unchanged when no password is present.
 */
function redactConnectionString(connectionString: string): string {
	// URL form: mask the password component, then re-serialize. Re-encoding is acceptable here since
	// the result is only ever shown as a read-only placeholder, never used to connect.
	try {
		const url = new URL(connectionString);
		if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
			if (!url.password) {
				return connectionString;
			}
			url.password = REDACTED_PASSWORD;
			return url.toString();
		}
	} catch {
		// Not a URL; fall through to DSN handling.
	}

	// key=value DSN form: mask the value of any password / pgpassword key, preserving the rest.
	return connectionString.replace(
		/\b(password|pgpassword)(\s*=\s*)('[^']*'|"[^"]*"|\S+)/gi,
		`$1$2${REDACTED_PASSWORD}`
	);
}

// --- Connect-time validators ---

/** Validates and returns the required TCP endpoint (host and port), throwing if either is missing. */
function requireTcpEndpoint(params: positron.DataConnectionParameterValues): { host: string; port: number } {
	const host = params.host;
	if (!isNonEmptyString(host)) {
		throw new Error(vscode.l10n.t('Host is required'));
	}
	const port = params.port;
	if (typeof port !== 'number') {
		throw new Error(vscode.l10n.t('Port is required'));
	}
	return { host, port };
}

/** Validates and returns the required database, throwing if it is missing. */
function requireDatabase(params: positron.DataConnectionParameterValues): string {
	const database = params.database;
	if (!isNonEmptyString(database)) {
		throw new Error(vscode.l10n.t('Database is required'));
	}
	return database;
}

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

	// User & password mechanism: a standard host/port/database/user/password connection.
	const passwordMechanism: positron.DataConnectionMechanism = {
		id: PASSWORD_MECHANISM_ID,
		label: vscode.l10n.t('User & Password'),
		description: vscode.l10n.t('Connect to a server over the network with a user and password.'),
		parameters: [
			...hostPortParams(),
			databaseParam(),
			userParam(),
			passwordParam(),
			sslParam(),
		],
	};

	// Example socket directory shown as a placeholder. The default location is platform-specific:
	// Debian/Ubuntu use /var/run/postgresql, while macOS (Homebrew, Postgres.app) and most other
	// builds use /tmp. This is only an example; leaving the field blank uses libpq's compiled-in default.
	const exampleSocketDirectory = process.platform === 'darwin' ? '/tmp' : '/var/run/postgresql';

	// Local-server mechanism: connect over a local Unix domain socket as the operating system account,
	// relying on the server's local socket authentication (PostgreSQL peer or trust), so no password
	// is required.
	const localServerMechanism: positron.DataConnectionMechanism = {
		id: LOCAL_SERVER_MECHANISM_ID,
		label: vscode.l10n.t('Local Server (No Password)'),
		description: vscode.l10n.t('Connect to a PostgreSQL server running on this computer using your operating system account.'),
		parameters: [
			databaseParam(),
			userParam(),
			{
				// Blank uses the platform default socket location (see exampleSocketDirectory above).
				id: 'socketDirectory',
				label: vscode.l10n.t('Socket Directory'),
				description: vscode.l10n.t('Leave empty to use the default socket location.'),
				placeholder: exampleSocketDirectory,
				type: positron.DataConnectionParameterType.File,
			},
		],
	};

	// Client-certificate mechanism: authenticate over SSL with a client certificate and key instead
	// of a password. Available on all platforms, since it runs over TCP/TLS.
	const certMechanism: positron.DataConnectionMechanism = {
		id: CERT_MECHANISM_ID,
		label: vscode.l10n.t('Client Certificate (SSL)'),
		description: vscode.l10n.t('Connect over SSL and authenticate with a client certificate.'),
		parameters: [
			...hostPortParams(),
			databaseParam(),
			userParam(),
			...clientCertParams(),
		],
	};

	// Connection-string mechanism: paste a single libpq URL or DSN. Handed to the client verbatim, so
	// it works over TCP or a local socket and is available on all platforms.
	const connectionStringMechanism: positron.DataConnectionMechanism = {
		id: CONNECTION_STRING_MECHANISM_ID,
		label: vscode.l10n.t('Connection String'),
		description: vscode.l10n.t('Connect by pasting a connection string (URL) from your database provider.'),
		parameters: [connectionStringParam()],
	};

	// Local socket authentication is only available over Unix domain sockets; Windows has no
	// equivalent (its analogue is SSPI), so only offer the local-server mechanism on macOS and Linux.
	// The password, connection-string, and client-cert mechanisms are available everywhere.
	const mechanisms = process.platform === 'win32'
		? [passwordMechanism, connectionStringMechanism, certMechanism]
		: [passwordMechanism, connectionStringMechanism, localServerMechanism, certMechanism];

	// Return the driver.
	return {
		id: 'positron-data-driver-postgresql',
		name: 'PostgreSQL',
		description: vscode.l10n.t('Connect to a PostgreSQL database server'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms,
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			switch (mechanismId) {
				case PASSWORD_MECHANISM_ID: {
					// Only the host, port, and database are required: a blank user defaults to the
					// operating system account (via PGUSER), and a blank password connects without one,
					// which works when the server does not require a password.
					const { host, port } = requireTcpEndpoint(params);
					const database = requireDatabase(params);

					// Create the connection.
					const connection = new PostgreSQLConnection({
						kind: 'fields',
						host,
						port,
						database,
						user: isNonEmptyString(params.user) ? params.user : undefined,
						password: isNonEmptyString(params.password) ? params.password : undefined,
						ssl: params.ssl === true,
					}, dataExplorerHandler);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				case LOCAL_SERVER_MECHANISM_ID: {
					// Only the database is required: a blank user defaults to the operating system
					// account, and a blank socket directory lets pg use its default.
					const database = requireDatabase(params);

					// Create the connection. No password, port, or SSL: this mechanism is local-socket only.
					const connection = new PostgreSQLConnection({
						kind: 'fields',
						host: isNonEmptyString(params.socketDirectory) ? params.socketDirectory : undefined,
						database,
						user: isNonEmptyString(params.user) ? params.user : os.userInfo().username,
					}, dataExplorerHandler);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				case CERT_MECHANISM_ID: {
					// The host, port, database, client certificate, and client key are required; the CA
					// certificate is optional and, when omitted, the server certificate is not verified.
					const { host, port } = requireTcpEndpoint(params);
					const database = requireDatabase(params);
					const sslCert = params.sslcert;
					if (!isNonEmptyString(sslCert)) {
						throw new Error(vscode.l10n.t('Client Certificate is required'));
					}
					const sslKey = params.sslkey;
					if (!isNonEmptyString(sslKey)) {
						throw new Error(vscode.l10n.t('Client Key is required'));
					}

					// Create the connection. SSL is implied by the client certificate.
					const connection = new PostgreSQLConnection({
						kind: 'fields',
						host,
						port,
						database,
						user: isNonEmptyString(params.user) ? params.user : undefined,
						ssl: true,
						sslRootCert: isNonEmptyString(params.sslrootcert) ? params.sslrootcert : undefined,
						sslCert,
						sslKey,
					}, dataExplorerHandler);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				case CONNECTION_STRING_MECHANISM_ID: {
					// The connection string is the only parameter and is handed to the client verbatim.
					const connectionString = params.connectionString;
					if (!isNonEmptyString(connectionString)) {
						throw new Error(vscode.l10n.t('Connection string is required'));
					}

					// Create the connection.
					const connection = new PostgreSQLConnection({ kind: 'connectionString', connectionString }, dataExplorerHandler);

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
				case LOCAL_SERVER_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, localServerConnectionFields(params));
				case CERT_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, certConnectionFields(params));
				case CONNECTION_STRING_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, isNonEmptyString(params.connectionString) ? parseConnectionString(params.connectionString) : undefined);
				default:
					return [];
			}
		},
		redactParameterValue(mechanismId: string, parameterId: string, value: string): string | undefined {
			// The connection string is the only parameter shown in plaintext while embedding a
			// secret, so it is the only one with a meaningful redacted preview.
			if (mechanismId === CONNECTION_STRING_MECHANISM_ID && parameterId === 'connectionString') {
				return redactConnectionString(value);
			}
			return undefined;
		},
	};
}
