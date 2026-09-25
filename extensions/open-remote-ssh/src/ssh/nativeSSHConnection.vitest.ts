/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type Log from '../common/logger';
import NativeSSHConnection from './nativeSSHConnection';
import SSHDestination from './sshDestination';

const describePosix = process.platform === 'win32' ? describe.skip : describe;

const logger: Pick<Log, 'trace' | 'error'> = {
	trace: () => undefined,
	error: () => undefined,
};

describePosix('NativeSSHConnection', () => {
	let tempDir: string;
	let executable: string;
	let argsFile: string;

	beforeAll(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-remote-ssh-native-'));
		executable = path.join(tempDir, 'fake-ssh');
		argsFile = path.join(tempDir, 'args');
		fs.writeFileSync(executable, `#!/bin/sh
printf '%s\n' "$@" > "$NATIVE_SSH_ARGS"
case "$*" in
	*fail-command*) echo 'authentication failed' >&2; exit 255 ;;
	*ordinary-failure*) echo 'remote command failed' >&2; exit 7 ;;
esac
previous=''
for argument in "$@"; do
	if [ "$previous" = '-D' ] || [ "$previous" = '-L' ]; then
		port=$(printf '%s' "$argument" | cut -d: -f2)
		exec "$NATIVE_SSH_NODE" -e 'const net = require("net"); const server = net.createServer(socket => socket.end()); server.listen(Number(process.argv[1]), "127.0.0.1");' "$port"
	fi
	previous="$argument"
done
echo 'stdout value'
echo 'stderr value' >&2
`);
		fs.chmodSync(executable, 0o755);
	});

	afterAll(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function createConnection() {
		process.env.NATIVE_SSH_ARGS = argsFile;
		process.env.NATIVE_SSH_NODE = process.execPath;
		return new NativeSSHConnection({
			executable,
			destination: new SSHDestination('original-alias', 'remote-user', 2200),
			configFile: '/tmp/custom ssh config',
			connectTimeout: 2,
			logger,
		});
	}

	it('uses the original destination and preserves command output', async () => {
		const connection = createConnection();
		const result = await connection.exec('printf command');

		expect(result).toEqual({ stdout: 'stdout value\n', stderr: 'stderr value\n' });
		expect(fs.readFileSync(argsFile, 'utf8').trim().split('\n')).toEqual([
			'-o',
			'ConnectTimeout=2',
			'-F',
			'/tmp/custom ssh config',
			'-p',
			'2200',
			'-T',
			'remote-user@original-alias',
			'printf command',
		]);
	});

	it('rejects SSH failures but preserves ordinary remote exit statuses', async () => {
		const connection = createConnection();

		await expect(connection.exec('fail-command')).rejects.toThrow('authentication failed');
		await expect(connection.exec('ordinary-failure')).resolves.toEqual({
			stdout: '',
			stderr: 'remote command failed\n',
		});
	});

	it('waits for native tunnels and stops them during disposal', async () => {
		const connection = createConnection();
		const tunnel = await connection.addTunnel({ name: 'socks-test', socks: true });

		expect(tunnel.localPort).toBeGreaterThan(0);
		expect(fs.readFileSync(argsFile, 'utf8')).toContain(`127.0.0.1:${tunnel.localPort}`);

		await connection.close();
		await expect(new Promise<void>((resolve, reject) => {
			const socket = net.createConnection(tunnel.localPort!, '127.0.0.1');
			socket.once('connect', () => {
				socket.destroy();
				resolve();
			});
			socket.once('error', reject);
		})).rejects.toBeDefined();
	});
});
