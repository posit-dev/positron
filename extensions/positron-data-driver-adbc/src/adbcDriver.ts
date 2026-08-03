/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { AdbcConnection } from './adbcConnection.js';
import { AdbcDataExplorerRpcHandler } from './adbcDataExplorerRpcHandler.js';
import { WorkerOpenConfig } from './adbcWorkerProtocol.js';
import { IdentifierQuoteSetting } from './adbcDialect.js';

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
 * The id of the installed-driver mechanism. The user names a driver that the ADBC driver
 * manager can resolve from its manifest search paths. Used both in the driver's mechanism
 * list and in the connect/generate switches, so they stay in sync.
 */
const INSTALLED_DRIVER_MECHANISM_ID = 'installedDriver';

/**
 * The id of the driver-library mechanism. The user points directly at a shared library or
 * a `.toml` manifest on disk, for a driver that is not on a search path. Used both in the
 * driver's mechanism list and in the connect/generate switches, so they stay in sync.
 */
const DRIVER_LIBRARY_MECHANISM_ID = 'driverLibrary';

/**
 * The id of the connection-profile mechanism. The user names an ADBC connection profile,
 * a `.toml` file that names the driver and carries its options. Used both in the driver's
 * mechanism list and in the connect/generate switches, so they stay in sync.
 */
const PROFILE_MECHANISM_ID = 'profile';

// --- Parameter fragments ---
//
// Mechanisms are assembled from these shared fragments rather than repeating parameter
// definitions. They are functions (not constants) because they call vscode.l10n.t, which must
// run after the l10n bundle is initialized; each is invoked while building the driver inside
// createAdbcDriver.

/** The optional URI parameter, shared by the driver-name and driver-library mechanisms. */
function uriParam(): positron.DataConnectionParameter {
	return {
		// Secret: a URI commonly embeds a password or token, so it must go to secret storage
		// rather than plain settings.
		id: 'uri',
		label: vscode.l10n.t('URI'),
		description: vscode.l10n.t('The connection URI for the database, if the driver needs one.'),
		type: positron.DataConnectionParameterType.String,
		secret: true,
		// Render in plaintext so the user can read back the URI they paste. It still goes to
		// secret storage because it may embed a password.
		masked: false,
		placeholder: 'grpc://localhost:31337',
	};
}

/** The optional user parameter, shared by the driver-name and driver-library mechanisms. */
function usernameParam(): positron.DataConnectionParameter {
	return {
		id: 'username',
		label: vscode.l10n.t('User'),
		description: vscode.l10n.t('Leave empty if the driver takes credentials another way.'),
		type: positron.DataConnectionParameterType.String,
	};
}

/** The optional password parameter, shared by the driver-name and driver-library mechanisms. */
function passwordParam(): positron.DataConnectionParameter {
	return {
		id: 'password',
		label: vscode.l10n.t('Password'),
		description: vscode.l10n.t('Leave empty if the driver takes credentials another way.'),
		type: positron.DataConnectionParameterType.Password,
		secret: true,
	};
}

/**
 * The free-form driver options parameter, shared by every mechanism. This is what makes the
 * driver an escape hatch: any option the vendor's driver documents can be passed through
 * without Positron knowing about it.
 */
function optionsParam(): positron.DataConnectionParameter {
	return {
		// Secret: vendor options routinely carry tokens and keys, so the value goes to secret
		// storage.
		id: 'options',
		label: vscode.l10n.t('Driver Options'),
		description: vscode.l10n.t("Driver-specific options as key=value pairs, separated by semicolons. For example: adbc.snowflake.sql.account=myaccount;adbc.snowflake.sql.warehouse=mywh"),
		type: positron.DataConnectionParameterType.String,
		secret: true,
		// Render in plaintext: the user is composing a list of options and needs to read back
		// what they typed. It still goes to secret storage because options often carry tokens.
		masked: false,
	};
}

/**
 * The identifier-quoting override, shared by every mechanism. Detection covers the
 * engines listed in adbcDialect.ts; this is the escape hatch for anything else, since a
 * wrong guess makes every generated query fail.
 */
function identifierQuotingParam(): positron.DataConnectionParameter {
	return {
		id: 'identifierQuoting',
		label: vscode.l10n.t('Identifier Quoting'),
		description: vscode.l10n.t('How to quote table and column names in generated SQL. Detected automatically; override if your database reports a syntax error on quoted names.'),
		type: positron.DataConnectionParameterType.Option,
		options: ['auto', 'ansi', 'backtick', 'bracket'],
		defaultValue: 'auto',
	};
}

/** The read-only toggle, shared by every mechanism. */
function readOnlyParam(): positron.DataConnectionParameter {
	return {
		id: 'readOnly',
		label: vscode.l10n.t('Open Read Only'),
		description: vscode.l10n.t('Ask the driver to open the connection read only. Not every driver supports this.'),
		type: positron.DataConnectionParameterType.Boolean,
		defaultValue: true,
	};
}

