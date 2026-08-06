/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Databricks data connection driver. It offers the three auth mechanisms Databricks documents for
// SQL clients, all backed by @databricks/sql:
//   - Personal Access Token (PAT): a token minted in the workspace, sent as a bearer token.
//   - OAuth User-to-Machine (U2M): interactive sign-in; the SDK opens the system browser and
//     completes the authorization-code flow on a loopback redirect.
//   - OAuth Machine-to-Machine (M2M): a service principal's client id and secret, exchanged for a
//     token with no user interaction.
// Every mechanism takes the same two locators -- the workspace hostname and the compute resource's
// HTTP path -- plus the same optional session settings (catalog, schema), and hands off to the same
// reconnecting DatabricksClient.

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DatabricksConnection } from './databricksConnection.js';
import { DatabricksAuthType, DatabricksConnectionOptions } from './databricksClient.js';
import { DatabricksDataExplorerRpcHandler } from './databricksDataExplorerRpcHandler.js';

/** The id of the personal-access-token connection mechanism. */
const PAT_MECHANISM_ID = 'pat';
/** The id of the OAuth user-to-machine (interactive browser) connection mechanism. */
const OAUTH_U2M_MECHANISM_ID = 'oauth-u2m';
/** The id of the OAuth machine-to-machine (service principal) connection mechanism. */
const OAUTH_M2M_MECHANISM_ID = 'oauth-m2m';

/** Maps a mechanism id to the auth flow the client should use. */
const MECHANISM_AUTH_TYPES = new Map<string, DatabricksAuthType>([
	[PAT_MECHANISM_ID, 'pat'],
	[OAUTH_U2M_MECHANISM_ID, 'u2m'],
	[OAUTH_M2M_MECHANISM_ID, 'm2m'],
]);

/** Type guard for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Normalizes the Server Hostname field to a bare hostname. Accepts a bare hostname
 * (`dbc-abc123.cloud.databricks.com`), a full workspace URL
 * (`https://adb-1234.5.azuredatabricks.net/?o=1234`), or either with a trailing path, and strips the
 * scheme, any path or query, and an explicit port (the SDK supplies its own). So pasting whichever
 * form the browser shows just works.
 */
