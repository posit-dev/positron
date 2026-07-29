/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { IDuckDBDataExplorerHost } from 'positron-data-explorer-duckdb';
import { KeyAuthenticator, TokenAuthenticator } from './connectAuth.js';
import { ConnectClient, isAuthFailure } from './connectClient.js';
import { escapeDoubleQuoted } from './pinsCode.js';
import { Logger, NULL_LOGGER } from './logging.js';
import { PinsCache } from './pinsCache.js';
import { PinsConnection } from './pinsConnection.js';
import { claimToken as defaultClaimToken, TokenClaimDeps, TokenClaimResult } from './tokenAuth.js';
import { SecretTokenCredentialStore, TokenCredentialStore } from './tokenCredentialStore.js';

/**
 * The connection-mechanism ids. Used both in the driver's mechanism list and in the connect/generate
 * switches, so they stay in sync.
 */
const API_KEY_MECHANISM_ID = 'apiKey';

/** The id of the browser sign-in (token-pairing) mechanism. */
const TOKEN_MECHANISM_ID = 'token';

/** The id of the environment-variable mechanism. */
const ENVVAR_MECHANISM_ID = 'envvar';

/** Type guard for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/** The bare default board-open snippet for a language, or undefined for an unsupported language. */
function boardOpenCode(languageId: string): string | undefined {
	switch (languageId) {
		case 'r':
			return `library(pins)\nboard <- board_connect()\npin_list(board)\n`;
		case 'python':
			return `import pins\nboard = pins.board_connect()\nboard.pin_list()\n`;
		default:
			return undefined;
	}
}

/**
 * Generates the R connection code variants. The generated code operates at the connection (board)
 * level, listing the board's pins; reading an individual pin is a per-pin operation, not something
 * this connection-level code represents. The default variant relies on the CONNECT_SERVER and
 * CONNECT_API_KEY environment variables (matching `board_connect()` defaults). The explicit-server
 * variant names the server from the profile and reads the key from the environment, unless the key
 * was included via the Include Secrets flow, in which case it is embedded inline.
 */
function generateRCode(serverUrl: string | undefined, apiKey: string | undefined): positron.ConnectionCodeVariant[] {
	const variants: positron.ConnectionCodeVariant[] = [
		{
			id: 'envvar',
			label: vscode.l10n.t('Environment Variables'),
			code: boardOpenCode('r')!,
		},
	];
	if (serverUrl) {
		const keyArg = apiKey
			? `key = "${escapeDoubleQuoted(apiKey)}"`
			: `key = Sys.getenv("CONNECT_API_KEY")`;
		variants.push({
			id: 'explicitServer',
			label: vscode.l10n.t('Explicit Server'),
			code: `library(pins)\nboard <- board_connect(\n\tserver = "${escapeDoubleQuoted(serverUrl)}",\n\t${keyArg}\n)\npin_list(board)\n`,
		});
	}
	return variants;
}

/**
 * Generates the Python connection code variants, mirroring {@link generateRCode}. The generated
 * code lists the board's pins (a connection-level operation); reading an individual pin is per-pin
 * and not represented here. The default variant relies on the CONNECT_SERVER and CONNECT_API_KEY
 * environment variables; the explicit-server variant names the server and, when secrets are
 * included, embeds the key.
 */
function generatePythonCode(serverUrl: string | undefined, apiKey: string | undefined): positron.ConnectionCodeVariant[] {
	const variants: positron.ConnectionCodeVariant[] = [
		{
			id: 'envvar',
			label: vscode.l10n.t('Environment Variables'),
			code: boardOpenCode('python')!,
		},
	];
	if (serverUrl) {
		const keyArg = apiKey
			? `, api_key="${escapeDoubleQuoted(apiKey)}"`
			: ``;
		variants.push({
			id: 'explicitServer',
			label: vscode.l10n.t('Explicit Server'),
			code: `import pins\nboard = pins.board_connect(server_url="${escapeDoubleQuoted(serverUrl)}"${keyArg})\nboard.pin_list()\n`,
		});
	}
	return variants;
}

/**
 * Injectable dependencies for the driver, so `connect()` can be tested without real secret storage,
 * environment, network, or browser. All default to the real implementations.
 */
