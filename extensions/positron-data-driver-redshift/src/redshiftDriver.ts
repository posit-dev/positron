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
import { RedshiftIamConfig } from './redshiftIamCredentials.js';

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
 * Which flavour of Redshift an endpoint points at. The two mint temporary credentials through
 * different APIs -- `redshift-serverless:GetCredentials` keyed on a workgroup, versus
 * `redshift:GetClusterCredentials` keyed on a cluster identifier -- so IAM authorization has to know
 * which one it is talking to before it can ask for anything.
 */
export type RedshiftEndpointKind = 'serverless' | 'provisioned' | 'unknown';

/**
 * The IAM-relevant identifiers carried by a Redshift endpoint hostname. AWS encodes the workgroup
 * (or cluster) and its region into the endpoint itself:
 *
 *     <workgroup>.<account>.<region>.redshift-serverless.amazonaws.com
 *     <cluster>.<id>.<region>.redshift.amazonaws.com
 *
 * so pasting the console endpoint already supplies everything the credential call needs, and the
 * user is never asked to restate which flavour of Redshift they are on. Both fields are left
 * undefined for a host that is not a recognizable AWS endpoint -- an SSH tunnel, a proxy, a private
 * DNS alias -- so the caller can fall back to asking rather than guessing wrong.
 */
export interface RedshiftEndpointDetails {
	kind: RedshiftEndpointKind;
	/** The workgroup name (serverless) or cluster identifier (provisioned). */
	name?: string;
	/**
	 * The region hosting the workgroup or cluster. Note this is not necessarily the region the
	 * caller authenticates against: with IAM Identity Center, the SSO region is configured in the
	 * AWS profile and is unrelated to where the workgroup lives.
	 */
	region?: string;
}

/**
 * Extracts the flavour, name, and region from a Redshift endpoint hostname. Takes the bare host, so
 * run the input through parseRedshiftEndpoint() first if it may carry a port or database.
 */
