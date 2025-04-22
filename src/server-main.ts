/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './bootstrap-server.js'; // this MUST come before other imports as it changes global state
import * as path from 'path';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as readline from 'readline';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import minimist from 'minimist';
import { devInjectNodeModuleLookupPath, removeGlobalNodeJsModuleLookupPaths } from './bootstrap-node.js';
import { bootstrapESM } from './bootstrap-esm.js';
import { resolveNLSConfiguration } from './vs/base/node/nls.js';
import { product } from './bootstrap-meta.js';
import * as perf from './vs/base/common/performance.js';
import { INLSConfiguration } from './vs/nls.js';
import { IServerAPI } from './vs/server/node/remoteExtensionHostAgentServer.js';

// --- Start PWB ---
import * as fs from 'fs';
import * as https from 'https';
// --- End PWB ---

// --- Start Positron ---
import { spawn } from 'child_process';
import { getUserDataPath } from './vs/platform/environment/node/userDataPath.js';
// --- End Positron ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));

perf.mark('code/server/start');
(globalThis as any).vscodeServerStartTime = performance.now();

// Do a quick parse to determine if a server or the cli needs to be started
const parsedArgs = minimist(process.argv.slice(2), {
	boolean: ['start-server', 'list-extensions', 'print-ip-address', 'help', 'version', 'accept-server-license-terms', 'update-extensions'],
	// --- Start PWB ---
	// PWB: adding cert and cert-key options to string arg list
	string: ['install-extension', 'install-builtin-extension', 'uninstall-extension', 'locate-extension', 'socket-path', 'host', 'port', 'compatibility', 'cert-key', 'cert'],
	// --- End PWB ---
	alias: { help: 'h', version: 'v' }
});
['host', 'port', 'accept-server-license-terms'].forEach(e => {
	if (!parsedArgs[e]) {
		const envValue = process.env[`VSCODE_SERVER_${e.toUpperCase().replace('-', '_')}`];
		if (envValue) {
			parsedArgs[e] = envValue;
		}
	}
});

const extensionLookupArgs = ['list-extensions', 'locate-extension'];
const extensionInstallArgs = ['install-extension', 'install-builtin-extension', 'uninstall-extension', 'update-extensions'];

const shouldSpawnCli = parsedArgs.help || parsedArgs.version || extensionLookupArgs.some(a => !!parsedArgs[a]) || (extensionInstallArgs.some(a => !!parsedArgs[a]) && !parsedArgs['start-server']);

const nlsConfiguration = await resolveNLSConfiguration({ userLocale: 'en', osLocale: 'en', commit: product.commit, userDataPath: '', nlsMetadataPath: __dirname });

