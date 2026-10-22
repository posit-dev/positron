/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBDataExplorerRpcHandler } from 'positron-data-explorer-duckdb';
import { generateMotherDuckCode, motherduckLanguageIds } from './motherduckCode.js';
import { accessTokenRequiredMessage, MotherDuckConnection } from './motherduckConnection.js';

/** The id of the access token mechanism. */
const TOKEN_MECHANISM_ID = 'token';

/** Type guard for a string with at least one non-whitespace character. */
function isNonBlankString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

/** Returns the value when it is a string, otherwise undefined. */
function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the `readOnly` parameter, defaulting to true to match the parameter's declared
 * `defaultValue`. Both the live connection and the generated code read it through here.
 */
function isReadOnly(params: positron.DataConnectionParameterValues): boolean {
	return params.readOnly !== false;
}

/**
 * Creates the MotherDuck DataConnectionDriver.
 * @param context The extension context, used to locate the icon asset.
 * @param dataExplorerHandler Hosts table views for previewing tables/views in the Data Explorer.
 * @param logger Optional diagnostic log sink passed through to each connection it creates.
 */
export function createMotherDuckDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: DuckDBDataExplorerRpcHandler,
	logger?: positron.DataConnectionLogger
): positron.DataConnectionDriver {
	// Load the SVG icon once at registration time.
	const iconSvg = readFileSync(path.join(context.extensionPath, 'media', 'logo', 'motherduck.svg'), 'utf-8');

	return {
		id: 'positron-data-driver-motherduck',
		name: 'MotherDuck',
		description: vscode.l10n.t('Connect to your MotherDuck account'),
		iconSvg,
		supportedLanguageIds: motherduckLanguageIds(process.platform),
		mechanisms: [
			{
				id: TOKEN_MECHANISM_ID,
				label: vscode.l10n.t('Access Token'),
				description: vscode.l10n.t('Connect with an access token created in the MotherDuck web UI under Settings.'),
				parameters: [
					{
						id: 'token',
						label: vscode.l10n.t('Access Token'),
						type: positron.DataConnectionParameterType.Password,
						secret: true,
						required: true,
					},
					{
						id: 'database',
						label: vscode.l10n.t('Default Database'),
						description: vscode.l10n.t('The database used for table names that do not name a database. Leave blank for your MotherDuck default. The Connections pane shows all your databases either way.'),
						type: positron.DataConnectionParameterType.String,
					},
					{
						id: 'readOnly',
						label: vscode.l10n.t('Read Only'),
						description: vscode.l10n.t('Prevents changes to your MotherDuck databases from this connection.'),
						type: positron.DataConnectionParameterType.Boolean,
						defaultValue: true,
					},
				],
			},
		],
		async connect(mechanismId: string, params: positron.DataConnectionParameterValues): Promise<positron.DataConnection> {
			switch (mechanismId) {
				case TOKEN_MECHANISM_ID: {
					// Never open `md:` without a token: MotherDuck would start a browser sign-in and block.
					const token = params.token;
					if (!isNonBlankString(token)) {
						throw new Error(accessTokenRequiredMessage());
					}

					const connection = new MotherDuckConnection({
						token,
						database: optionalString(params.database),
						readOnly: isReadOnly(params),
					}, dataExplorerHandler, logger);
					await connection.connect();
					return connection;
				}
				default:
					throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
			}
		},
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			if (mechanismId !== TOKEN_MECHANISM_ID) {
				return [];
			}
			return generateMotherDuckCode(languageId, {
				token: optionalString(params.token),
				database: optionalString(params.database),
				readOnly: isReadOnly(params),
			});
		},
	};
}