export function describeRedshiftEndpoint(host: string): RedshiftEndpointDetails {
	const labels = host.trim().toLowerCase().split('.');

	// Anchor on the AWS domain rather than searching for the service label. Two reasons: a private
	// host that merely contains a `redshift` label (warehouse.corp.redshift.example.com) must not
	// be mistaken for an endpoint and have `corp` sent to AWS as a region; and a workgroup whose
	// own name happens to be `redshift` must not shadow the real service label. Matching the
	// `amazonaws` label instead of a full suffix keeps the regional variants (amazonaws.com.cn,
	// GovCloud) working without enumerating them.
	const suffix = labels.slice(-3).join('.');
	if (suffix !== 'amazonaws.com.cn' && labels.slice(-2).join('.') !== 'amazonaws.com') {
		return { kind: 'unknown' };
	}

	// The service label always sits immediately before `amazonaws`, the region before that, and the
	// workgroup or cluster name is the first label.
	const serviceIndex = labels.lastIndexOf('amazonaws') - 1;
	const service = labels[serviceIndex];
	if (serviceIndex < 2 || (service !== 'redshift-serverless' && service !== 'redshift')) {
		return { kind: 'unknown' };
	}
	return {
		kind: service === 'redshift-serverless' ? 'serverless' : 'provisioned',
		name: labels[0] || undefined,
		region: labels[serviceIndex - 1] || undefined,
	};
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
 * The id of the AWS IAM connection mechanism. One mechanism covers both serverless workgroups and
 * provisioned clusters: the endpoint says which is which, so there is nothing for the user to pick
 * between, and two near-identical entries in the mechanism list would only invite picking wrong.
 */
const IAM_MECHANISM_ID = 'iam';

/**
 * Resolves the AWS target from the connection parameters, or explains why it could not. IAM needs
 * the flavour, name, and region, all of which are encoded in a standard Redshift endpoint; a host
 * that is not one (an SSH tunnel, a proxy, a private DNS alias) cannot be resolved and is reported
 * rather than guessed at.
 */
export function iamTargetFromParams(params: positron.DataConnectionParameterValues): { host: string; port: number; database: string; iam: RedshiftIamConfig } {
	const hostInput = params.host;
	if (!isNonEmptyString(hostInput)) {
		throw new Error(vscode.l10n.t('Host is required'));
	}
	const databaseInput = params.database;
	if (!isNonEmptyString(databaseInput)) {
		throw new Error(vscode.l10n.t('Database is required'));
	}
	const endpoint = parseRedshiftEndpoint(hostInput);
	const details = describeRedshiftEndpoint(endpoint.host);
	if (details.kind === 'unknown' || !details.name || !details.region) {
		throw new Error(vscode.l10n.t("'{0}' is not a recognized Redshift endpoint, so the workgroup or cluster to request credentials for cannot be determined. Paste the endpoint shown in the AWS console, or use the User & Password mechanism.", endpoint.host));
	}
	const database = endpoint.database ?? databaseInput;
	// Provisioned clusters mint credentials for a named database user; serverless derives the user
	// from the IAM identity, so the field is ignored there.
	const dbUser = isNonEmptyString(params.dbUser) ? params.dbUser : undefined;
	if (details.kind === 'provisioned' && !dbUser) {
		throw new Error(vscode.l10n.t("'{0}' is a provisioned cluster, which requires a database user.", details.name));
	}
	return {
		host: endpoint.host,
		port: endpoint.port ?? (typeof params.port === 'number' ? params.port : DEFAULT_PORT),
		database,
		iam: {
			kind: details.kind,
			name: details.name,
			region: details.region,
			database,
			profile: isNonEmptyString(params.profile) ? params.profile : undefined,
			dbUser,
		},
	};
}

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
 * Renders redshift_connector code for IAM. The library mints the credentials itself given `iam=True`
 * plus the target, so no user or password appears in the generated code -- which is the point: the
 * snippet stays valid after the temporary credentials behind the live connection have expired.
 */
export function renderIamRedshiftConnectorCode(host: string, port: number, iam: RedshiftIamConfig, ssl?: boolean): positron.ConnectionCodeVariant {
	const args: string[] = ['iam=True'];
	if (iam.kind === 'serverless') {
		args.push('is_serverless=True');
		args.push(`serverless_work_group="${escapeDoubleQuoted(iam.name)}"`);
	} else {
		args.push(`cluster_identifier="${escapeDoubleQuoted(iam.name)}"`);
		if (iam.dbUser) { args.push(`db_user="${escapeDoubleQuoted(iam.dbUser)}"`); }
	}
	args.push(`region="${escapeDoubleQuoted(iam.region)}"`);
	args.push(`host="${escapeDoubleQuoted(host)}"`);
	args.push(`port=${port}`);
	args.push(`database="${escapeDoubleQuoted(iam.database)}"`);
	if (iam.profile) { args.push(`profile="${escapeDoubleQuoted(iam.profile)}"`); }
	if (ssl === false) { args.push(`ssl=False`); }
	return {
		id: 'redshift_connector',
		label: 'redshift_connector',
		code: `import redshift_connector\n\nconn = redshift_connector.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/**
 * Renders DBI/RPostgres code for IAM. RPostgres has no IAM support of its own -- it only takes a
 * password -- so the snippet mints credentials with paws first and feeds the returned user and
 * password into the ordinary connection. Note the user comes from the response rather than being
 * chosen, exactly as it does for the live connection.
 */
export function renderIamDbiCode(host: string, port: number, iam: RedshiftIamConfig, ssl?: boolean): positron.ConnectionCodeVariant {
	const profileLine = iam.profile
		? `Sys.setenv(AWS_PROFILE = "${escapeDoubleQuoted(iam.profile)}")\n\n`
		: '';
	const credentials = iam.kind === 'serverless'
		? `creds <- paws::redshiftserverless(\n\tconfig = list(region = "${escapeDoubleQuoted(iam.region)}")\n)$get_credentials(\n\tworkgroupName = "${escapeDoubleQuoted(iam.name)}",\n\tdbName = "${escapeDoubleQuoted(iam.database)}"\n)\n`
		: `creds <- paws::redshift(\n\tconfig = list(region = "${escapeDoubleQuoted(iam.region)}")\n)$get_cluster_credentials(\n\tClusterIdentifier = "${escapeDoubleQuoted(iam.name)}",\n\tDbUser = "${escapeDoubleQuoted(iam.dbUser ?? '')}",\n\tDbName = "${escapeDoubleQuoted(iam.database)}"\n)\n`;
	const user = iam.kind === 'serverless' ? 'creds$dbUser' : 'creds$DbUser';
	const password = iam.kind === 'serverless' ? 'creds$dbPassword' : 'creds$DbPassword';
	const args: string[] = [
		'RPostgres::Postgres()',
		`host = "${escapeDoubleQuoted(host)}"`,
		`port = ${port}`,
		`dbname = "${escapeDoubleQuoted(iam.database)}"`,
		`user = ${user}`,
		`password = ${password}`,
	];
	if (ssl !== false) { args.push(`sslmode = "require"`); }
	return {
		id: 'dbi',
		label: 'DBI',
		// R does not allow a trailing comma, so join the arguments with commas.
		code: `library(paws)\nlibrary(DBI)\n\n${profileLine}${credentials}\ncon <- dbConnect(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\n`,
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
 * @param logger Optional diagnostic log sink, threaded to each connection.
 */
export function createRedshiftDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: RedshiftDataExplorerRpcHandler,
	logger?: positron.DataConnectionLogger
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

	// AWS IAM mechanism. Deliberately shorter than the password mechanism: the workgroup or cluster
	// name and its region are read out of the endpoint, and the database user is returned by AWS
	// rather than chosen, so the only things left to ask for are where to connect and which AWS
	// profile to authenticate with.
	const iamMechanism: positron.DataConnectionMechanism = {
		id: IAM_MECHANISM_ID,
		label: vscode.l10n.t('AWS IAM'),
		description: vscode.l10n.t('Connect using temporary credentials from your AWS identity. No database password is needed.'),
		parameters: [
			{
				id: 'host',
				label: vscode.l10n.t('Host'),
				description: vscode.l10n.t('The cluster or workgroup endpoint, as shown in the AWS console. The workgroup or cluster name and its region are read from it.'),
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
				id: 'profile',
				label: vscode.l10n.t('AWS Profile'),
				description: vscode.l10n.t('The profile to authenticate with. Leave empty to use the default AWS credential chain.'),
				type: positron.DataConnectionParameterType.String,
			},
			{
				id: 'dbUser',
				label: vscode.l10n.t('Database User'),
				description: vscode.l10n.t('Only for provisioned clusters, which mint credentials for a named user. Serverless workgroups derive the user from your AWS identity, so leave this empty.'),
				type: positron.DataConnectionParameterType.String,
			},
			{
				id: 'ssl',
				label: vscode.l10n.t('Use SSL'),
				type: positron.DataConnectionParameterType.Boolean,
				// The temporary credential travels as the connection password, so encryption is not
				// optional in practice.
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
		mechanisms: [passwordMechanism, iamMechanism],
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
					}, dataExplorerHandler, logger);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				case IAM_MECHANISM_ID: {
					// The endpoint identifies the workgroup or cluster; AWS supplies the user and
					// password, minted fresh on each connect by the connection's credential provider.
					const target = iamTargetFromParams(params);
					const connection = new RedshiftConnection({
						kind: 'iam',
						host: target.host,
						port: target.port,
						database: target.database,
						user: '',
						ssl: params.ssl !== false,
						iam: target.iam,
					}, dataExplorerHandler, logger);
					await connection.connect();
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
				case IAM_MECHANISM_ID: {
					// Code generation runs against whatever is currently typed in the dialog, which
					// may not yet resolve to an AWS target. Offer nothing rather than a broken
					// snippet until it does.
					let target;
					try {
						target = iamTargetFromParams(params);
					} catch {
						return [];
					}
					switch (languageId) {
						case 'python':
							return [renderIamRedshiftConnectorCode(target.host, target.port, target.iam, params.ssl !== false)];
						case 'r':
							return [renderIamDbiCode(target.host, target.port, target.iam, params.ssl !== false)];
						default:
							return [];
					}
				}
				default:
					return [];
			}
		},
	};
}
