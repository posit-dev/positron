/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Positron drivers this extension registers.
//
// There is always a generic "ODBC" driver, which can reach anything the machine has an ODBC driver
// or DSN for. On top of that, one driver is registered per *recognized* database whose ODBC driver
// is installed -- so a machine with the MySQL connector gets a "MySQL" entry in the New Connection
// list, and the user never has to know it is ODBC underneath. See odbcDatabases.ts for the mapping
// and for why the databases Positron already has a native driver for are excluded.

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { buildConnectionString, describeConnectionTarget, redactConnectionString } from './odbcConnectionString';
import { OdbcConnection } from './odbcConnection';
import { IOdbcDataExplorerHost } from './odbcDataExplorerRpcHandler';
import { findDatabaseProfile, groupDriversByDatabase, OdbcDatabaseProfile, resolveDialect } from './odbcDatabases';
import { OdbcConfiguration, OdbcDriverEntry, summarizeDsn } from './odbcinst';

/** The id of the generic ODBC driver. */
export const GENERIC_ODBC_DRIVER_ID = 'positron-data-driver-odbc';

/**
 * The id of the DSN mechanism: connect to a data source already configured on this machine. Used
 * both in the mechanism list and in the connect/generate switches, so they stay in sync.
 */
const DSN_MECHANISM_ID = 'dsn';

/**
 * The id of the driver mechanism: pick an installed ODBC driver and supply the connection details
 * directly, for a server that has no DSN configured.
 */
const DRIVER_MECHANISM_ID = 'driver';

/**
 * The id of the connection-string mechanism. The user pastes a full ODBC connection string, which
 * is handed to the driver manager verbatim. Always available, and the only mechanism offered when
 * nothing could be discovered on the machine.
 */
const CONNECTION_STRING_MECHANISM_ID = 'connectionString';

/** Type guard for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/** Escapes a value for embedding in a double-quoted Python or R string literal. */
function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- Parameter fragments ---
//
// Built as functions rather than constants because they call vscode.l10n.t, which must run after
// the l10n bundle is initialized.

/** The user parameter. Optional: many DSNs carry credentials, and some backends use SSO. */
function userParam(label?: string): positron.DataConnectionParameter {
	return {
		id: 'user',
		label: label ?? vscode.l10n.t('User'),
		description: vscode.l10n.t('Leave empty to use the credentials stored with the data source.'),
		type: positron.DataConnectionParameterType.String,
	};
}

/** The password parameter. Optional, for the same reason as the user. */
function passwordParam(): positron.DataConnectionParameter {
	return {
		id: 'password',
		label: vscode.l10n.t('Password'),
		description: vscode.l10n.t('Leave empty if the data source does not require a password.'),
		type: positron.DataConnectionParameterType.Password,
		secret: true,
	};
}

/** The single connection-string parameter. */
function connectionStringParam(): positron.DataConnectionParameter {
	return {
		// Secret: an ODBC connection string almost always embeds a password, so it belongs in
		// secret storage rather than in settings.
		id: 'connectionString',
		label: vscode.l10n.t('Connection String'),
		description: vscode.l10n.t('A full ODBC connection string, naming either a DSN or a driver.'),
		type: positron.DataConnectionParameterType.String,
		secret: true,
		// Rendered in plaintext so the user can read back what they pasted. It still goes to secret
		// storage because it typically embeds a password.
		masked: false,
		required: true,
		placeholder: 'Driver={PostgreSQL Unicode};Servername=localhost;Port=5432;Database=mydb',
	};
}

/**
 * Builds the endpoint parameters for the driver mechanism. The parameter *ids* are fixed so the
 * connect and code-generation paths can read them, but each is written into the connection string
 * under whatever attribute name the target database's ODBC driver expects (see
 * OdbcDatabaseProfile.attributeKeys) -- ODBC never standardized these, so `Server` for one driver
 * is `Servername` or `Host` for another.
 */
