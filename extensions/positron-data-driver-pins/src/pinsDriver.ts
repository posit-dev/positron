/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { ConnectClient } from './connectClient.js';
import { Logger, NULL_LOGGER } from './logging.js';
import { PinsConnection } from './pinsConnection.js';

/**
 * The id of the API-key connection mechanism. Used both in the driver's mechanism list and in the
 * connect/generate switches, so they stay in sync. Environment-variable and OAuth mechanisms come
 * in a later PR.
 */
const API_KEY_MECHANISM_ID = 'apiKey';

/** Type guard for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
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
			code: `library(pins)\nboard <- board_connect()\npin_list(board)\n`,
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
			code: `import pins\nboard = pins.board_connect()\nboard.pin_list()\n`,
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
 * Creates the Posit Connect pins DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param logger Logs connect and browse activity; defaults to a no-op logger.
 */
export function createPinsDriver(context: vscode.ExtensionContext, logger: Logger = NULL_LOGGER): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconPath = path.join(context.extensionPath, 'media', 'logo', 'connect.svg');
	const iconSvg = readFileSync(iconPath, 'utf-8');

	// The single (for now) mechanism: a server URL plus an API key.
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
		mechanisms: [apiKeyMechanism],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			if (mechanismId !== API_KEY_MECHANISM_ID) {
				throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
			}
			if (!isNonEmptyString(params.serverUrl)) {
				throw new Error(vscode.l10n.t('Server URL is required'));
			}
			if (!isNonEmptyString(params.apiKey)) {
				throw new Error(vscode.l10n.t('API Key is required'));
			}

			const client = new ConnectClient(params.serverUrl, params.apiKey, fetch, logger);
			logger.info(`Connecting to ${client.serverUrl}`);
			// Validate the server URL (a non-Connect URL fails here) and the API key (an invalid key
			// returns 401/403) before handing back a connection.
			const settings = await client.getServerSettings();
			const user = await client.getCurrentUser();
			logger.info(`Connected as ${user.username || '(unknown user)'}${settings.version ? ` (Connect ${settings.version})` : ''}`);
			return new PinsConnection(client, logger);
		},
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
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