if (shouldSpawnCli) {
	loadCode(nlsConfiguration).then((mod) => {
		mod.spawnCli();
	});
} else {
	let _remoteExtensionHostAgentServer: IServerAPI | null = null;
	let _remoteExtensionHostAgentServerPromise: Promise<IServerAPI> | null = null;
	const getRemoteExtensionHostAgentServer = () => {
		if (!_remoteExtensionHostAgentServerPromise) {
			_remoteExtensionHostAgentServerPromise = loadCode(nlsConfiguration).then(async (mod) => {
				const server = await mod.createServer(address);
				_remoteExtensionHostAgentServer = server;
				return server;
			});
		}
		return _remoteExtensionHostAgentServerPromise;
	};


	if (Array.isArray(product.serverLicense) && product.serverLicense.length) {
		console.log(product.serverLicense.join('\n'));
		if (product.serverLicensePrompt && parsedArgs['accept-server-license-terms'] !== true) {
			if (hasStdinWithoutTty()) {
				console.log('To accept the license terms, start the server with --accept-server-license-terms');
				process.exit(1);
			}
			try {
				const accept = await prompt(product.serverLicensePrompt);
				if (!accept) {
					process.exit(1);
				}
			} catch (e) {
				console.log(e);
				process.exit(1);
			}
		}
	}

	let firstRequest = true;
	let firstWebSocket = true;

	let address: string | AddressInfo | null = null;
	// --- Start PWB ---
	const useSSL = (parsedArgs['cert-key'] && parsedArgs['cert']) ? true : false;
	// @ts-ignore: https/http type conditionals confuse TS
	const server = (useSSL ? https : http).createServer(useSSL ? {
		key: fs.readFileSync(parsedArgs['cert-key']),
		cert: fs.readFileSync(parsedArgs['cert']),
		// @ts-ignore req/res types not inferred
	} : {}, async (req, res) => {
		if (firstRequest) {
			firstRequest = false;
			perf.mark('code/server/firstRequest');
		}
		const remoteExtensionHostAgentServer = await getRemoteExtensionHostAgentServer();
		return remoteExtensionHostAgentServer.handleRequest(req, res);
	});
	// PWB Modify Start: Add upgradedHead parameter to handleUpgrade for server proxy support
	// @ts-ignore argument types not inferred
	server.on('upgrade', async (req, socket, upgradeHead) => {
		// PWB Modify End
		if (firstWebSocket) {
			firstWebSocket = false;
			perf.mark('code/server/firstWebSocket');
		}
		const remoteExtensionHostAgentServer = await getRemoteExtensionHostAgentServer();
		// PWB Modify Start: Add upgradedHead parameter to handleUpgrade for server proxy support
		// @ts-ignore
		return remoteExtensionHostAgentServer.handleUpgrade(req, socket, upgradeHead);
		// PWB Modify End
	});
	// @ts-ignore argument types not inferred
	server.on('error', async (err) => {
		const remoteExtensionHostAgentServer = await getRemoteExtensionHostAgentServer();
		return remoteExtensionHostAgentServer.handleServerError(err);
	});
	// --- End PWB ---

	const host = sanitizeStringArg(parsedArgs['host']) || (parsedArgs['compatibility'] !== '1.63' ? 'localhost' : undefined);
	const nodeListenOptions = (
		parsedArgs['socket-path']
			? { path: sanitizeStringArg(parsedArgs['socket-path']) }
			: { host, port: await parsePort(host, sanitizeStringArg(parsedArgs['port'])) }
	);
	server.listen(nodeListenOptions, async () => {
		let output = Array.isArray(product.serverGreeting) && product.serverGreeting.length ? `\n\n${product.serverGreeting.join('\n')}\n\n` : ``;

		if (typeof nodeListenOptions.port === 'number' && parsedArgs['print-ip-address']) {
			const ifaces = os.networkInterfaces();
			Object.keys(ifaces).forEach(function (ifname) {
				ifaces[ifname]?.forEach(function (iface) {
					if (!iface.internal && iface.family === 'IPv4') {
						output += `IP Address: ${iface.address}\n`;
					}
				});
			});
		}

		address = server.address();
		if (address === null) {
			throw new Error('Unexpected server address');
		}

		output += `Server bound to ${typeof address === 'string' ? address : `${address.address}:${address.port} (${address.family})`}\n`;
		// Do not change this line. VS Code looks for this in the output.
		output += `Extension host agent listening on ${typeof address === 'string' ? address : address.port}\n`;
		console.log(output);

		perf.mark('code/server/started');
		(globalThis as any).vscodeServerListenTime = performance.now();

		await getRemoteExtensionHostAgentServer();
	});

	process.on('exit', () => {
		server.close();
		if (_remoteExtensionHostAgentServer) {
			_remoteExtensionHostAgentServer.dispose();
		}
	});

	// --- Start Positron ---
	await startKernelSupervisor();
	// --- End Positron ---
}

function sanitizeStringArg(val: any): string | undefined {
	if (Array.isArray(val)) { // if an argument is passed multiple times, minimist creates an array
		val = val.pop(); // take the last item
	}
	return typeof val === 'string' ? val : undefined;
}

/**
 * If `--port` is specified and describes a single port, connect to that port.
 *
 * If `--port`describes a port range
 * then find a free port in that range. Throw error if no
 * free port available in range.
 *
 * In absence of specified ports, connect to port 8000.
 */
async function parsePort(host: string | undefined, strPort: string | undefined): Promise<number> {
	if (strPort) {
		let range: { start: number; end: number } | undefined;
		if (strPort.match(/^\d+$/)) {
			return parseInt(strPort, 10);
		} else if (range = parseRange(strPort)) {
			const port = await findFreePort(host, range.start, range.end);
			if (port !== undefined) {
				return port;
			}
			// Remote-SSH extension relies on this exact port error message, treat as an API
			console.warn(`--port: Could not find free port in range: ${range.start} - ${range.end} (inclusive).`);
			process.exit(1);

		} else {
			console.warn(`--port "${strPort}" is not a valid number or range. Ranges must be in the form 'from-to' with 'from' an integer larger than 0 and not larger than 'end'.`);
			process.exit(1);
		}
	}
	return 8000;
}

function parseRange(strRange: string): { start: number; end: number } | undefined {
	const match = strRange.match(/^(\d+)-(\d+)$/);
	if (match) {
		const start = parseInt(match[1], 10), end = parseInt(match[2], 10);
		if (start > 0 && start <= end && end <= 65535) {
			return { start, end };
		}
	}
	return undefined;
}

/**
 * Starting at the `start` port, look for a free port incrementing
 * by 1 until `end` inclusive. If no free port is found, undefined is returned.
 */
async function findFreePort(host: string | undefined, start: number, end: number): Promise<number | undefined> {
	const testPort = (port: number) => {
		return new Promise((resolve) => {
			const server = http.createServer();
			server.listen(port, host, () => {
				server.close();
				resolve(true);
			}).on('error', () => {
				resolve(false);
			});
		});
	};
	for (let port = start; port <= end; port++) {
		if (await testPort(port)) {
			return port;
		}
	}
	return undefined;
}

