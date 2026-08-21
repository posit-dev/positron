/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Databricks data connection driver. It does not authenticate: the authentication extension owns
// every Databricks credential path (interactive OAuth, DATABRICKS_TOKEN, a .databrickscfg profile,
// Workbench-managed credentials, or a personal access token), and this driver asks it for a session.
// A connection therefore collects only the two locators -- the workspace hostname and the compute
// resource's HTTP path -- plus the optional session settings (catalog, schema).

import { readFileSync } from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DatabricksConnection } from './databricksConnection.js';
import { DatabricksConnectionOptions } from './databricksClient.js';
import { DatabricksDataExplorerRpcHandler } from './databricksDataExplorerRpcHandler.js';

/** The id of the sole connection mechanism, which authenticates via the authentication extension. */
const SIGN_IN_MECHANISM_ID = 'sign-in';

/** The authentication extension's Databricks provider. */
const DATABRICKS_AUTH_PROVIDER_ID = 'databricks';

/** How long to wait for the workspace to answer the sign-in check. */
const WORKSPACE_CHECK_TIMEOUT_MS = 10_000;

/** Asks a workspace who a token belongs to, resolving to the HTTP status. Replaced in tests. */
export type WorkspaceProbe = (host: string, token: string) => Promise<number>;

/**
 * Calls the workspace's SCIM Me endpoint and resolves to its status code. Uses `https` rather than
 * `fetch` because this extension's `@types/node` predates the global, as the sibling drivers' does.
 */
function probeWorkspace(host: string, token: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const request = https.request(
			{
				host,
				path: '/api/2.0/preview/scim/v2/Me',
				method: 'GET',
				headers: { 'Authorization': `Bearer ${token}` },
				timeout: WORKSPACE_CHECK_TIMEOUT_MS,
			},
			response => {
				// The status is all this needs; drain the body so the socket can be reused.
				response.resume();
				resolve(response.statusCode ?? 0);
			}
		);
		request.on('timeout', () => request.destroy(new Error('Databricks workspace check timed out')));
		request.on('error', reject);
		request.end();
	});
}

/**
 * Fetches a bearer token from the authentication extension, prompting the user to sign in when there
 * is no session yet. Called by the SDK whenever it needs a token, so a rotated or refreshed
 * credential is picked up without reconnecting.
 */
async function getDatabricksToken(): Promise<string> {
	const session = await vscode.authentication.getSession(
		DATABRICKS_AUTH_PROVIDER_ID, [], { createIfNone: true });
	return session.accessToken;
}

/**
 * Checks that the signed-in session is actually valid for the workspace this connection targets.
 *
 * The sign-in is global to Positron but the host is chosen per connection, so the two can disagree --
 * a user signed into one workspace can point a connection at another. The token is then rejected by
 * the SQL endpoint as a bare 401, which reads as "your credentials are broken" rather than "you are
 * signed into a different workspace". Asking the target workspace who the token belongs to turns that
 * into a message naming the mismatch. This is the one check that holds for every credential path,
 * including the .databrickscfg and Workbench-managed ones whose sessions carry no host at all.
 */
export async function checkWorkspaceAccess(
	host: string,
	token: string,
	probe: WorkspaceProbe = probeWorkspace
): Promise<void> {
	let status: number;
	try {
		status = await probe(host, token);
	} catch {
		// Unreachable or timed out. Let the connection itself proceed and report the failure, rather
		// than blocking on a check that is only meant to sharpen an error message.
		return;
	}
	if (status === 401 || status === 403) {
		throw new Error(vscode.l10n.t(
			'Your Databricks sign-in is not valid for the workspace at {0}. Sign out of Databricks and sign in to that workspace, or change the Server Hostname to the workspace you are signed in to.',
			host
		));
	}
}

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

/** Normalized fields for generating connection code. */
interface DatabricksCodegenFields extends DatabricksCommonFields {
	host: string;
	httpPath: string;
}

/**
 * Renders databricks-sql-connector (the `databricks.sql` Python package) connection code. No
 * credential is embedded: the generated snippet runs in the user's own session, where the connector
 * resolves a credential itself from DATABRICKS_TOKEN, a .databrickscfg profile, or a browser sign-in.
 */
