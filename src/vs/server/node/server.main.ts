/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as net from 'net';
import { FileAccess } from '../../base/common/network.js';
import { run as runCli } from './remoteExtensionHostAgentCli.js';
import { createServer as doCreateServer, IServerAPI } from './remoteExtensionHostAgentServer.js';
import { parseArgs, ErrorReporter } from '../../platform/environment/node/argv.js';
import { join, dirname } from '../../base/common/path.js';
import { performance } from 'perf_hooks';
import { serverOptions } from './serverEnvironmentService.js';
import product from '../../platform/product/common/product.js';
import * as perf from '../../base/common/performance.js';

// --- Start PWB ---
// eslint-disable-next-line no-duplicate-imports
import { ServerParsedArgs } from './serverEnvironmentService.js';
// --- End PWB ---

perf.mark('code/server/codeLoaded');
(<any>global).vscodeServerCodeLoadedTime = performance.now();

const errorReporter: ErrorReporter = {
	onMultipleValues: (id: string, usedValue: string) => {
		console.error(`Option '${id}' can only be defined once. Using value ${usedValue}.`);
	},
	onEmptyValue: (id) => {
		console.error(`Ignoring option '${id}': Value must not be empty.`);
	},
	onUnknownOption: (id: string) => {
		console.error(`Ignoring option '${id}': not supported for server.`);
	},
	onDeprecatedOption: (deprecatedOption: string, message) => {
		console.warn(`Option '${deprecatedOption}' is deprecated: ${message}`);
	}
};

// --- Start PWB ---
function parse(): ServerParsedArgs {
	return parseArgs(process.argv.slice(2), serverOptions, errorReporter);
}

function createDirs(args: ServerParsedArgs): string {

	const REMOTE_DATA_FOLDER = args['server-data-dir'] || args['user-data-dir'] || process.env['VSCODE_AGENT_FOLDER'] || join(os.homedir(), product.serverDataFolderName || '.vscode-remote');
	const USER_DATA_PATH = args['user-data-dir'] || join(REMOTE_DATA_FOLDER, 'data');
	const APP_SETTINGS_HOME = join(USER_DATA_PATH, 'User');
	const GLOBAL_STORAGE_HOME = join(APP_SETTINGS_HOME, 'globalStorage');
	const LOCAL_HISTORY_HOME = join(APP_SETTINGS_HOME, 'History');
	const MACHINE_SETTINGS_HOME = join(USER_DATA_PATH, 'Machine');
	args['user-data-dir'] = USER_DATA_PATH;
	const APP_ROOT = dirname(FileAccess.asFileUri('').fsPath);
	const BUILTIN_EXTENSIONS_FOLDER_PATH = join(APP_ROOT, 'extensions');
	args['builtin-extensions-dir'] = BUILTIN_EXTENSIONS_FOLDER_PATH;
	args['extensions-dir'] = args['extensions-dir'] || join(REMOTE_DATA_FOLDER, 'extensions');

	[REMOTE_DATA_FOLDER, args['extensions-dir'], USER_DATA_PATH, APP_SETTINGS_HOME, MACHINE_SETTINGS_HOME, GLOBAL_STORAGE_HOME, LOCAL_HISTORY_HOME].forEach(f => {
		try {
			if (!fs.existsSync(f)) {
				fs.mkdirSync(f, { mode: 0o700 });
			}
		} catch (err) { console.error(err); }
	});
	return REMOTE_DATA_FOLDER;
}
// --- End PWB ---

/**
 * invoked by server-main.js
 */
// --- Start PWB ---
export function spawnCli(args = parse()) {
	runCli(args, createDirs(args), serverOptions);
	// --- End PWB ---
}

/**
 * invoked by server-main.js
 */
// --- Start PWB ---
export function createServer(address: string | net.AddressInfo | null, args = parse()): Promise<IServerAPI> {
	return doCreateServer(address, args, createDirs(args));
	// --- End PWB ---
}
