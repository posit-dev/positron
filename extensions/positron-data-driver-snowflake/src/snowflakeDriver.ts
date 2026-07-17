/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Snowflake data connection driver. It offers three non-interactive auth mechanisms, all backed
// by snowflake-sdk:
//   - Key Pair: an RSA private key file (+ optional passphrase), authenticator SNOWFLAKE_JWT.
//   - OAuth Client Credentials (M2M): a client id/secret and token URL; the SDK performs the token
//     exchange itself (authenticator OAUTH_CLIENT_CREDENTIALS).
//   - Programmatic Access Token (PAT): a token minted in Snowflake, supplied where a password is
//     expected (Snowflake accepts a PAT anywhere a password is accepted).
// Password auth is intentionally omitted. Every mechanism shares the same optional session settings
// (warehouse, database, schema, role) and hands off to the same reconnecting SnowflakeClient.

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { SnowflakeConnection } from './snowflakeConnection.js';
import { SnowflakeConnectionOptions } from './snowflakeClient.js';
import { SnowflakeConnectionsFileEntry, listConnectionNames, readConnectionsFile } from './snowflakeConnectionsFile.js';
import { SnowflakeDataExplorerRpcHandler } from './snowflakeDataExplorerRpcHandler.js';

/** The id of the key-pair (SNOWFLAKE_JWT) connection mechanism. */
const KEYPAIR_MECHANISM_ID = 'keypair';
/** The id of the OAuth client-credentials (machine-to-machine) connection mechanism. */
const OAUTH_CC_MECHANISM_ID = 'oauth-client-credentials';
/** The id of the programmatic-access-token connection mechanism. */
const PAT_MECHANISM_ID = 'pat';
/** The id of the mechanism that reuses a named connection from ~/.snowflake/connections.toml. */
const CONNECTIONS_FILE_MECHANISM_ID = 'connections-file';

/** The snowflake-sdk authenticator constant for key-pair auth. */
const AUTHENTICATOR_JWT = 'SNOWFLAKE_JWT';
/** The snowflake-sdk authenticator constant for the OAuth client-credentials flow. */
const AUTHENTICATOR_OAUTH_CC = 'OAUTH_CLIENT_CREDENTIALS';

/** Type guard for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Normalizes the Account field to a Snowflake account identifier. Accepts a bare identifier
 * (`myorg-myacct` or `xy12345.us-east-1`) or the full account URL the Snowflake console shows
 * (`https://myorg-myacct.snowflakecomputing.com`), stripping any scheme, path, and the
 * `.snowflakecomputing.com` suffix so pasting the console URL just works.
 */
export function parseSnowflakeAccount(input: string): string {
	let s = input.trim();
	// Strip an optional scheme (everything up to and including "://").
	const schemeIdx = s.indexOf('://');
	if (schemeIdx !== -1) {
		s = s.slice(schemeIdx + 3);
	}
	// Strip any path.
	const slashIdx = s.indexOf('/');
	if (slashIdx !== -1) {
		s = s.slice(0, slashIdx);
	}
	// Strip the account-URL host suffix, case-insensitively.
	const suffix = '.snowflakecomputing.com';
	if (s.toLowerCase().endsWith(suffix)) {
		s = s.slice(0, s.length - suffix.length);
	}
	return s;
}

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages treat
 * backslash as an escape character in double-quoted strings, so values containing backslashes or
 * quotes must be escaped. (Notably relevant here for Windows private-key paths.)
 */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The optional session settings shared by every mechanism. */
interface SnowflakeCommonFields {
	warehouse?: string;
	database?: string;
	schema?: string;
	role?: string;
}

/** Reads the optional session settings from the mechanism's parameter values. */
function commonFields(params: positron.DataConnectionParameterValues): SnowflakeCommonFields {
	return {
		warehouse: isNonEmptyString(params.warehouse) ? params.warehouse : undefined,
		database: isNonEmptyString(params.database) ? params.database : undefined,
		schema: isNonEmptyString(params.schema) ? params.schema : undefined,
		role: isNonEmptyString(params.role) ? params.role : undefined,
	};
}