export interface PinsDriverDeps {
	/** Persists browser sign-in credentials; defaults to secret storage over `context.secrets`. */
	credentialStore?: TokenCredentialStore;
	/** The environment read by the env-var mechanism; defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** The fetch implementation; defaults to global fetch. */
	fetch?: typeof fetch;
	/** Runs the browser sign-in flow; defaults to the real `claimToken`. */
	claimToken?: (serverUrl: string, deps: TokenClaimDeps) => Promise<TokenClaimResult>;
}

/**
 * Creates the Posit Connect pins DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset and back credential storage.
 * @param dataExplorerHandler Hosts the table views previewed pins are shown in.
 * @param cache The on-disk cache downloaded pin data files are stored in.
 * @param logger Logs connect and browse activity; defaults to a no-op logger.
 * @param deps Injectable dependencies; all default to the real implementations.
 */
export function createPinsDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: IDuckDBDataExplorerHost,
	cache: PinsCache,
	logger: Logger = NULL_LOGGER,
	deps: PinsDriverDeps = {}
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'connect.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	const fetchFn = deps.fetch ?? fetch;
	const env = deps.env ?? process.env;
	const credentialStore = deps.credentialStore ?? new SecretTokenCredentialStore(context.secrets);
	const claimTokenFn = deps.claimToken ?? defaultClaimToken;

	// Validates a client (server URL and credentials) and wraps it in a connection. A non-Connect URL
	// fails getServerSettings; a bad credential returns 401/403 from getCurrentUser.
	async function connectWithClient(client: ConnectClient): Promise<positron.DataConnection> {
		logger.info(`Connecting to ${client.serverUrl}`);
		const settings = await client.getServerSettings();
		const user = await client.getCurrentUser();
		logger.info(`Connected as ${user.username || '(unknown user)'}${settings.version ? ` (Connect ${settings.version})` : ''}`);
		return new PinsConnection(client, dataExplorerHandler, cache, logger);
	}

	// Browser sign-in (rsconnect-style token pairing): the user authenticates in their browser, so the
	// only field is the server URL.
	const tokenMechanism: positron.DataConnectionMechanism = {
		id: TOKEN_MECHANISM_ID,
		label: vscode.l10n.t('Sign in with a browser'),
		description: vscode.l10n.t('Sign in to a Posit Connect server in your browser. No API key needed.'),
		parameters: [
			{
				id: 'serverUrl',
				label: vscode.l10n.t('Server URL'),
				type: positron.DataConnectionParameterType.String,
				required: true,
				placeholder: 'https://connect.example.com',
			},
		],
	};

	// Environment variables: no fields; the connection reads CONNECT_SERVER and CONNECT_API_KEY.
	const envVarMechanism: positron.DataConnectionMechanism = {
		id: ENVVAR_MECHANISM_ID,
		label: vscode.l10n.t('Environment Variables'),
		description: vscode.l10n.t('Use the CONNECT_SERVER and CONNECT_API_KEY environment variables, set from the environment Positron was launched from.'),
		parameters: [],
	};

	// A server URL plus an API key.
	const apiKeyMechanism: positron.DataConnectionMechanism = {
		id: API_KEY_MECHANISM_ID,
		label: vscode.l10n.t('API Key'),
		description: vscode.l10n.t('Connect to a Posit Connect server with a server URL and an API key.'),
		parameters: [
			{
				id: 'serverUrl',
				label: vscode.l10n.t('Server URL'),
				type: positron.DataConnectionParameterType.String,
				required: true,
				placeholder: 'https://connect.example.com',
			},
			{
				id: 'apiKey',
				label: vscode.l10n.t('API Key'),
				description: vscode.l10n.t('Create an API key from your Posit Connect account under "Manage Your API Keys".'),
				type: positron.DataConnectionParameterType.Password,
				secret: true,
				required: true,
			},
		],
	};

	return {
		id: 'positron-data-driver-pins',
		name: 'Posit Connect Pins',
		description: vscode.l10n.t('Browse pins on a Posit Connect server'),
		iconSvg,
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [tokenMechanism, apiKeyMechanism, envVarMechanism],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			switch (mechanismId) {
				case API_KEY_MECHANISM_ID: {
					if (!isNonEmptyString(params.serverUrl)) {
						throw new Error(vscode.l10n.t('Server URL is required'));
					}
					if (!isNonEmptyString(params.apiKey)) {
						throw new Error(vscode.l10n.t('API Key is required'));
					}
					const client = new ConnectClient(params.serverUrl, new KeyAuthenticator(params.apiKey), fetchFn, logger);
					return connectWithClient(client);
				}
				case ENVVAR_MECHANISM_ID: {
					const serverUrl = env.CONNECT_SERVER;
					const apiKey = env.CONNECT_API_KEY;
					if (!isNonEmptyString(serverUrl) || !isNonEmptyString(apiKey)) {
						throw new Error(vscode.l10n.t('Set the CONNECT_SERVER and CONNECT_API_KEY environment variables in the environment Positron was launched from, then reconnect. Variables set only in .Renviron or a shell profile are not visible to Positron.'));
					}
					const client = new ConnectClient(serverUrl, new KeyAuthenticator(apiKey), fetchFn, logger);
					return connectWithClient(client);
				}
				case TOKEN_MECHANISM_ID: {
					if (!isNonEmptyString(params.serverUrl)) {
						throw new Error(vscode.l10n.t('Server URL is required'));
					}
					const serverUrl = params.serverUrl;

					// Reuse a stored sign-in if it still validates, so reconnecting a saved connection does
					// not reopen the browser.
					const stored = await credentialStore.get(serverUrl);
					if (stored) {
						const client = new ConnectClient(serverUrl, new TokenAuthenticator(stored), fetchFn, logger);
						let rejected = false;
						try {
							await client.getCurrentUser();
						} catch (err) {
							// Only an actual credential rejection (401/403) means the sign-in is revoked or
							// expired. A transient failure (a 503, a dropped connection, a timeout) says
							// nothing about the credential, so surface it instead of discarding a working
							// sign-in and popping a browser window the user did not ask for.
							if (!isAuthFailure(err)) {
								throw err;
							}
							rejected = true;
							logger.info('Stored sign-in was rejected; starting a new browser sign-in.');
						}
						if (!rejected) {
							return connectWithClient(client);
						}
					}

					const result = await vscode.window.withProgress(
						{ location: vscode.ProgressLocation.Notification, cancellable: true, title: vscode.l10n.t('Waiting for sign-in in your browser...') },
						async (_progress, cancelToken) => {
							// Bridge the notification's Cancel button to an abort signal, so cancelling also
							// aborts the in-flight registration request (not just the poll loop).
							const abort = new AbortController();
							const subscription = cancelToken.onCancellationRequested(() => abort.abort());
							try {
								return await claimTokenFn(serverUrl, {
									fetch: fetchFn,
									openExternal: (url: string) => vscode.env.openExternal(vscode.Uri.parse(url)),
									signal: abort.signal,
									logger,
								});
							} finally {
								subscription.dispose();
							}
						},
					);
					await credentialStore.set(serverUrl, result.credential);
					const client = new ConnectClient(serverUrl, new TokenAuthenticator(result.credential), fetchFn, logger);
					return connectWithClient(client);
				}
				default:
					throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
			}
		},
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			// Both the env-var and token mechanisms generate the pins packages' default board open, but the
			// two mean different things to the user, so they are labelled differently. For an env-var
			// connection the default open reads CONNECT_SERVER and CONNECT_API_KEY, which is the
			// mechanism's own configuration. For a browser sign-in there is no credential to name: the
			// pins packages resolve credentials through their own channels (R's rsconnect account
			// registry, Python's CONNECT_* variables) and cannot read the token this driver keeps in
			// secret storage, so the snippet is only the package default and is labelled as such.
			if (mechanismId === ENVVAR_MECHANISM_ID || mechanismId === TOKEN_MECHANISM_ID) {
				const code = boardOpenCode(languageId);
				if (!code) {
					return [];
				}
				return mechanismId === ENVVAR_MECHANISM_ID
					? [{ id: 'envvar', label: vscode.l10n.t('Environment Variables'), code }]
					: [{ id: 'default', label: vscode.l10n.t('Default Connection'), code }];
			}
			if (mechanismId !== API_KEY_MECHANISM_ID) {
				return [];
			}
			// serverUrl is a non-secret profile value; apiKey is present only when the user opts into
			// the Include Secrets flow, which is what lets the explicit-server variant embed the key.
			const serverUrl = isNonEmptyString(params.serverUrl) ? params.serverUrl : undefined;
			const apiKey = isNonEmptyString(params.apiKey) ? params.apiKey : undefined;
			switch (languageId) {
				case 'r':
					return generateRCode(serverUrl, apiKey);
				case 'python':
					return generatePythonCode(serverUrl, apiKey);
				default:
					return [];
			}
		},
	};
}
