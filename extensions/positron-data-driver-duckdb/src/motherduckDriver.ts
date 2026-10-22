/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBDataExplorerRpcHandler, DuckDBWorkerClient, WorkerOpenConfig } from 'positron-data-explorer-duckdb';
import { generateMotherDuckCode, motherduckLanguageIds } from './motherduckCode.js';
import { MotherDuckConnection } from './motherduckConnection.js';

/** The id of the environment variable mechanism, matching the pins driver's. */
const ENVVAR_MECHANISM_ID = 'envvar';

/** Optional dependencies, injectable for tests. */
export interface MotherDuckDriverDeps {
	/** The environment that `motherduck_token` is read from; defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** Creates each connection's worker client; defaults to a real `DuckDBWorkerClient`. */
	createClient?: (config: WorkerOpenConfig) => DuckDBWorkerClient;
}

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
 * @param deps Optional dependencies, injectable for tests.
 */
export function createMotherDuckDriver(
	context: vscode.ExtensionContext,
	dataExplorerHandler: DuckDBDataExplorerRpcHandler,
	logger?: positron.DataConnectionLogger,
	deps: MotherDuckDriverDeps = {}
): positron.DataConnectionDriver {
	const env = deps.env ?? process.env;
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
				id: ENVVAR_MECHANISM_ID,
				label: vscode.l10n.t('Environment Variable'),
				description: vscode.l10n.t('Use the motherduck_token environment variable. Set it where Positron, and the R, Python, or ggsql sessions that run your code, can read it, for example in your shell profile or, on Windows, in your user environment variables.'),
				parameters: [
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
				case ENVVAR_MECHANISM_ID: {
					// Never open `md:` without a token: MotherDuck would start a browser sign-in and block.
					const token = env.motherduck_token;
					if (!isNonBlankString(token)) {
						throw new Error(vscode.l10n.t("Set the motherduck_token environment variable to your MotherDuck access token, then restart Positron and reconnect. For example, add export motherduck_token='<token>' to your shell profile, or on Windows, add it to your user environment variables."));
					}
					// DuckDB reads anything after `?` in an `md:` path as connection options.
					const database = optionalString(params.database);
					if (database !== undefined && /[?#]/.test(database)) {
						throw new Error(vscode.l10n.t("The default database name cannot contain '?' or '#'."));
					}

					const connection = new MotherDuckConnection({
						token: token.trim(),
						database,
						readOnly: isReadOnly(params),
					}, dataExplorerHandler, logger, deps.createClient);
					await connection.connect();
					return connection;
				}
				default:
					throw new Error(vscode.l10n.t("Unknown connection mechanism '{0}'.", mechanismId));
			}
		},
		async generateConnectionCode(mechanismId: string, languageId: string, params: positron.DataConnectionParameterValues): Promise<positron.ConnectionCodeVariant[]> {
			if (mechanismId !== ENVVAR_MECHANISM_ID) {
				return [];
			}
			return generateMotherDuckCode(languageId, {
				database: optionalString(params.database),
				readOnly: isReadOnly(params),
			});
		},
	};
}
