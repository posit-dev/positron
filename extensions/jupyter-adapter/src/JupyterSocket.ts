/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as zmq from 'zeromq/v5-compat';
import * as vscode from 'vscode';

export class JupyterSocket implements vscode.Disposable {
	private readonly _socket: zmq.Socket;
	private readonly _title: string;
	private _addr: string;
	private _port: number;

	/**
	 * Create a new JupyterSocket
	 *
	 * @param title The title of the socket
	 * @param socket The underlying ZeroMQ socket
	 * @param _channel The output channel to use for debugging
	 */
	constructor(title: string, socket: zmq.Socket,
		private readonly _logger: (msg: string) => void) {
		this._socket = socket;
		this._title = title;

		this._addr = '';
		this._port = 0;
	}

	/**
	 * Sets the ZeroMQ identity of the socket; to be called before the socket is
	 * bound/connected if a specific identity is required
	 *
	 * @param identity The ZeroMQ identity of the socket, as a buffer of bytes
	 *   (typically a UUID)
	 */
	public setZmqIdentity(identity: Buffer): void {
		this._socket.setsockopt('identity', identity);
	}

	/**
	 * Connects the socket to the given port (on localhost), which is presumed
	 * to be available.
	 *
	 * @param port The port to connect to.
	 */
	public async connect(port: number) {
		const maxWaitSeconds = 30;
		this._port = port;
		this._addr = 'tcp://127.0.0.1:' + port.toString();
		this._logger(`${this._title} socket connecting to ${this._addr}...`);

		// Monitor the socket for events; this is necessary to get events like
		// `connect` to fire (otherwise we just get `message` events from the
		// socket)
		//
		// We also have to ignore type checking for this line because the type
		// definitions for `zmq` insist on passing a monitoring interval to
		// monitor(), but the underlying library ignores the interval and emits
		// a warning if one is passed.
		//
		// @ts-ignore
		this._socket.monitor();

		// Track how long we have been waiting to connect
		const startTime = Date.now();

		// Resolve the promise when the socket connects
		return new Promise<void>((resolve, reject) => {
			this._socket.on('connect', (_evt, addr) => {
				this._logger(`${this._title} socket connected to ${addr}`);
				resolve();
			});

			// If the socket fails to connect, reject the promise
			this._socket.on('connect_delay', (_evt, addr) => {
				// We give up if we've exceeded our max wait time
				const elapsed = (Date.now() - startTime) / 1000;
				if (elapsed > maxWaitSeconds) {
					this._logger(`${this._title} socket failed to connect to ${addr} after ${elapsed} seconds`);
					reject();
				}
			});

			// Initiate the actual connection to the TCP address
			this._socket.connect(this._addr);
		});
	}

	/**
	 * Gets the underlying ZeroMQ socket
	 *
	 * @returns A ZeroMQ socket
	 */
	public socket(): zmq.Socket {
		return this._socket;
	}

	/**
	 * Gets the address used by the socket
	 *
	 * @returns The address, or an empty string if the socket is unbound
	 */
	public address(): string {
		return this._addr;
	}

	/**
	 * Get the port used by the socket
	 *
	 * @returns The port, or 0 if the socket is unbound
	 */
	public port(): number {
		return this._port;
	}

	/**
	 * Gets the title of the socket (for debugging purposes)
	 *
	 * @returns The title of the socket
	 */
	public title(): string {
		return this._title;
	}

	/**
	 * Cleans up the socket.
	 */
	public dispose(): void {
		this._socket.disconnect(this._addr);
	}
}