function endpointParams(profile: OdbcDatabaseProfile | undefined): positron.DataConnectionParameter[] {
	const params: positron.DataConnectionParameter[] = [
		{
			id: 'server',
			label: vscode.l10n.t('Server'),
			type: positron.DataConnectionParameterType.String,
			required: true,
			defaultValue: 'localhost',
		},
	];

	if (profile === undefined || profile.attributeKeys.port !== undefined) {
		params.push({
			id: 'port',
			label: vscode.l10n.t('Port'),
			type: positron.DataConnectionParameterType.Number,
			...(profile?.defaultPort !== undefined ? { defaultValue: profile.defaultPort } : {}),
		});
	}

	if (profile === undefined || profile.attributeKeys.database !== undefined) {
		params.push({
			id: 'database',
			label: vscode.l10n.t('Database'),
			type: positron.DataConnectionParameterType.String,
		});
	}

	return [...params, userParam(), passwordParam()];
}

// --- Connection string assembly ---

/**
 * Builds the connection string for the DSN mechanism. `DSN` comes first, as drivers expect, and
 * the credentials are appended only when supplied so a DSN that already carries them still works.
 */
function buildDsnConnectionString(params: positron.DataConnectionParameterValues): string {
	return buildConnectionString([
		['DSN', asString(params.dsn)],
		['UID', asString(params.user)],
		['PWD', asString(params.password)],
	]);
}

/**
 * Builds the connection string for the driver mechanism, mapping the fixed parameter ids onto the
 * attribute names the selected database's ODBC drivers expect.
 */
function buildDriverConnectionString(
	driverName: string,
	profile: OdbcDatabaseProfile | undefined,
	params: positron.DataConnectionParameterValues
): string {
	// The generic fallback uses the most widely accepted spellings: `Server`, `Port`, `Database`,
	// and the ODBC-standard `UID`/`PWD`.
	const keys = profile?.attributeKeys ?? {
		server: 'Server',
		port: 'Port',
		database: 'Database',
		user: 'UID',
		password: 'PWD',
	};

	return buildConnectionString([
		// Passed raw: buildConnectionString brace-wraps a driver name itself.
		['Driver', driverName],
		[keys.server, asString(params.server)],
		...(keys.port ? [[keys.port, asNumber(params.port)] as const] : []),
		...(keys.database ? [[keys.database, asString(params.database)] as const] : []),
		[keys.user, asString(params.user)],
		[keys.password, asString(params.password)],
	]);
}

