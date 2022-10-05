/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as zmq from 'zeromq';
import { findAvailablePort } from './PortFinder';
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
		private readonly _channel: vscode.OutputChannel) {
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
		this._socket.setsockopt(zmq.ZMQ_IDENTITY, identity);
	}

	/**
	 * Find an address/port to bind to.
	 *
	 * @param excluding A list of ports to exclude from the search
	 * @returns The port to bind to
	 */
	public async bind(excluding: Array<number>): Promise<number> {
		const maxTries = 25;
		return new Promise((resolve, reject) => {
			findAvailablePort(excluding, maxTries).then((port: number) => {
				this._port = port;
				this._addr = 'tcp://127.0.0.1:' + port.toString();
				this._socket.connect(this._addr);
				this._channel.appendLine(`${this._title} socket connected to ${this._addr}`);
				resolve(port);
			})
				.catch((err) => {
					reject(err);
				});
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