/**
 * Narrows the identifier-quoting parameter value to the setting type, treating anything
 * unrecognized as 'auto' so a stale stored value cannot break a connection.
 */
export function parseQuoteSetting(value: unknown): IdentifierQuoteSetting {
	return value === 'ansi' || value === 'backtick' || value === 'bracket' ? value : 'auto';
}

// --- Driver option parsing ---

/**
 * Parses the free-form driver options field into ADBC database options.
 *
 * Entries are `key=value` pairs separated by semicolons or newlines; whitespace around
 * each key and value is trimmed, and the first `=` separates them so a value may itself
 * contain `=` (common in base64-encoded tokens). Entries without an `=` are ignored rather
 * than rejected, so a trailing separator is harmless.
 */
export function parseDriverOptions(options: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const entry of options.split(/[;\n]/)) {
		const trimmed = entry.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const separator = trimmed.indexOf('=');
		if (separator <= 0) {
			continue;
		}
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim();
		if (key.length > 0) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Builds the ADBC database options from a mechanism's parameter values: the free-form
 * options first, then the dedicated URI, user, and password fields, which take precedence
 * so a value typed into its own field is not silently overridden by the options blob.
 */
export function buildDatabaseOptions(params: positron.DataConnectionParameterValues): Record<string, string> {
	const options = isNonEmptyString(params.options) ? parseDriverOptions(params.options) : {};
	// The ADBC standard option names, defined by the specification and understood by every
	// driver that takes a URI or credentials.
	if (isNonEmptyString(params.uri)) {
		options.uri = params.uri;
	}
	if (isNonEmptyString(params.username)) {
		options.username = params.username;
	}
	if (isNonEmptyString(params.password)) {
		options.password = params.password;
	}
	return options;
}

// --- Connection code generation ---

/**
 * Normalized ADBC connection fields, independent of any client library. The renderers map
 * these to each library's argument names. Optional fields are omitted from the generated
 * code.
 */
interface AdbcConnectionFields {
	/** The driver name, library path, or manifest path. Omitted for a profile connection. */
	driver?: string;
	/** The driver's entrypoint symbol, when the user overrode it. */
	entrypoint?: string;
	/** A connection profile name, used instead of a driver. */
	profile?: string;
	/** The ADBC database options, including uri/username/password. */
	databaseOptions: Record<string, string>;
}

/** Renders the option entries as Python dict items. */
function pythonOptionEntries(options: Record<string, string>): string[] {
	return Object.entries(options).map(([key, value]) =>
		`"${escapeDoubleQuoted(key)}": "${escapeDoubleQuoted(value)}"`);
}

/** Renders adbc_driver_manager (DBAPI) connection code from normalized fields. */
function renderPythonCode(fields: AdbcConnectionFields): positron.ConnectionCodeVariant {
	const args: string[] = [];
	if (fields.driver) { args.push(`driver="${escapeDoubleQuoted(fields.driver)}"`); }
	if (fields.entrypoint) { args.push(`entrypoint="${escapeDoubleQuoted(fields.entrypoint)}"`); }
	const entries = pythonOptionEntries(
		fields.profile ? { ...fields.databaseOptions, profile: fields.profile } : fields.databaseOptions);
	if (entries.length > 0) {
		args.push(`db_kwargs={\n${entries.map(entry => `\t\t${entry},`).join('\n')}\n\t}`);
	}
	return {
		id: 'adbc_driver_manager',
		label: 'adbc_driver_manager',
		code: `import adbc_driver_manager.dbapi\n\nconn = adbc_driver_manager.dbapi.connect(\n${args.map(arg => `\t${arg},`).join('\n')}\n)\n`,
	};
}

/** Renders adbcdrivermanager connection code from normalized fields. */
function renderRCode(fields: AdbcConnectionFields): positron.ConnectionCodeVariant {
	const options = fields.profile
		? { ...fields.databaseOptions, profile: fields.profile }
		: fields.databaseOptions;
	// adbc_database_init takes the options as named arguments; keys that are not syntactic R
	// names (ADBC option keys are dotted, e.g. adbc.snowflake.sql.account) must be backquoted.
	const args: string[] = [
		fields.driver
			? `adbc_driver("${escapeDoubleQuoted(fields.driver)}")`
			: 'adbc_driver_monkey()',
	];
	for (const [key, value] of Object.entries(options)) {
		const name = /^[a-zA-Z.][a-zA-Z0-9._]*$/.test(key) && !key.includes('..')
			? key
			: `\`${key.replace(/`/g, '\\`')}\``;
		args.push(`${name} = "${escapeDoubleQuoted(value)}"`);
	}
	return {
		id: 'adbcdrivermanager',
		label: 'adbcdrivermanager',
		// R does not allow a trailing comma, so join the arguments with commas.
		code: `library(adbcdrivermanager)\n\ndb <- adbc_database_init(\n${args.map(arg => `\t${arg}`).join(',\n')}\n)\ncon <- adbc_connection_init(db)\n`,
	};
}