function renderPythonCode(fields: DatabricksCodegenFields): positron.ConnectionCodeVariant {
	const args: string[] = [
		`server_hostname="${escapeDoubleQuoted(fields.host)}"`,
		`http_path="${escapeDoubleQuoted(fields.httpPath)}"`,
	];
	if (fields.catalog) { args.push(`catalog="${escapeDoubleQuoted(fields.catalog)}"`); }
	if (fields.schema) { args.push(`schema="${escapeDoubleQuoted(fields.schema)}"`); }

	return {
		id: 'databricks-sql-connector',
		label: 'databricks.sql',
		code: `from databricks import sql\n\nconn = sql.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/**
 * Renders DBI/odbc connection code via the odbc package's Databricks helper. With no credentials
 * supplied, `odbc::databricks()` runs its own resolution: a .databrickscfg profile, else interactive
 * OAuth.
 */
function renderRCode(fields: DatabricksCodegenFields): positron.ConnectionCodeVariant {
	const args: string[] = [
		'odbc::databricks()',
		`workspace = "https://${escapeDoubleQuoted(fields.host)}"`,
		`httpPath = "${escapeDoubleQuoted(fields.httpPath)}"`,
	];
	if (fields.catalog) { args.push(`catalog = "${escapeDoubleQuoted(fields.catalog)}"`); }
	if (fields.schema) { args.push(`schema = "${escapeDoubleQuoted(fields.schema)}"`); }

	return {
		id: 'dbi',
		label: 'DBI',
		// R does not allow a trailing comma, so join the arguments with commas.
		code: `library(DBI)\n\ncon <- dbConnect(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\n`,
	};
}

/** Maps parameter values to normalized codegen fields, or undefined when a locator is missing. */
function codegenFields(params: positron.DataConnectionParameterValues): DatabricksCodegenFields | undefined {
	if (!isNonEmptyString(params.host) || !isNonEmptyString(params.httpPath)) {
		return undefined;
	}
	const host = parseDatabricksHost(params.host);
	const httpPath = parseDatabricksHttpPath(params.httpPath);
	if (!host || !httpPath) {
		return undefined;
	}
	return { host, httpPath, ...commonFields(params) };
}

/**
 * Generates the connection code variants for the given parameter values and language, or an empty
 * array when the language is unsupported or a locator is missing. Exported (and called by the
 * driver's `generateConnectionCode`) so it can be tested without an extension context.
 */
export function generateConnectionCode(languageId: string, params: positron.DataConnectionParameterValues): positron.ConnectionCodeVariant[] {
	const fields = codegenFields(params);
	if (!fields) {
		return [];
	}
	switch (languageId) {
		case 'python':
			return [renderPythonCode(fields)];
		case 'r':
			return [renderRCode(fields)];
		default:
			return [];
	}
}

/** Builds the normalized connection options for the given parameter values. */
function connectionConfig(params: positron.DataConnectionParameterValues): DatabricksConnectionOptions {
	return {
		host: parseDatabricksHost(params.host as string),
		httpPath: parseDatabricksHttpPath(params.httpPath as string),
		getToken: getDatabricksToken,
		...commonFields(params),
	};
}

/**
 * Validates that the required parameters are present, throwing a localized error for the first
 * missing one.
 */
export function validateRequired(params: positron.DataConnectionParameterValues): void {
	if (!isNonEmptyString(params.host)) {
		throw new Error(vscode.l10n.t('Server Hostname is required'));
	}
	if (!isNonEmptyString(params.httpPath)) {
		throw new Error(vscode.l10n.t('HTTP Path is required'));
	}
}

/**
 * Creates the Databricks DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views previewed from Databricks connections.
 * @param logger Optional diagnostic log sink, threaded to each connection.
 */
export function createDatabricksDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: DatabricksDataExplorerRpcHandler,
	logger?: positron.DataConnectionLogger
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'databricks.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	// The only mechanism: the locators, with the credential coming from the authentication extension.
	const signInMechanism: positron.DataConnectionMechanism = {
		id: SIGN_IN_MECHANISM_ID,
		label: vscode.l10n.t('Databricks'),
		description: vscode.l10n.t('Connect using your Databricks sign-in. You will be prompted to sign in if you have not already.'),
		parameters: [
			hostParameter(),
			httpPathParameter(),
			...commonParameters(),
		],
	};

	return {
		id: 'positron-data-driver-databricks',
		name: 'Databricks',
		description: vscode.l10n.t('Connect to a Databricks workspace'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [signInMechanism],
		async connect(_mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			validateRequired(params);
			const config = connectionConfig(params);
			// Sign in (prompting if needed) and confirm the session covers this workspace before
			// opening a session against it.
			await checkWorkspaceAccess(config.host, await config.getToken());
			const connection = new DatabricksConnection(config, dataExplorerHandler, logger);
			await connection.connect();
			return connection;
		},
		async generateConnectionCode(_mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			return generateConnectionCode(languageId, params);
		},
	};
}
