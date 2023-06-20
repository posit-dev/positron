/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as zmq from 'zeromq/v5-compat';
import * as vscode from 'vscode';
import { PromiseHandles } from './utils';

enum JupyterSocketState {
	Uninitialized,
	Connecting,
	Connected,
	Disconnected,
	Disposed
}

export class JupyterSocket implements vscode.Disposable {
	private readonly _socket: zmq.Socket;
	private readonly _title: string;
	private _connectPromise?: PromiseHandles<void>;
	private _connectStartTime = 0;
	private _addr: string;
	private _port: number;
	private _id: number;
	private _disconnectEmitter = new vscode.EventEmitter<void>();
	private _state: JupyterSocketState = JupyterSocketState.Uninitialized;

	static _jupyterSocketCount = 0;

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
		this.onDisconnected = this._disconnectEmitter.event;

		this._addr = '';
		this._port = 0;
		this._id = ++JupyterSocket._jupyterSocketCount;
		this._logger(`${this._title} socket created (id = ${this._id})`);

		// Warn if we are nearing ZeroMQ's maximum number of sockets. This is 1024 in
		// typical installations, but can be changed by setting ZMQ_MAX_SOCKETS.
		if (JupyterSocket._jupyterSocketCount >= (zmq.Context.getMaxSockets() - 1)) {
			this._logger(`*** WARNING *** Nearing maximum number of ZeroMQ sockets ` +
				`(${zmq.Context.getMaxSockets()})`);
		}

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

		// Bind event handlers for the socket
		this.onConnectedEvent = this.onConnectedEvent.bind(this);
		this._socket.on('connect', this.onConnectedEvent);

		this.onDisconnectedEvent = this.onDisconnectedEvent.bind(this);
		this._socket.on('disconnect', this.onDisconnectedEvent);

		this.onConnectDelay = this.onConnectDelay.bind(this);
		this._socket.on('connect_delay', this.onConnectDelay);
	}

	onDisconnected: vscode.Event<void>;

	/**
	 * Handles the `disconnect` event from the ZeroMQ socket
	 *
	 * @param _evt ZeroMQ event (ignored)
	 * @param addr The address the socket connected to
	 */
	private onDisconnectedEvent(_evt: any, addr: string) {
		this._logger(`${this._title} socket disconnected from ${addr}`);

		// We still need to disconnect from our end of the socket
		this._socket.disconnect(this._addr);
		this._state = JupyterSocketState.Disconnected;

		// Fire the disconnect event
		this._disconnectEmitter.fire();
	}

	/**
	 * Handles the `connect` event from the ZeroMQ socket
	 *
	 * @param _evt ZeroMQ event (ignored)
	 * @param addr The address the socket connected to
	 */
	private onConnectedEvent(_evt: any, addr: string) {
		// Ignore if there's no connect promise
		if (!this._connectPromise) {
			return;
		}
		// Log the connection
		this._logger(`${this._title} socket connected to ${addr}`);

		this._state = JupyterSocketState.Connected;

		// Resolve the promise
		this._connectPromise.resolve();
		this._connectPromise = undefined;
	}

	/**
	 * Handles the `connect_delay` event from the ZeroMQ socket
	 *
	 * @param _evt ZeroMQ event (ignored)
	 * @param addr The address the socket is attempting to connect to
	 */
	private onConnectDelay(_evt: any, addr: string) {
		// Ignore if there's no connect promise
		if (!this._connectPromise) {
			return;
		}

		// We give up if we've exceeded our max wait time
		const elapsed = Math.round((Date.now() - this._connectStartTime) / 1000);
		if (this._connectPromise.settled) {
			// If the promise is settled, we already connected
			// successfully, so we can stop monitoring the socket and
			// ignore this event.
			this._socket.unmonitor();
		} else if (elapsed > 30) {
			// Stop monitoring the socket so we don't get any more
			// events, which would be redundant at this point
			this._socket.unmonitor();
			this._logger(`${this._title} socket failed to connect to ${addr} after ${elapsed} seconds`);

			// Reject the promise
			this._connectPromise.reject(new Error(`Failed to connect to ${addr} after ${elapsed} seconds`));
			this._connectPromise = undefined;
		}
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
		this._port = port;
		this._addr = 'tcp://127.0.0.1:' + port.toString();
		this._logger(`${this._title} socket connecting to ${this._addr}...`);

		// Create a new promise to wait for the socket to connect
		this._connectStartTime = Date.now();
		this._connectPromise = new PromiseHandles<void>();

		// Initiate the actual connection to the TCP address
		this._socket.connect(this._addr);

		// Return the promise; we will resolve it when the socket connects
		return this._connectPromise.promise;
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
		// Ensure we're not disposed already
		if (this._state === JupyterSocketState.Disposed) {
			this._logger(`Attempt to dispose already disposed socket '${this._title}'`);
			return;
		}

		// Reduce the socket count
		JupyterSocket._jupyterSocketCount--;

		// If we were waiting for a connection, reject the promise
		if (this._connectPromise) {
			this._connectPromise.reject(new Error('Socket disposed'));
			this._connectPromise = undefined;
		}

		// Disconnect the socket if it's connected
		if (this._state === JupyterSocketState.Connected) {
			this._logger(`${this._title} socket disposed while connected; ` +
				` disconnecting from ${this._addr}...`);
			this._socket.disconnect(this._addr);
			this._state = JupyterSocketState.Disconnected;
			this._disconnectEmitter.fire();
		}

		// Stop monitoring the socket
		this._socket.unmonitor();

		// Clean up event handlers
		this._socket.off('connect', this.onConnectedEvent);
		this._socket.off('disconnect', this.onDisconnectedEvent);
		this._socket.off('connect_delay', this.onConnectDelay);

		this._state = JupyterSocketState.Disposed;
	}
}