async function loadCode(nlsConfiguration: INLSConfiguration) {

	// required for `bootstrap-esm` to pick up NLS messages
	process.env['VSCODE_NLS_CONFIG'] = JSON.stringify(nlsConfiguration);

	// See https://github.com/microsoft/vscode-remote-release/issues/6543
	// We would normally install a SIGPIPE listener in bootstrap-node.js
	// But in certain situations, the console itself can be in a broken pipe state
	// so logging SIGPIPE to the console will cause an infinite async loop
	process.env['VSCODE_HANDLES_SIGPIPE'] = 'true';

	if (process.env['VSCODE_DEV']) {
		// When running out of sources, we need to load node modules from remote/node_modules,
		// which are compiled against nodejs, not electron
		process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'] = process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'] || path.join(__dirname, '..', 'remote', 'node_modules');
		devInjectNodeModuleLookupPath(process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH']);
	} else {
		delete process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'];
	}

	// Remove global paths from the node module lookup (node.js only)
	removeGlobalNodeJsModuleLookupPaths();

	// Bootstrap ESM
	await bootstrapESM();

	// Load Server
	return import('./vs/server/node/server.main.js');
}

function hasStdinWithoutTty(): boolean {
	try {
		return !process.stdin.isTTY; // Via https://twitter.com/MylesBorins/status/782009479382626304
	} catch (error) {
		// Windows workaround for https://github.com/nodejs/node/issues/11656
	}
	return false;
}

function prompt(question: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise((resolve, reject) => {
		rl.question(question + ' ', async function (data) {
			rl.close();
			const str = data.toString().trim().toLowerCase();
			if (str === '' || str === 'y' || str === 'yes') {
				resolve(true);
			} else if (str === 'n' || str === 'no') {
				resolve(false);
			} else {
				process.stdout.write('\nInvalid Response. Answer either yes (y, yes) or no (n, no)\n');
				resolve(await prompt(question));
			}
		});
	});
}

// --- Start Positron ---
/**
 * Start a Positron Kernel Supervisor process. This process is shared among all
 * the windows that connect to this server. We start it here so that it'll be warm
 * when the first window connects.
 */
async function startKernelSupervisor() {
	// Create the connection and log file paths. We put these in the user data
	// path rather than the temporary directory since some environments clean up
	// the temporary directory aggressively.
	const userDataPath = getUserDataPath(parsedArgs, product.nameShort || 'positron');
	const connectionFile = path.join(userDataPath, `positron-supervisor-${process.pid}.json`);
	const logFile = path.join(userDataPath, `positron-supervisor-${process.pid}.log`);

	// Unlikely, but if the files already exist, delete them; they are stale.
	if (fs.existsSync(connectionFile)) {
		fs.unlinkSync(connectionFile);
	}
	if (fs.existsSync(logFile)) {
		fs.unlinkSync(logFile);
	}

	// Create the user data dir
	const userDataDir = path.dirname(connectionFile);
	if (!fs.existsSync(userDataDir)) {
		try {
			fs.mkdirSync(userDataDir, { recursive: true });
		} catch (err) {
			console.error(`Failed to create user data directory for supervisor files: ${userDataDir}`, err);
		}
	}

	// Pass the connection file path to the supervisor extension.
	process.env['POSITRON_SUPERVISOR_CONNECTION_FILE'] = connectionFile;

	// Search local paths for the supervisor
	const supervisorPaths = [
		// Dev build of the supervisor in the kallichore repository (debug version)
		path.join(__dirname, '..', '..',
			'kallichore', 'target', 'debug', 'kcserver'),
		// Dev build of the supervisor in the kallichore repository (release version)
		path.join(__dirname, '..', '..',
			'kallichore', 'target', 'release', 'kcserver'),
		// Release build of the supervisor, or a dev build in the extensions folder
		path.join(__dirname, '..',
			'extensions', 'positron-supervisor', 'resources', 'kallichore', 'kcserver'),
	];

	// Find the first of these paths that exists.
	const supervisorPath = supervisorPaths.find((p) => fs.existsSync(p));
	if (!supervisorPath) {
		process.stderr.write('The Positron Kernel Supervisor was not found and will not be started.\n');
		return;
	}

	// Start the supervisor process.
	process.stdout.write(`\nStarting Positron Kernel Supervisor (${supervisorPath})...\n`);
	const supervisorProcess = spawn(supervisorPath, [
		'--connection-file', connectionFile, '--log-file', logFile,]);
	supervisorProcess.stdout.on('data', (data) => {
		process.stdout.write(data);
	});
	supervisorProcess.stderr.on('data', (data) => {
		process.stderr.write(data);
	});
}
// --- End Positron ---