function asString(value: unknown): string | undefined {
	return isNonEmptyString(value) ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

/**
 * Resolves the connection string for a mechanism and its parameter values, or undefined when a
 * required parameter is missing. Shared by connect() and generateConnectionCode() so the code shown
 * to the user connects the same way Positron does.
 */
function resolveConnectionString(
	mechanismId: string,
	params: positron.DataConnectionParameterValues,
	options: DriverOptions
): string | undefined {
	switch (mechanismId) {
		case DSN_MECHANISM_ID: {
			return isNonEmptyString(params.dsn) ? buildDsnConnectionString(params) : undefined;
		}
		case DRIVER_MECHANISM_ID: {
			// A per-database driver with exactly one matching ODBC driver has no picker, so the
			// driver name comes from the options rather than from a parameter.
			const driverName = asString(params.odbcDriver) ?? options.odbcDrivers[0]?.name;
			if (driverName === undefined || !isNonEmptyString(params.server)) {
				return undefined;
			}
			// The generic driver has no fixed database, so the attribute names come from whichever
			// ODBC driver the user picked. Without this the endpoint would be written as `Server=`
			// for every backend, which psqlodbc (which wants `Servername`) and others ignore.
			const profile = options.profile ?? findDatabaseProfile(driverName);
			return buildDriverConnectionString(driverName, profile, params);
		}
		case CONNECTION_STRING_MECHANISM_ID:
			return asString(params.connectionString);
		default:
			return undefined;
	}
}

// --- Connection code generation ---

/**
 * Renders R code using the odbc package. Both variants are offered because they suit different
 * habits: naming the DSN or driver as arguments is the readable form, while `.connection_string`
 * is what a user pastes when they already have a string from their DBA.
 */
function renderRCode(connectionString: string): positron.ConnectionCodeVariant[] {
	return [{
		id: 'dbi',
		label: 'DBI',
		code: `library(DBI)\n\ncon <- dbConnect(\n\todbc::odbc(),\n\t.connection_string = "${escapeDoubleQuoted(connectionString)}"\n)\n`,
	}];
}

/** Renders Python code using pyodbc, and the SQLAlchemy wrapper around it. */
function renderPythonCode(connectionString: string): positron.ConnectionCodeVariant[] {
	const escaped = escapeDoubleQuoted(connectionString);
	return [
		{
			id: 'pyodbc',
			label: 'pyodbc',
			code: `import pyodbc\n\nconn = pyodbc.connect("${escaped}")\n`,
		},
		{
			id: 'sqlalchemy',
			label: 'SQLAlchemy',
			// SQLAlchemy takes the ODBC string as a single percent-encoded query parameter, which
			// avoids having to re-express the connection in SQLAlchemy's own URL grammar.
			code: `import sqlalchemy as sa\nfrom urllib.parse import quote_plus\n\nengine = sa.create_engine(\n\t"mssql+pyodbc:///?odbc_connect=" + quote_plus("${escaped}")\n)\n`,
		},
	];
}

// --- Driver construction ---

/** What distinguishes one registered Positron driver from another. */
interface DriverOptions {
	/** The registered driver id. */
	readonly id: string;

	/** The user-facing name: "ODBC", or a database name such as "MySQL". */
	readonly name: string;

	readonly description: string;

	/** The ODBC drivers this Positron driver offers. All of them for the generic driver. */
	readonly odbcDrivers: readonly OdbcDriverEntry[];

	/** The database profile, when this is a per-database driver. Undefined for the generic one. */
	readonly profile: OdbcDatabaseProfile | undefined;

	/** The discovered configuration, used to resolve a DSN's dialect and to list data sources. */
	readonly config: OdbcConfiguration;

	/** Whether to offer the DSN mechanism. Only the generic driver does. */
	readonly offerDsns: boolean;
}

/**
 * Builds one Positron driver from its options.
 */
function createDriver(
	options: DriverOptions,
	iconSvg: string,
	dataExplorerHandler: IOdbcDataExplorerHost,
	logger?: positron.DataConnectionLogger
): positron.DataConnectionDriver {
	const mechanisms: positron.DataConnectionMechanism[] = [];

	// DSN mechanism, offered only when the machine actually has data sources configured. An option
	// parameter with an empty list would be a picker the user cannot pick anything from.
	if (options.offerDsns && options.config.dsns.length > 0) {
		mechanisms.push({
			id: DSN_MECHANISM_ID,
			label: vscode.l10n.t('Data Source (DSN)'),
			description: vscode.l10n.t('Connect to a data source already configured on this computer.'),
			parameters: [
				{
					id: 'dsn',
					label: vscode.l10n.t('Data Source'),
					type: positron.DataConnectionParameterType.Option,
					options: options.config.dsns.map(dsn => dsn.name),
					required: true,
				},
				userParam(),
				passwordParam(),
			],
		});
	}

	// Driver mechanism, offered only when there is an ODBC driver to use.
	if (options.odbcDrivers.length > 0) {
		const parameters: positron.DataConnectionParameter[] = [];

		// With more than one matching ODBC driver installed (e.g. the ANSI and Unicode builds of
		// the same connector), the user picks; with exactly one there is nothing to choose.
		if (options.odbcDrivers.length > 1) {
			parameters.push({
				id: 'odbcDriver',
				label: vscode.l10n.t('ODBC Driver'),
				type: positron.DataConnectionParameterType.Option,
				options: options.odbcDrivers.map(driver => driver.name),
				defaultValue: options.odbcDrivers[0].name,
				required: true,
			});
		}

		mechanisms.push({
			id: DRIVER_MECHANISM_ID,
			label: options.profile
				? vscode.l10n.t('Server')
				: vscode.l10n.t('ODBC Driver'),
			description: options.profile
				? vscode.l10n.t('Connect to a server by supplying its address and your credentials.')
				: vscode.l10n.t('Connect using an installed ODBC driver by supplying the connection details.'),
			parameters: [...parameters, ...endpointParams(options.profile)],
		});
	}

	// Always available, and the only mechanism when nothing was discovered.
	mechanisms.push({
		id: CONNECTION_STRING_MECHANISM_ID,
		label: vscode.l10n.t('Connection String'),
		description: vscode.l10n.t('Connect by pasting a full ODBC connection string.'),
		parameters: [connectionStringParam()],
	});

	/**
	 * Resolves the SQL dialect for a connection. The dialect follows the ODBC driver, which is
	 * named directly by the driver and connection-string mechanisms but only indirectly by a DSN --
	 * a DSN names itself, so its driver has to be looked up in the discovered configuration.
	 */
	const dialectFor = (mechanismId: string, params: positron.DataConnectionParameterValues) => {
		if (options.profile !== undefined) {
			return options.profile.dialect;
		}
		switch (mechanismId) {
			case DSN_MECHANISM_ID: {
				const dsn = options.config.dsns.find(candidate => candidate.name === params.dsn);
				return resolveDialect(dsn?.driverName);
			}
			case DRIVER_MECHANISM_ID:
				return resolveDialect(asString(params.odbcDriver) ?? options.odbcDrivers[0]?.name);
			default: {
				const target = describeConnectionTarget(asString(params.connectionString) ?? '');
				// A pasted string may name a driver directly, or a DSN whose driver we can look up.
				const dsn = options.config.dsns.find(candidate => candidate.name === target.dsnName);
				return resolveDialect(target.driverName ?? dsn?.driverName);
			}
		}
	};

	return {
		id: options.id,
		name: options.name,
		description: options.description,
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms,

		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			const connectionString = resolveConnectionString(mechanismId, params, options);
			if (connectionString === undefined) {
				throw new Error(vscode.l10n.t('The connection details are incomplete.'));
			}
			const connection = new OdbcConnection(
				connectionString,
				dialectFor(mechanismId, params),
				dataExplorerHandler,
				logger
			);
			await connection.connect();
			return connection;
		},

		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			const connectionString = resolveConnectionString(mechanismId, params, options);
			if (connectionString === undefined) {
				return [];
			}
			switch (languageId) {
				case 'r':
					return renderRCode(connectionString);
				case 'python':
					return renderPythonCode(connectionString);
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

		/**
		 * Every DSN configured on this machine, surfaced in the pane without the user configuring
		 * anything. This is what makes an ODBC setup that RStudio already shows -- a Workbench user
		 * with the Professional Drivers installed, say -- visible in Positron too.
		 *
		 * Only the generic driver reports these. A per-database driver reporting the same DSNs
		 * would put every data source in the pane once per database entry that matched it.
		 */
		async discoverConnections(): Promise<positron.DiscoveredDataConnection[]> {
			if (!options.offerDsns) {
				return [];
			}
			return options.config.dsns.map(dsn => ({
				// Stable across restarts, so a discovered connection keeps its identity (and its
				// expansion state in the pane) from session to session.
				id: `odbc-dsn:${dsn.name}`,
				name: dsn.name,
				description: summarizeDsn(dsn),
				mechanismId: DSN_MECHANISM_ID,
				parameters: { dsn: dsn.name },
			}));
		},
	};
}

/**
 * Creates every Positron driver this extension registers: the generic ODBC driver, plus one per
 * recognized database whose ODBC driver is installed.
 *
 * @param context The extension context, used to locate the icon asset.
 * @param config The ODBC configuration discovered on this machine.
 * @param dataExplorerHandler Hosts table views previewed from these connections.
 * @param logger Diagnostic log sink.
 */
export function createOdbcDrivers(
	context: vscode.ExtensionContext,
	config: OdbcConfiguration,
	dataExplorerHandler: IOdbcDataExplorerHost,
	logger?: positron.DataConnectionLogger
): positron.DataConnectionDriver[] {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'odbc.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	const generic = createDriver({
		id: GENERIC_ODBC_DRIVER_ID,
		name: 'ODBC',
		description: vscode.l10n.t('Connect to a database using an ODBC driver'),
		odbcDrivers: config.drivers,
		profile: undefined,
		config,
		offerDsns: true,
	}, iconSvg, dataExplorerHandler, logger);

	const perDatabase = groupDriversByDatabase(config.drivers).map(({ profile, drivers }) =>
		createDriver({
			id: `${GENERIC_ODBC_DRIVER_ID}-${profile.id}`,
			name: profile.name,
			description: vscode.l10n.t('Connect to a {0} database over ODBC', profile.name),
			odbcDrivers: drivers,
			profile,
			config,
			// Data sources belong to the generic driver; see discoverConnections above.
			offerDsns: false,
		}, iconSvg, dataExplorerHandler, logger));

	return [generic, ...perDatabase];
}
