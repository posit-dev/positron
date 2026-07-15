/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';

/**
 * An in-memory broker for the Kallichore server (kcserver) handshake.
 *
 * In web/server mode the Positron server process launches kcserver eagerly at
 * startup -- before any window (and therefore any extension host) exists -- so
 * the supervisor is warm when the first window connects. That means the process
 * that ultimately talks to kcserver (a window's extension host) is not alive
 * when kcserver is launched, so it cannot host the handshake socket itself.
 *
 * This broker bridges that gap. The long-lived server process:
 *   1. creates and listens on a same-user-locked handshake socket,
 *   2. launches kcserver pointed at it,
 *   3. receives kcserver's one-shot connection payload and caches it in memory,
 *   4. re-serves that cached payload to each window's extension host over the
 *      same socket.
 *
 * The bearer token never touches disk and never enters an environment variable;
 * only the socket *path* is published (via POSITRON_SUPERVISOR_HANDSHAKE_SOCKET),
 * and a path is not a secret. The socket is locked to the current user.
 *
 * This is the web/server counterpart to the desktop extension helper in
 * `extensions/positron-supervisor/src/HandshakeSocket.ts`; the two are
 * behaviorally identical for socket creation and payload framing (defined by
 * the kallichore side in `crates/kcserver/src/handshake_socket.rs`). Layering
 * prevents sharing one module across `src/` and `extensions/`, so keep the two
 * copies in sync.
 */
export class SupervisorHandshakeBroker {
	/**
	 * The cached connection payload reported by kcserver (raw JSON text,
	 * including any trailing newline). Undefined until kcserver reports in; the
	 * first inbound connection is treated as the report-in, and every subsequent
	 * connection is replayed the cached text.
	 */
	private _cached: string | undefined;

	private _readyResolve!: () => void;
	private _readyReject!: (err: Error) => void;
	private readonly _ready: Promise<void>;

	private _disposed = false;

	private constructor(
		private readonly _server: net.Server,
		/**
		 * The path (Unix socket) or name (Windows named pipe) to pass to
		 * kcserver via `--handshake-socket` and to publish to extension hosts.
		 */
		public readonly socketPath: string,
		/**
		 * The private 0700 directory containing the Unix socket, if any, to be
		 * removed on dispose. Undefined on Windows (named pipes have no backing
		 * directory).
		 */
		private _socketDir: string | undefined,
	) {
		this._ready = new Promise<void>((resolve, reject) => {
			this._readyResolve = resolve;
			this._readyReject = reject;
		});
		// Ensure a rejection (e.g. on dispose before ready() is awaited) is
		// always considered handled, so it never surfaces as an unhandled
		// rejection. Callers observe the outcome through ready().
		this._ready.catch(() => { /* handled via ready() */ });

		this._server.on('connection', (socket) => this._onConnection(socket));
		this._server.on('error', (err) => this._readyReject(err));
	}

	/**
	 * Handles an inbound connection. The first connection is kcserver reporting
	 * in (we read its payload to EOF and cache it); every later connection is a
	 * window's extension host reading the cached payload back out.
	 */
	private _onConnection(socket: net.Socket): void {
		if (this._cached === undefined) {
			// kcserver reporting in: read the payload to EOF and cache it.
			let text = '';
			socket.setEncoding('utf8');
			socket.on('data', (chunk: string) => { text += chunk; });
			socket.on('end', () => {
				this._cached = text;
				this._readyResolve();
			});
			socket.on('error', (err) => this._readyReject(err));
		} else {
			// A window reading the cached payload back out: replay and close.
			socket.end(this._cached);
		}
	}

	/**
	 * Creates and starts listening on a handshake broker socket, secured to the
	 * current user.
	 *
	 * @param baseName A short, unique base name used to derive the Windows named
	 *  pipe name. Ignored on Unix, where the per-call private directory already
	 *  guarantees uniqueness.
	 * @returns A promise that resolves with the listening broker.
	 */
	public static async create(baseName: string): Promise<SupervisorHandshakeBroker> {
		if (os.platform() === 'win32') {
			// Windows: use a named pipe. Node's named-pipe server does not expose
			// a way to set a restrictive DACL, so the pipe uses the default
			// security descriptor; the bearer token remains the primary gate on
			// the main transport (defense in depth).
			const pipeName = `\\\\.\\pipe\\kallichore-handshake-${baseName}`;
			const server = await SupervisorHandshakeBroker.listen(pipeName);
			return new SupervisorHandshakeBroker(server, pipeName, undefined);
		}

		// Unix: create the socket inside a private 0700 directory under
		// XDG_RUNTIME_DIR (a user-private location) when set, else the temp dir.
		// mkdtemp creates the directory with 0700 permissions and a unique name,
		// so the socket file itself uses a short constant name: uniqueness is
		// already handled by the directory, and a short path keeps us well under
		// the platform's Unix socket path length limit (104 bytes on macOS, the
		// binding case since XDG_RUNTIME_DIR is Linux-only and macOS falls back
		// to a long os.tmpdir()).
		const runtimeDir = process.env['XDG_RUNTIME_DIR'] || os.tmpdir();
		const socketDir = await fs.promises.mkdtemp(path.join(runtimeDir, 'kc-handshake-'));
		const socketPath = path.join(socketDir, 's.sock');
		const server = await SupervisorHandshakeBroker.listen(socketPath);

		// Lock the socket file down to the current user only.
		try {
			await fs.promises.chmod(socketPath, 0o600);
		} catch {
			// Best effort; the containing 0700 directory already restricts access.
		}

		return new SupervisorHandshakeBroker(server, socketPath, socketDir);
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
	 * Awaits kcserver reporting its connection details over the handshake
	 * socket.
	 *
	 * @param timeoutMs How long to wait for kcserver to connect and report in.
	 * @throws An error if kcserver does not report in within the timeout.
	 */
	public async ready(timeoutMs: number): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error(
					`Timed out waiting for the supervisor to connect to the ` +
					`handshake socket after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		try {
			await Promise.race([this._ready, timeout]);
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}
	}

	/**
	 * Closes the listening socket and removes the backing socket file/directory.
	 */
	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;

		// Reject any still-pending ready() so callers awaiting it don't hang.
		this._readyReject(new Error('Handshake broker was disposed'));

		try {
			this._server.close();
		} catch {
			// Ignore; the server may already be closed.
		}

		if (this._socketDir) {
			try {
				fs.rmSync(this._socketDir, { recursive: true, force: true });
			} catch {
				// Best effort cleanup.
			}
			this._socketDir = undefined;
		}
	}
}
