/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { KallichoreServerState } from './ServerState.js';
import { PromiseHandles } from './async.js';

/**
 * A client-owned handshake socket used to receive connection details from the
 * Kallichore server (kcserver) at launch.
 *
 * Instead of kcserver writing a connection *file* that Positron polls for,
 * Positron creates and listens on this socket *first*, launches kcserver with
 * `--handshake-socket <path>`, and kcserver connects to it once and writes a
 * single JSON document ({@link KallichoreServerState}) describing the
 * connection (transport, address, bearer token, server id, pid, log path),
 * then closes. This avoids the "server wrote a file the client cannot see yet"
 * race (e.g. on Windows when aggressive antivirus scans the file) and keeps the
 * bearer token off disk.
 *
 * The socket is same-user-only: on Unix it lives inside a `0700` directory and
 * the socket file itself is set to `0600`; on Windows it is a named pipe. This
 * preserves the same trust boundary the old `0600` connection file gave us.
 *
 * The wire contract (framing and field names) is defined by the kallichore side
 * (`crates/kcserver/src/handshake_socket.rs`); a behaviorally identical broker
 * implementation lives in `src/server-supervisor-handshake.ts` for the
 * web/server path. Keep the three in sync.
 */
export class HandshakeSocket implements vscode.Disposable {
	/**
	 * Resolves with the first payload received from kcserver, or rejects if the
	 * connection produces invalid JSON.
	 */
	private readonly _payload = new PromiseHandles<KallichoreServerState>();

	/**
	 * The private `0700` directory containing the Unix socket, if any, to be
	 * removed on dispose. Undefined on Windows (named pipes have no backing
	 * directory).
	 */
	private _socketDir: string | undefined;

	private _disposed = false;

	private constructor(
		private readonly _server: net.Server,
		/**
		 * The path (Unix socket) or name (Windows named pipe) to pass to
		 * kcserver via `--handshake-socket`.
		 */
		public readonly socketPath: string,
		socketDir: string | undefined,
	) {
		this._socketDir = socketDir;

		// On the first inbound connection, read the payload to EOF and resolve.
		this._server.on('connection', (socket: net.Socket) => {
			let text = '';
			socket.setEncoding('utf8');
			socket.on('data', (chunk: string) => { text += chunk; });
			socket.on('end', () => {
				try {
					const parsed = JSON.parse(text) as KallichoreServerState;
					this._payload.resolve(parsed);
				} catch (err) {
					this._payload.reject(
						new Error(`Failed to parse handshake payload: ${err}`));
				}
			});
			socket.on('error', (err) => {
				this._payload.reject(err);
			});
		});

		this._server.on('error', (err) => {
			this._payload.reject(err);
		});
	}

	/**
	 * Creates and starts listening on a handshake socket, secured to the current
	 * user.
	 *
	 * @param baseName A short, unique base name (e.g. including the session id)
	 *  used to derive the socket path / pipe name so concurrent servers do not
	 *  collide.
	 * @returns A promise that resolves with the listening handshake socket.
	 */
	public static async create(baseName: string): Promise<HandshakeSocket> {
		if (os.platform() === 'win32') {
			// Windows: use a named pipe. Node's named-pipe server does not expose
			// a way to set a restrictive DACL, so the pipe uses the default
			// security descriptor; the bearer token remains the primary gate on
			// the main transport (defense in depth). See the open question in
			// HANDSHAKE_SOCKET_POSITRON_PLAN.md section 8.
			const pipeName = `\\\\.\\pipe\\kallichore-handshake-${baseName}`;
			const server = await HandshakeSocket.listen(pipeName);
			return new HandshakeSocket(server, pipeName, undefined);
		}

		// Unix: create the socket inside a private 0700 directory under
		// XDG_RUNTIME_DIR (a user-private location) when set, else the temp dir.
		// mkdtemp creates the directory with 0700 permissions. Keep the base
		// short to stay under the platform's Unix socket path length limit.
		const runtimeDir = process.env['XDG_RUNTIME_DIR'] || os.tmpdir();
		const socketDir = await fs.promises.mkdtemp(path.join(runtimeDir, 'kc-handshake-'));
		const socketPath = path.join(socketDir, `${baseName}.sock`);
		const server = await HandshakeSocket.listen(socketPath);

		// Lock the socket file down to the current user only.
		try {
			await fs.promises.chmod(socketPath, 0o600);
		} catch {
			// Best effort; the containing 0700 directory already restricts access.
		}

		return new HandshakeSocket(server, socketPath, socketDir);
	}

	/**
	 * Creates a listening `net.Server` bound to the given path/pipe name.
	 */
	private static listen(listenPath: string): Promise<net.Server> {
		return new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once('error', reject);
			server.listen(listenPath, () => {
				server.removeListener('error', reject);
				resolve(server);
			});
		});
	}

	/**
	 * Awaits the connection payload written by kcserver.
	 *
	 * @param timeoutMs How long to wait for kcserver to connect and report in.
	 * @returns The parsed connection details.
	 * @throws An error if kcserver does not connect within the timeout or sends
	 *  an invalid payload.
	 */
	public async payload(timeoutMs: number): Promise<KallichoreServerState> {
		const timer = new Promise<never>((_, reject) => {
			const handle = setTimeout(() => {
				reject(new Error(
					`Timed out waiting for the supervisor to connect to the ` +
					`handshake socket after ${timeoutMs}ms`));
			}, timeoutMs);
			// Do not keep the event loop alive solely for this timer.
			handle.unref?.();
		});
		return Promise.race([this._payload.promise, timer]);
	}

	/**
	 * Closes the listening socket and removes the backing socket file/directory.
	 */
	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;

		try {
			this._server.close();
		} catch {
			// Ignore; the server may already be closed.
		}

		// Remove the private directory (and the Unix socket file inside it).
		if (this._socketDir) {
			try {
				fs.rmSync(this._socketDir, { recursive: true, force: true });
			} catch {
				// Best effort cleanup.
			}
			this._socketDir = undefined;
		}
	}

	/**
	 * Connects to an existing handshake socket as a client and reads the single
	 * JSON payload it serves. Used to retrieve connection details from a broker
	 * (the web/server path's `server-main.ts`) that is re-serving cached
	 * details over the socket named by `POSITRON_SUPERVISOR_HANDSHAKE_SOCKET`.
	 *
	 * @param socketPath The socket path / named pipe to connect to.
	 * @param timeoutMs How long to wait for the payload.
	 * @returns The parsed connection details.
	 */
	public static connect(socketPath: string, timeoutMs: number): Promise<KallichoreServerState> {
		const handles = new PromiseHandles<KallichoreServerState>();

		const socket = net.connect(socketPath);
		let text = '';
		socket.setEncoding('utf8');
		socket.on('data', (chunk: string) => { text += chunk; });
		socket.on('end', () => {
			try {
				handles.resolve(JSON.parse(text) as KallichoreServerState);
			} catch (err) {
				handles.reject(new Error(`Failed to parse handshake payload: ${err}`));
			}
		});
		socket.on('error', (err) => handles.reject(err));

		const timer = setTimeout(() => {
			socket.destroy();
			handles.reject(new Error(
				`Timed out reading handshake payload from ${socketPath} after ${timeoutMs}ms`));
		}, timeoutMs);
		timer.unref?.();

		return handles.promise.finally(() => {
			clearTimeout(timer);
			socket.destroy();
		});
	}
}