/**
 * Generates the connection code variants for the given language from normalized fields.
 * Returns an empty array when the fields could not be built (a required parameter was
 * missing) or the language is unsupported.
 */
function generateConnectionCodeForFields(languageId: string, fields: AdbcConnectionFields | undefined): positron.ConnectionCodeVariant[] {
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

/**
 * Maps the installed-driver mechanism's parameter values to normalized fields. Returns
 * undefined when the driver is missing.
 */
function installedDriverFields(params: positron.DataConnectionParameterValues): AdbcConnectionFields | undefined {
	if (!isNonEmptyString(params.driver)) {
		return undefined;
	}
	return { driver: params.driver, databaseOptions: buildDatabaseOptions(params) };
}

/**
 * Maps the driver-library mechanism's parameter values to normalized fields. Returns
 * undefined when the library path is missing.
 */
function driverLibraryFields(params: positron.DataConnectionParameterValues): AdbcConnectionFields | undefined {
	if (!isNonEmptyString(params.libraryPath)) {
		return undefined;
	}
	return {
		driver: params.libraryPath,
		entrypoint: isNonEmptyString(params.entrypoint) ? params.entrypoint : undefined,
		databaseOptions: buildDatabaseOptions(params),
	};
}

/**
 * Maps the profile mechanism's parameter values to normalized fields. Returns undefined
 * when the profile name is missing.
 */
function profileFields(params: positron.DataConnectionParameterValues): AdbcConnectionFields | undefined {
	if (!isNonEmptyString(params.profileName)) {
		return undefined;
	}
	return { profile: params.profileName, databaseOptions: buildDatabaseOptions(params) };
}

// --- Redaction ---

/** The mask substituted for a secret when redacting a value for display. */
const REDACTED = '****';

/**
 * Option keys whose values are masked in the redacted preview of the options field. ADBC
 * option names are vendor-defined, so this matches on the key containing a sensitive word
 * rather than on an exact list.
 */
const SECRET_OPTION_PATTERN = /pass|secret|token|key|credential/i;

/**
 * Produces a display-safe form of the driver options field, masking the values of options
 * whose keys look sensitive while leaving the rest readable. Used as the field placeholder
 * when editing an existing connection.
 */
export function redactDriverOptions(options: string): string {
	return options
		.split(/([;\n])/)
		.map(part => {
			if (part === ';' || part === '\n') {
				return part;
			}
			const separator = part.indexOf('=');
			if (separator <= 0) {
				return part;
			}
			const key = part.slice(0, separator);
			return SECRET_OPTION_PATTERN.test(key) ? `${key}=${REDACTED}` : part;
		})
		.join('');
}

/**
 * Produces a display-safe form of a connection URI by masking any embedded password.
 * Returns the input unchanged when it does not parse as a URI or carries no password.
 */
export function redactUri(uri: string): string {
	try {
		const url = new URL(uri);
		if (!url.password) {
			return uri;
		}
		url.password = REDACTED;
		return url.toString();
	} catch {
		// Not a URI; there is no password component to mask.
		return uri;
	}
}

/**
 * Creates the ADBC DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views previewed from an ADBC connection.
 */
export function createAdbcDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: AdbcDataExplorerRpcHandler
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'adbc.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	// Installed-driver mechanism: name a driver the ADBC driver manager can resolve from its
	// manifest search paths (the ADBC_DRIVER_PATH environment variable, the user and system
	// configuration directories, and the active conda environment).
	const installedDriverMechanism: positron.DataConnectionMechanism = {
		id: INSTALLED_DRIVER_MECHANISM_ID,
		label: vscode.l10n.t('Installed Driver'),
		description: vscode.l10n.t('Connect using an ADBC driver already installed on this computer.'),
		parameters: [
			{
				id: 'driver',
				label: vscode.l10n.t('Driver'),
				description: vscode.l10n.t('The name of an installed ADBC driver, or a URI whose scheme names one.'),
				type: positron.DataConnectionParameterType.String,
				required: true,
				placeholder: 'snowflake',
			},
			uriParam(),
			usernameParam(),
			passwordParam(),
			optionsParam(),
			identifierQuotingParam(),
			readOnlyParam(),
		],
	};

	// Driver-library mechanism: point directly at a shared library or a .toml manifest for a
	// driver that is not on a search path.
	const driverLibraryMechanism: positron.DataConnectionMechanism = {
		id: DRIVER_LIBRARY_MECHANISM_ID,
		label: vscode.l10n.t('Driver Library'),
		description: vscode.l10n.t('Connect using an ADBC driver library or manifest file on disk.'),
		parameters: [
			{
				id: 'libraryPath',
				label: vscode.l10n.t('Driver Library'),
				description: vscode.l10n.t('The ADBC driver shared library, or a driver manifest file.'),
				type: positron.DataConnectionParameterType.File,
				required: true,
				filters: {
					'Driver Libraries': ['so', 'dylib', 'dll'],
					'Driver Manifests': ['toml'],
				},
			},
			{
				// Blank lets the driver manager derive the entrypoint from the driver name, which
				// is right for every driver that follows the ADBC naming convention.
				id: 'entrypoint',
				label: vscode.l10n.t('Entrypoint'),
				description: vscode.l10n.t('Leave empty unless the driver documents a non-standard entrypoint symbol.'),
				type: positron.DataConnectionParameterType.String,
				placeholder: 'AdbcDriverInit',
			},
			uriParam(),
			usernameParam(),
			passwordParam(),
			optionsParam(),
			identifierQuotingParam(),
			readOnlyParam(),
		],
	};

	// Profile mechanism: name an ADBC connection profile, a .toml file that already names the
	// driver and carries its options.
	const profileMechanism: positron.DataConnectionMechanism = {
		id: PROFILE_MECHANISM_ID,
		label: vscode.l10n.t('Connection Profile'),
		description: vscode.l10n.t('Connect using a saved ADBC connection profile.'),
		parameters: [
			{
				id: 'profileName',
				label: vscode.l10n.t('Profile'),
				description: vscode.l10n.t('The name of a connection profile in your ADBC configuration directory.'),
				type: positron.DataConnectionParameterType.String,
				required: true,
			},
			optionsParam(),
			identifierQuotingParam(),
			readOnlyParam(),
		],
	};

	/** Builds the worker open configuration shared by every mechanism. */
	const openConfig = (
		params: positron.DataConnectionParameterValues,
		driver: string | undefined,
		extra?: Record<string, string>
	): WorkerOpenConfig => ({
		driver,
		entrypoint: isNonEmptyString(params.entrypoint) ? params.entrypoint : undefined,
		databaseOptions: { ...buildDatabaseOptions(params), ...extra },
		// Default to read only: the Data Connections tree is a browsing surface, and an
		// escape-hatch driver may be pointed at a production database.
		readOnly: params.readOnly !== false,
		identifierQuoting: parseQuoteSetting(params.identifierQuoting),
	});

	// Return the driver.
	return {
		id: 'positron-data-driver-adbc',
		name: 'ADBC',
		description: vscode.l10n.t('Connect to a database using an Arrow Database Connectivity driver'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [installedDriverMechanism, driverLibraryMechanism, profileMechanism],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			switch (mechanismId) {
				case INSTALLED_DRIVER_MECHANISM_ID: {
					// Only the driver is required: everything else depends on what the driver needs.
					const driver = params.driver;
					if (!isNonEmptyString(driver)) {
						throw new Error(vscode.l10n.t('Driver is required'));
					}

					// Create the connection.
					const connection = new AdbcConnection(openConfig(params, driver), dataExplorerHandler);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				case DRIVER_LIBRARY_MECHANISM_ID: {
					// The library path is required; the entrypoint and every option are optional.
					const libraryPath = params.libraryPath;
					if (!isNonEmptyString(libraryPath)) {
						throw new Error(vscode.l10n.t('Driver Library is required'));
					}

					// Create the connection.
					const connection = new AdbcConnection(openConfig(params, libraryPath), dataExplorerHandler);

					// Connect the connection.
					await connection.connect();

					// Return the connection.
					return connection;
				}
				case PROFILE_MECHANISM_ID: {
					// The profile names the driver, so no driver is passed: the driver manager reads
					// it from the profile's own configuration.
					const profileName = params.profileName;
					if (!isNonEmptyString(profileName)) {
						throw new Error(vscode.l10n.t('Profile is required'));
					}

					// Create the connection.
					const connection = new AdbcConnection(
						openConfig(params, undefined, { profile: profileName }), dataExplorerHandler);

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
				case INSTALLED_DRIVER_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, installedDriverFields(params));
				case DRIVER_LIBRARY_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, driverLibraryFields(params));
				case PROFILE_MECHANISM_ID:
					return generateConnectionCodeForFields(languageId, profileFields(params));
				default:
					return [];
			}
		},
		redactParameterValue(_mechanismId: string, parameterId: string, value: string): string | undefined {
			// The URI and the options blob are the parameters shown in plaintext while
			// potentially embedding a secret, so they are the ones with a meaningful redacted
			// preview. The password field is always masked and needs none.
			switch (parameterId) {
				case 'uri':
					return redactUri(value);
				case 'options':
					return redactDriverOptions(value);
				default:
					return undefined;
			}
		},
	};
}