/** The optional session-setting parameters, shared across all mechanisms. */
function commonParameters(): positron.DataConnectionParameter[] {
	return [
		{
			id: 'warehouse',
			label: vscode.l10n.t('Warehouse'),
			description: vscode.l10n.t('The virtual warehouse to use for queries. Optional; the account default is used when unset.'),
			type: positron.DataConnectionParameterType.String,
		},
		{
			id: 'database',
			label: vscode.l10n.t('Database'),
			description: vscode.l10n.t('The initial current database. Optional.'),
			type: positron.DataConnectionParameterType.String,
		},
		{
			id: 'schema',
			label: vscode.l10n.t('Schema'),
			description: vscode.l10n.t('The initial current schema. Optional.'),
			type: positron.DataConnectionParameterType.String,
		},
		{
			id: 'role',
			label: vscode.l10n.t('Role'),
			description: vscode.l10n.t('The role to activate for the session. Optional.'),
			type: positron.DataConnectionParameterType.String,
		},
	];
}

/** The Account parameter, shared across all mechanisms. */
function accountParameter(): positron.DataConnectionParameter {
	return {
		id: 'account',
		label: vscode.l10n.t('Account'),
		description: vscode.l10n.t('The Snowflake account identifier (e.g. myorg-myacct). You can paste the full account URL.'),
		type: positron.DataConnectionParameterType.String,
		required: true,
	};
}

// --- Normalized codegen fields ---

/** Normalized fields for generating connection code, tagged by the mechanism that produced them. */
interface SnowflakeCodegenFields extends SnowflakeCommonFields {
	mechanism: typeof KEYPAIR_MECHANISM_ID | typeof OAUTH_CC_MECHANISM_ID | typeof PAT_MECHANISM_ID;
	account: string;
	user?: string;
	privateKeyPath?: string;
	privateKeyPass?: string;
	oauthClientId?: string;
	oauthClientSecret?: string;
	oauthTokenRequestUrl?: string;
	oauthScope?: string;
	token?: string;
}