export function parseDatabricksHost(input: string): string {
	let s = input.trim();
	// Strip an optional scheme (everything up to and including "://").
	const schemeIdx = s.indexOf('://');
	if (schemeIdx !== -1) {
		s = s.slice(schemeIdx + 3);
	}
	// Cut at the first path, query, or fragment delimiter -- the host is everything before it.
	const stopIdx = s.search(/[/?#]/);
	if (stopIdx !== -1) {
		s = s.slice(0, stopIdx);
	}
	// Drop an explicit port; @databricks/sql takes the port as its own option and defaults to 443.
	const colonIdx = s.indexOf(':');
	return colonIdx !== -1 ? s.slice(0, colonIdx) : s;
}

/**
 * Normalizes the HTTP Path field to the form @databricks/sql expects. Accepts:
 *   - an API path, returned unchanged (`/sql/1.0/warehouses/abc123`, or an all-purpose cluster's
 *     `/sql/protocolv1/o/<workspace>/<cluster>`), with a missing leading slash added;
 *   - a bare warehouse id (`abc123def456`), expanded to the warehouse path;
 *   - a warehouse URL or console path copied from the Databricks UI
 *     (`https://host/sql/warehouses/abc123`), whose `/sql/warehouses/` prefix is rewritten to the
 *     API's `/sql/1.0/warehouses/`.
 * A `?o=<workspace-id>` query is preserved, since the SDK reads it for account-level routing.
 */
export function parseDatabricksHttpPath(input: string): string {
	let s = input.trim();
	// A full URL: keep only its path (and query), discarding scheme and host.
	const schemeIdx = s.indexOf('://');
	if (schemeIdx !== -1) {
		const afterScheme = s.slice(schemeIdx + 3);
		const slashIdx = afterScheme.indexOf('/');
		s = slashIdx === -1 ? '' : afterScheme.slice(slashIdx);
	}
	if (s.length === 0) {
		return '';
	}
	// A bare warehouse id has no path separator at all; expand it to the full warehouse path.
	if (!s.includes('/')) {
		return `/sql/1.0/warehouses/${s}`;
	}
	if (!s.startsWith('/')) {
		s = `/${s}`;
	}
	// Drop a trailing slash so the path matches the canonical form.
	if (s.length > 1 && s.endsWith('/')) {
		s = s.slice(0, -1);
	}
	// The UI's warehouse URL omits the API version; the SQL endpoint requires it.
	return s.replace(/^\/sql\/warehouses\//, '/sql/1.0/warehouses/');
}

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages treat
 * backslash as an escape character in double-quoted strings, so values containing backslashes or
 * quotes must be escaped.
 */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The optional session settings shared by every mechanism. */
interface DatabricksCommonFields {
	catalog?: string;
	schema?: string;
}

/** Reads the optional session settings from the mechanism's parameter values. */
function commonFields(params: positron.DataConnectionParameterValues): DatabricksCommonFields {
	return {
		catalog: isNonEmptyString(params.catalog) ? params.catalog : undefined,
		schema: isNonEmptyString(params.schema) ? params.schema : undefined,
	};
}

/** The optional session-setting parameters, shared across all mechanisms. */
function commonParameters(): positron.DataConnectionParameter[] {
	return [
		{
			id: 'catalog',
			label: vscode.l10n.t('Catalog'),
			description: vscode.l10n.t('The initial current catalog. Optional; the workspace default is used when unset.'),
			type: positron.DataConnectionParameterType.String,
		},
		{
			id: 'schema',
			label: vscode.l10n.t('Schema'),
			description: vscode.l10n.t('The initial current schema. Optional.'),
			type: positron.DataConnectionParameterType.String,
		},
	];
}

/** The Server Hostname parameter, shared across all mechanisms. */
function hostParameter(): positron.DataConnectionParameter {
	return {
		id: 'host',
		label: vscode.l10n.t('Server Hostname'),
		description: vscode.l10n.t('The workspace hostname (e.g. dbc-a1b2c3d4.cloud.databricks.com). You can paste the full workspace URL.'),
		type: positron.DataConnectionParameterType.String,
		placeholder: '<workspace>.cloud.databricks.com',
		required: true,
	};
}

/** The HTTP Path parameter, shared across all mechanisms. */
function httpPathParameter(): positron.DataConnectionParameter {
	return {
		id: 'httpPath',
		label: vscode.l10n.t('HTTP Path'),
		description: vscode.l10n.t("The SQL warehouse or cluster's HTTP path. You can paste the warehouse URL or its id."),
		type: positron.DataConnectionParameterType.String,
		placeholder: '/sql/1.0/warehouses/<warehouse-id>',
		required: true,
	};
}

// --- Normalized codegen fields ---

/** Normalized fields for generating connection code, tagged by the mechanism that produced them. */
interface DatabricksCodegenFields extends DatabricksCommonFields {
	mechanism: typeof PAT_MECHANISM_ID | typeof OAUTH_U2M_MECHANISM_ID | typeof OAUTH_M2M_MECHANISM_ID;
	host: string;
	httpPath: string;
	token?: string;
	clientId?: string;
	clientSecret?: string;
}

/** Renders databricks-sql-connector (the `databricks.sql` Python package) connection code. */
function renderPythonCode(fields: DatabricksCodegenFields): positron.ConnectionCodeVariant {
	const imports = ['from databricks import sql'];
	const prelude: string[] = [];
	const args: string[] = [
		`server_hostname="${escapeDoubleQuoted(fields.host)}"`,
		`http_path="${escapeDoubleQuoted(fields.httpPath)}"`,
	];

	switch (fields.mechanism) {
		case PAT_MECHANISM_ID:
			if (fields.token) { args.push(`access_token="${escapeDoubleQuoted(fields.token)}"`); }
			break;
		case OAUTH_U2M_MECHANISM_ID:
			// The connector opens the system browser to complete sign-in.
			args.push('auth_type="databricks-oauth"');
			break;
		case OAUTH_M2M_MECHANISM_ID:
			// The connector has no inline client-credentials option; it takes a credentials provider
			// built from the SDK's Config, which performs the token exchange.
			imports.push('from databricks.sdk.core import Config, oauth_service_principal');
			prelude.push(
				'def credential_provider():',
				'\tconfig = Config(',
				`\t\thost="https://${escapeDoubleQuoted(fields.host)}",`,
				`\t\tclient_id="${escapeDoubleQuoted(fields.clientId ?? '')}",`,
				`\t\tclient_secret="${escapeDoubleQuoted(fields.clientSecret ?? '')}",`,
				'\t)',
				'\treturn oauth_service_principal(config)',
			);
			args.push('credentials_provider=credential_provider');
			break;
	}

	if (fields.catalog) { args.push(`catalog="${escapeDoubleQuoted(fields.catalog)}"`); }
	if (fields.schema) { args.push(`schema="${escapeDoubleQuoted(fields.schema)}"`); }

	const preludeBlock = prelude.length > 0 ? `${prelude.join('\n')}\n\n` : '';
	return {
		id: 'databricks-sql-connector',
		label: 'databricks.sql',
		code: `${imports.join('\n')}\n\n${preludeBlock}conn = sql.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/**
 * Renders DBI/odbc connection code via the odbc package's Databricks helper. The machine-to-machine
 * flow is Python-only: `odbc::databricks()` reads a service principal's credentials from the
 * environment (DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET) rather than from inline arguments, so
 * there is nothing faithful to generate for it.
 */
function renderRCode(fields: DatabricksCodegenFields): positron.ConnectionCodeVariant | undefined {
	if (fields.mechanism === OAUTH_M2M_MECHANISM_ID) {
		return undefined;
	}
	const args: string[] = [
		'odbc::databricks()',
		`workspace = "https://${escapeDoubleQuoted(fields.host)}"`,
		`httpPath = "${escapeDoubleQuoted(fields.httpPath)}"`,
	];
	if (fields.mechanism === PAT_MECHANISM_ID && fields.token) {
		// The Databricks ODBC driver takes a personal access token as the password, with the literal
		// user name "token".
		args.push('uid = "token"', `pwd = "${escapeDoubleQuoted(fields.token)}"`);
	}
	// With no credentials supplied, odbc::databricks() runs the interactive OAuth (U2M) flow itself.
	if (fields.catalog) { args.push(`catalog = "${escapeDoubleQuoted(fields.catalog)}"`); }
	if (fields.schema) { args.push(`schema = "${escapeDoubleQuoted(fields.schema)}"`); }

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
function codegenFields(mechanismId: string, params: positron.DataConnectionParameterValues): DatabricksCodegenFields | undefined {
	if (!isNonEmptyString(params.host) || !isNonEmptyString(params.httpPath)) {
		return undefined;
	}
	const host = parseDatabricksHost(params.host);
	const httpPath = parseDatabricksHttpPath(params.httpPath);
	if (!host || !httpPath) {
		return undefined;
	}
	const common = commonFields(params);
	switch (mechanismId) {
		case PAT_MECHANISM_ID:
			if (!isNonEmptyString(params.token)) {
				return undefined;
			}
			return { mechanism: PAT_MECHANISM_ID, host, httpPath, ...common, token: params.token };
		case OAUTH_U2M_MECHANISM_ID:
			// Only the locators are needed; the browser sign-in establishes the identity.
			return { mechanism: OAUTH_U2M_MECHANISM_ID, host, httpPath, ...common };
		case OAUTH_M2M_MECHANISM_ID:
			if (!isNonEmptyString(params.clientId) || !isNonEmptyString(params.clientSecret)) {
				return undefined;
			}
			return {
				mechanism: OAUTH_M2M_MECHANISM_ID, host, httpPath, ...common,
				clientId: params.clientId,
				clientSecret: params.clientSecret,
			};
		default:
			return undefined;
	}
}

/**
 * Generates the connection code variants for a mechanism's parameter values in the given language, or
 * an empty array when the language is unsupported or a required parameter is missing. Exported (and
 * called by the driver's `generateConnectionCode`) so it can be tested without an extension context.
 */
export function generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): positron.ConnectionCodeVariant[] {
	return generateConnectionCodeForFields(languageId, codegenFields(mechanismId, params));
}

/** Generates the connection code variants for the given language and normalized fields. */
function generateConnectionCodeForFields(languageId: string, fields: DatabricksCodegenFields | undefined): positron.ConnectionCodeVariant[] {
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

/** Builds the normalized connection options for a mechanism's parameter values. */
function connectionConfig(mechanismId: string, params: positron.DataConnectionParameterValues): DatabricksConnectionOptions {
	const authType = MECHANISM_AUTH_TYPES.get(mechanismId);
	if (!authType) {
		throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
	}
	const base: DatabricksConnectionOptions = {
		host: parseDatabricksHost(params.host as string),
		httpPath: parseDatabricksHttpPath(params.httpPath as string),
		authType,
		...commonFields(params),
	};
	switch (mechanismId) {
		case PAT_MECHANISM_ID:
			return { ...base, token: params.token as string };
		case OAUTH_U2M_MECHANISM_ID:
			return base;
		case OAUTH_M2M_MECHANISM_ID:
			return {
				...base,
				clientId: params.clientId as string,
				clientSecret: params.clientSecret as string,
			};
		default:
			throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
	}
}

/**
 * Validates that the required parameters for a mechanism are present, throwing a localized error for
 * the first missing one.
 */
export function validateRequired(mechanismId: string, params: positron.DataConnectionParameterValues): void {
	if (!isNonEmptyString(params.host)) {
		throw new Error(vscode.l10n.t('Server Hostname is required'));
	}
	if (!isNonEmptyString(params.httpPath)) {
		throw new Error(vscode.l10n.t('HTTP Path is required'));
	}
	switch (mechanismId) {
		case PAT_MECHANISM_ID:
			if (!isNonEmptyString(params.token)) {
				throw new Error(vscode.l10n.t('Access Token is required'));
			}
			break;
		case OAUTH_U2M_MECHANISM_ID:
			// Only the locators are required; the browser sign-in establishes the identity.
			break;
		case OAUTH_M2M_MECHANISM_ID:
			if (!isNonEmptyString(params.clientId)) {
				throw new Error(vscode.l10n.t('Client ID is required'));
			}
			if (!isNonEmptyString(params.clientSecret)) {
				throw new Error(vscode.l10n.t('Client Secret is required'));
			}
			break;
		default:
			throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
	}
}

/**
 * Creates the Databricks DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views previewed from Databricks connections.
 */
export function createDatabricksDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: DatabricksDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'databricks.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	// Personal Access Token: a token minted in the workspace, sent as a bearer token.
	const patMechanism: positron.DataConnectionMechanism = {
		id: PAT_MECHANISM_ID,
		label: vscode.l10n.t('Personal Access Token'),
		description: vscode.l10n.t('Connect with a personal access token generated in your Databricks workspace.'),
		parameters: [
			hostParameter(),
			httpPathParameter(),
			{
				id: 'token',
				label: vscode.l10n.t('Access Token'),
				description: vscode.l10n.t('The personal access token.'),
				type: positron.DataConnectionParameterType.Password,
				secret: true,
				required: true,
			},
			...commonParameters(),
		],
	};

	// OAuth User-to-Machine: interactive sign-in through the system browser.
	const u2mMechanism: positron.DataConnectionMechanism = {
		id: OAUTH_U2M_MECHANISM_ID,
		label: vscode.l10n.t('OAuth User-to-Machine (U2M)'),
		description: vscode.l10n.t('Sign in interactively through your web browser.'),
		parameters: [
			hostParameter(),
			httpPathParameter(),
			...commonParameters(),
		],
	};

	// OAuth Machine-to-Machine: a service principal's client id and secret.
	const m2mMechanism: positron.DataConnectionMechanism = {
		id: OAUTH_M2M_MECHANISM_ID,
		label: vscode.l10n.t('OAuth Machine-to-Machine (M2M)'),
		description: vscode.l10n.t("Connect as a service principal using its OAuth client id and secret."),
		parameters: [
			hostParameter(),
			httpPathParameter(),
			{
				id: 'clientId',
				label: vscode.l10n.t('Client ID'),
				description: vscode.l10n.t("The service principal's application (client) id."),
				type: positron.DataConnectionParameterType.String,
				required: true,
			},
			{
				id: 'clientSecret',
				label: vscode.l10n.t('Client Secret'),
				description: vscode.l10n.t("The service principal's OAuth secret."),
				type: positron.DataConnectionParameterType.Password,
				secret: true,
				required: true,
			},
			...commonParameters(),
		],
	};

	// Dialog order: the token flow leads (it needs no identity-provider round-trip), then interactive
	// sign-in, then the service-principal flow.
	const mechanisms = [patMechanism, u2mMechanism, m2mMechanism];

	return {
		id: 'positron-data-driver-databricks',
		name: 'Databricks',
		description: vscode.l10n.t('Connect to a Databricks workspace'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms,
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			validateRequired(mechanismId, params);
			const connection = new DatabricksConnection(connectionConfig(mechanismId, params), dataExplorerHandler);
			await connection.connect();
			return connection;
		},
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			return generateConnectionCode(mechanismId, languageId, params);
		},
	};
}
