/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const cp = require('child_process');
const path = require('path');
const opn = require('opn');
const minimist = require('minimist');

// --- Start Positron ---
const fs = require('fs');
// --- End Positron ---

async function main() {

	const args = minimist(process.argv.slice(2), {
		boolean: [
			'help',
			'launch'
		]
	});

	if (args.help) {
		console.log(
			'./scripts/code-server.sh|bat [options]\n' +
			' --launch              Opens a browser'
		);
		startServer(['--help']);
		return;
	}

	process.env['VSCODE_SERVER_PORT'] = '9888';

	const serverArgs = process.argv.slice(2).filter(v => v !== '--launch');

	// --- Start Positron ---
	// Check for a Positron license issuer binary at the expected location. This
	// is only common for developer setups; typically licenses keys are issued
	// by the environment in which Positron is hosted.
	//
	// TODO(jmcphers): Use a pre-built binary for this. This formulation is for
	// developers with locally built copies of the license issuer.
	const positronIssuerPath = path.join(__dirname, '..', '..', 'positron-license', 'pdol', 'target', 'debug', 'pdol');

	if (fs.existsSync(positronIssuerPath)) {
		// Get the connection token from the set of server arguments (it's the first one after --connection-token).
		const connectionTokenIndex = serverArgs.indexOf('--connection-token');
		if (connectionTokenIndex === -1) {
			console.error('No --connection-token found in server arguments.');
			process.exit(1);
		}
		const connectionToken = serverArgs[connectionTokenIndex + 1];

		// Run the license issuer binary to get a license key.
		const licenseKey = cp.execFileSync(positronIssuerPath, ['--connection-token', connectionToken]);
		process.env['POSITRON_LICENSE_KEY'] = licenseKey.toString();
	}
	// --- End Positron ---

	const addr = await startServer(serverArgs);
	if (args['launch']) {
		opn(addr);
	}
}

function startServer(programArgs) {
	return new Promise((s, e) => {
		const env = { ...process.env };
		const entryPoint = path.join(__dirname, '..', 'out', 'server-main.js');

		console.log(`Starting server: ${entryPoint} ${programArgs.join(' ')}`);
		const proc = cp.spawn(process.execPath, [entryPoint, ...programArgs], { env, stdio: [process.stdin, null, process.stderr] });
		proc.stdout.on('data', e => {
			const data = e.toString();
			process.stdout.write(data);
			const m = data.match(/Web UI available at (.*)/);
			if (m) {
				s(m[1]);
			}
		});

		proc.on('exit', (code) => process.exit(code));

		process.on('exit', () => proc.kill());
		process.on('SIGINT', () => {
			proc.kill();
			process.exit(128 + 2); // https://nodejs.org/docs/v14.16.0/api/process.html#process_signal_events
		});
		process.on('SIGTERM', () => {
			proc.kill();
			process.exit(128 + 15); // https://nodejs.org/docs/v14.16.0/api/process.html#process_signal_events
		});
	});

}

main();