/** Renders snowflake.connector (snowflake-connector-python) connection code. */
function renderPythonCode(fields: SnowflakeCodegenFields): positron.ConnectionCodeVariant {
	const args: string[] = [`account="${escapeDoubleQuoted(fields.account)}"`];
	if (fields.user) { args.push(`user="${escapeDoubleQuoted(fields.user)}"`); }

	const notes: string[] = [];
	switch (fields.mechanism) {
		case KEYPAIR_MECHANISM_ID:
			if (fields.privateKeyPath) { args.push(`private_key_file="${escapeDoubleQuoted(fields.privateKeyPath)}"`); }
			if (fields.privateKeyPass) { args.push(`private_key_file_pwd="${escapeDoubleQuoted(fields.privateKeyPass)}"`); }
			break;
		case OAUTH_CC_MECHANISM_ID:
			args.push(`authenticator="OAUTH_CLIENT_CREDENTIALS"`);
			if (fields.oauthClientId) { args.push(`oauth_client_id="${escapeDoubleQuoted(fields.oauthClientId)}"`); }
			if (fields.oauthClientSecret) { args.push(`oauth_client_secret="${escapeDoubleQuoted(fields.oauthClientSecret)}"`); }
			if (fields.oauthTokenRequestUrl) { args.push(`oauth_token_request_url="${escapeDoubleQuoted(fields.oauthTokenRequestUrl)}"`); }
			if (fields.oauthScope) { args.push(`oauth_scope="${escapeDoubleQuoted(fields.oauthScope)}"`); }
			notes.push('# OAuth client-credentials support requires a recent snowflake-connector-python.');
			break;
		case PAT_MECHANISM_ID:
			// Snowflake accepts a programmatic access token wherever a password is expected.
			if (fields.token) { args.push(`password="${escapeDoubleQuoted(fields.token)}"`); }
			break;
	}

	if (fields.warehouse) { args.push(`warehouse="${escapeDoubleQuoted(fields.warehouse)}"`); }
	if (fields.database) { args.push(`database="${escapeDoubleQuoted(fields.database)}"`); }
	if (fields.schema) { args.push(`schema="${escapeDoubleQuoted(fields.schema)}"`); }
	if (fields.role) { args.push(`role="${escapeDoubleQuoted(fields.role)}"`); }

	const prefix = notes.length > 0 ? `${notes.join('\n')}\n` : '';
	return {
		id: 'snowflake-connector-python',
		label: 'snowflake.connector',
		code: `import snowflake.connector\n\n${prefix}conn = snowflake.connector.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/**
 * Renders DBI/odbc connection code via the odbc package's Snowflake helper. Only the mechanisms that
 * map cleanly onto the Snowflake ODBC driver are rendered (key-pair and PAT); OAuth client
 * credentials is Python-only.
 */
function renderRCode(fields: SnowflakeCodegenFields): positron.ConnectionCodeVariant | undefined {
	const args: string[] = ['odbc::snowflake()', `account = "${escapeDoubleQuoted(fields.account)}"`];
	if (fields.user) { args.push(`uid = "${escapeDoubleQuoted(fields.user)}"`); }

	switch (fields.mechanism) {
		case KEYPAIR_MECHANISM_ID:
			args.push(`authenticator = "SNOWFLAKE_JWT"`);
			if (fields.privateKeyPath) { args.push(`priv_key_file = "${escapeDoubleQuoted(fields.privateKeyPath)}"`); }
			if (fields.privateKeyPass) { args.push(`priv_key_file_pwd = "${escapeDoubleQuoted(fields.privateKeyPass)}"`); }
			break;
		case PAT_MECHANISM_ID:
			// The PAT is supplied where a password is expected.
			if (fields.token) { args.push(`pwd = "${escapeDoubleQuoted(fields.token)}"`); }
			break;
		case OAUTH_CC_MECHANISM_ID:
			// The OAuth client-credentials flow has no clean odbc::snowflake() mapping; use Python.
			return undefined;
	}

	if (fields.warehouse) { args.push(`warehouse = "${escapeDoubleQuoted(fields.warehouse)}"`); }
	if (fields.database) { args.push(`database = "${escapeDoubleQuoted(fields.database)}"`); }
	if (fields.schema) { args.push(`schema = "${escapeDoubleQuoted(fields.schema)}"`); }
	if (fields.role) { args.push(`role = "${escapeDoubleQuoted(fields.role)}"`); }

	return {
		id: 'dbi',
		label: 'DBI',
		// R does not allow a trailing comma, so join the arguments with commas.
		code: `library(DBI)\n\ncon <- dbConnect(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\n`,
	};
}

/**
 * Maps a mechanism's parameter values to normalized codegen fields, or undefined when a field
 * required for that mechanism is missing.
 */
function codegenFields(mechanismId: string, params: positron.DataConnectionParameterValues): SnowflakeCodegenFields | undefined {
	const account = isNonEmptyString(params.account) ? parseSnowflakeAccount(params.account) : undefined;
	if (!account) {
		return undefined;
	}
	const common = commonFields(params);
	const user = isNonEmptyString(params.user) ? params.user : undefined;
	switch (mechanismId) {
		case KEYPAIR_MECHANISM_ID:
			if (!user || !isNonEmptyString(params.privateKeyPath)) {
				return undefined;
			}
			return {
				mechanism: KEYPAIR_MECHANISM_ID, account, user, ...common,
				privateKeyPath: params.privateKeyPath,
				privateKeyPass: isNonEmptyString(params.privateKeyPass) ? params.privateKeyPass : undefined,
			};
		case OAUTH_CC_MECHANISM_ID:
			if (!isNonEmptyString(params.oauthClientId) || !isNonEmptyString(params.oauthClientSecret) || !isNonEmptyString(params.oauthTokenRequestUrl)) {
				return undefined;
			}
			return {
				mechanism: OAUTH_CC_MECHANISM_ID, account, user, ...common,
				oauthClientId: params.oauthClientId,
				oauthClientSecret: params.oauthClientSecret,
				oauthTokenRequestUrl: params.oauthTokenRequestUrl,
				oauthScope: isNonEmptyString(params.oauthScope) ? params.oauthScope : undefined,
			};
		case PAT_MECHANISM_ID:
			if (!user || !isNonEmptyString(params.token)) {
				return undefined;
			}
			return { mechanism: PAT_MECHANISM_ID, account, user, ...common, token: params.token };
		default:
			return undefined;
	}
}

/**
 * Generates connection code for the connections-file mechanism, which references the named connection
 * rather than inlining its fields. Only Python is emitted: snowflake-connector-python reads
 * connections.toml via `connection_name`, whereas R's odbc/DBI has no equivalent, so R yields nothing.
 */
function generateConnectionsFileCode(languageId: string, connectionName: string): positron.ConnectionCodeVariant[] {
	if (languageId !== 'python' || !connectionName) {
		return [];
	}
	return [{
		id: 'snowflake-connector-python',
		label: 'snowflake.connector',
		code: `import snowflake.connector\n\nconn = snowflake.connector.connect(\n\tconnection_name="${escapeDoubleQuoted(connectionName)}",\n)\n`,
	}];
}

/** Generates the connection code variants for the given language and normalized fields. */
function generateConnectionCodeForFields(languageId: string, fields: SnowflakeCodegenFields | undefined): positron.ConnectionCodeVariant[] {
	if (!fields) {
		return [];
	}
	switch (languageId) {
		case 'python':
			return [renderPythonCode(fields)];
		case 'r': {
			const variant = renderRCode(fields);
			return variant ? [variant] : [];
		}
		default:
			return [];
	}
}

/** Reads a key from a connections.toml entry as a non-empty string, or undefined. */
function tomlString(entry: SnowflakeConnectionsFileEntry, key: string): string | undefined {
	const value = entry[key];
	return isNonEmptyString(value) ? value : undefined;
}

/**
 * Maps a raw connections.toml entry to normalized snowflake-sdk options. Reads the connector's
 * snake_case keys (with the common aliases the SDK accepts) and passes whatever authenticator the file
 * names -- including interactive ones like `externalbrowser` -- upper-cased so the client routes it
 * correctly. Throws if the entry has no account, the one field always required.
 */
function connectionOptionsFromToml(name: string, entry: SnowflakeConnectionsFileEntry): SnowflakeConnectionOptions {
	const account = tomlString(entry, 'account');
	if (!account) {
		throw new Error(vscode.l10n.t("Connection '{0}' in connections.toml has no account.", name));
	}
	const authenticator = tomlString(entry, 'authenticator');
	return {
		account: parseSnowflakeAccount(account),
		username: tomlString(entry, 'user') ?? tomlString(entry, 'username'),
		// A PAT or OAuth token in the file is supplied where a password is expected.
		password: tomlString(entry, 'password') ?? tomlString(entry, 'token'),
		authenticator: authenticator?.toUpperCase(),
		privateKeyPath: tomlString(entry, 'private_key_file') ?? tomlString(entry, 'private_key_path'),
		privateKeyPass: tomlString(entry, 'private_key_file_pwd') ?? tomlString(entry, 'private_key_pwd'),
		warehouse: tomlString(entry, 'warehouse'),
		database: tomlString(entry, 'database'),
		schema: tomlString(entry, 'schema'),
		role: tomlString(entry, 'role'),
	};
}

/** Looks up a named connection in connections.toml, throwing a localized error if it is not found. */
function tomlConnectionEntry(name: string): SnowflakeConnectionsFileEntry {
	const entry = readConnectionsFile()[name];
	if (!entry) {
		throw new Error(vscode.l10n.t("Connection '{0}' was not found in connections.toml.", name));
	}
	return entry;
}

/** Builds the normalized snowflake-sdk connection options for a mechanism's parameter values. */
function connectionOptions(mechanismId: string, params: positron.DataConnectionParameterValues): SnowflakeConnectionOptions {
	if (mechanismId === CONNECTIONS_FILE_MECHANISM_ID) {
		const name = params.connectionName as string;
		return connectionOptionsFromToml(name, tomlConnectionEntry(name));
	}
	const account = parseSnowflakeAccount(params.account as string);
	const common = commonFields(params);
	const base: SnowflakeConnectionOptions = { account, ...common };
	switch (mechanismId) {
		case KEYPAIR_MECHANISM_ID:
			return {
				...base,
				username: params.user as string,
				authenticator: AUTHENTICATOR_JWT,
				privateKeyPath: params.privateKeyPath as string,
				privateKeyPass: isNonEmptyString(params.privateKeyPass) ? params.privateKeyPass : undefined,
			};
		case OAUTH_CC_MECHANISM_ID:
			return {
				...base,
				username: isNonEmptyString(params.user) ? params.user : undefined,
				authenticator: AUTHENTICATOR_OAUTH_CC,
				oauthClientId: params.oauthClientId as string,
				oauthClientSecret: params.oauthClientSecret as string,
				oauthTokenRequestUrl: params.oauthTokenRequestUrl as string,
				oauthScope: isNonEmptyString(params.oauthScope) ? params.oauthScope : undefined,
			};
		case PAT_MECHANISM_ID:
			// Snowflake accepts a programmatic access token wherever a password is expected, so no
			// special authenticator is set.
			return {
				...base,
				username: params.user as string,
				password: params.token as string,
			};
		default:
			throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
	}
}

/**
 * Validates that the required parameters for a mechanism are present, throwing a localized error for
 * the first missing one.
 */
function validateRequired(mechanismId: string, params: positron.DataConnectionParameterValues): void {
	// The connections-file mechanism takes a connection name rather than an account and its own
	// credentials; everything else is read from connections.toml at connect time.
	if (mechanismId === CONNECTIONS_FILE_MECHANISM_ID) {
		if (!isNonEmptyString(params.connectionName)) {
			throw new Error(vscode.l10n.t('Connection is required'));
		}
		return;
	}
	if (!isNonEmptyString(params.account)) {
		throw new Error(vscode.l10n.t('Account is required'));
	}
	switch (mechanismId) {
		case KEYPAIR_MECHANISM_ID:
			if (!isNonEmptyString(params.user)) {
				throw new Error(vscode.l10n.t('User is required'));
			}
			if (!isNonEmptyString(params.privateKeyPath)) {
				throw new Error(vscode.l10n.t('Private Key File is required'));
			}
			break;
		case OAUTH_CC_MECHANISM_ID:
			if (!isNonEmptyString(params.oauthClientId)) {
				throw new Error(vscode.l10n.t('Client ID is required'));
			}
			if (!isNonEmptyString(params.oauthClientSecret)) {
				throw new Error(vscode.l10n.t('Client Secret is required'));
			}
			if (!isNonEmptyString(params.oauthTokenRequestUrl)) {
				throw new Error(vscode.l10n.t('Token Request URL is required'));
			}
			break;
		case PAT_MECHANISM_ID:
			if (!isNonEmptyString(params.user)) {
				throw new Error(vscode.l10n.t('User is required'));
			}
			if (!isNonEmptyString(params.token)) {
				throw new Error(vscode.l10n.t('Token is required'));
			}
			break;
		default:
			throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
	}
}

/**
 * Creates the Snowflake DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views previewed from Snowflake connections.
 */
export function createSnowflakeDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: SnowflakeDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'snowflake.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	const userParameter = (required: boolean): positron.DataConnectionParameter => ({
		id: 'user',
		label: vscode.l10n.t('User'),
		type: positron.DataConnectionParameterType.String,
		required,
	});

	// Key Pair (SNOWFLAKE_JWT): account, user, private key file, optional passphrase.
	const keyPairMechanism: positron.DataConnectionMechanism = {
		id: KEYPAIR_MECHANISM_ID,
		label: vscode.l10n.t('Key Pair'),
		description: vscode.l10n.t('Connect with an RSA private key file (key-pair / JWT authentication).'),
		parameters: [
			accountParameter(),
			userParameter(true),
			{
				id: 'privateKeyPath',
				label: vscode.l10n.t('Private Key File'),
				description: vscode.l10n.t('Path to the PEM-encoded private key file.'),
				type: positron.DataConnectionParameterType.File,
				filters: { 'Private Key Files': ['pem', 'p8', 'key'] },
				required: true,
			},
			{
				id: 'privateKeyPass',
				label: vscode.l10n.t('Private Key Passphrase'),
				description: vscode.l10n.t('Passphrase protecting the private key file, if any.'),
				type: positron.DataConnectionParameterType.Password,
				secret: true,
			},
			...commonParameters(),
		],
	};

	// OAuth Client Credentials (machine-to-machine): client id/secret and token URL.
	const oauthCcMechanism: positron.DataConnectionMechanism = {
		id: OAUTH_CC_MECHANISM_ID,
		label: vscode.l10n.t('OAuth Client Credentials'),
		description: vscode.l10n.t('Connect with a machine-to-machine OAuth client (client credentials grant).'),
		parameters: [
			accountParameter(),
			{
				id: 'oauthClientId',
				label: vscode.l10n.t('Client ID'),
				type: positron.DataConnectionParameterType.String,
				required: true,
			},
			{
				id: 'oauthClientSecret',
				label: vscode.l10n.t('Client Secret'),
				type: positron.DataConnectionParameterType.Password,
				secret: true,
				required: true,
			},
			{
				id: 'oauthTokenRequestUrl',
				label: vscode.l10n.t('Token Request URL'),
				description: vscode.l10n.t('The OAuth token endpoint the client-credentials grant posts to.'),
				type: positron.DataConnectionParameterType.String,
				required: true,
			},
			{
				id: 'oauthScope',
				label: vscode.l10n.t('Scope'),
				description: vscode.l10n.t('The OAuth scope requested for the token, if any.'),
				type: positron.DataConnectionParameterType.String,
			},
			userParameter(false),
			...commonParameters(),
		],
	};

	// Programmatic Access Token: a token minted in Snowflake, supplied like a password.
	const patMechanism: positron.DataConnectionMechanism = {
		id: PAT_MECHANISM_ID,
		label: vscode.l10n.t('Programmatic Access Token'),
		description: vscode.l10n.t('Connect with a programmatic access token (PAT) minted in Snowflake.'),
		parameters: [
			accountParameter(),
			userParameter(true),
			{
				id: 'token',
				label: vscode.l10n.t('Token'),
				description: vscode.l10n.t('The programmatic access token.'),
				type: positron.DataConnectionParameterType.Password,
				secret: true,
				required: true,
			},
			...commonParameters(),
		],
	};

	// Connections File: reuse a named connection already configured in
	// ~/.snowflake/connections.toml. Only offered when the file defines at least one connection;
	// the names are read at registration time (a window reload picks up later edits).
	const connectionNames = listConnectionNames();
	const connectionsFileMechanism: positron.DataConnectionMechanism | undefined = connectionNames.length > 0 ? {
		id: CONNECTIONS_FILE_MECHANISM_ID,
		label: vscode.l10n.t('Connections File'),
		description: vscode.l10n.t('Reuse a named connection from your ~/.snowflake/connections.toml file.'),
		parameters: [
			{
				id: 'connectionName',
				label: vscode.l10n.t('Connection'),
				description: vscode.l10n.t('The named connection to use from connections.toml.'),
				type: positron.DataConnectionParameterType.Option,
				options: connectionNames,
				required: true,
			},
		],
	} : undefined;

	// Order: the connections file first (when present) since it reuses credentials the user has
	// already configured, then Programmatic Access Token, then Key Pair, then the machine-to-machine
	// OAuth client-credentials flow.
	const mechanisms = [patMechanism, keyPairMechanism, oauthCcMechanism];
	if (connectionsFileMechanism) {
		mechanisms.unshift(connectionsFileMechanism);
	}

	return {
		id: 'positron-data-driver-snowflake',
		name: 'Snowflake',
		description: vscode.l10n.t('Connect to a Snowflake account'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms,
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			validateRequired(mechanismId, params);
			const connection = new SnowflakeConnection(connectionOptions(mechanismId, params), dataExplorerHandler);
			await connection.connect();
			return connection;
		},
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			if (mechanismId === CONNECTIONS_FILE_MECHANISM_ID) {
				return generateConnectionsFileCode(languageId, params.connectionName as string);
			}
			return generateConnectionCodeForFields(languageId, codegenFields(mechanismId, params));
		},
	};
}
