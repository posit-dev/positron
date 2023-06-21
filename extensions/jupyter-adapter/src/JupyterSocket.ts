/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as zmq from 'zeromq/v5-compat';
import * as vscode from 'vscode';
import { PromiseHandles } from './utils';

/**
 * The possible states for a JupyterSocket
 */
enum JupyterSocketState {
	/** The socket has never been connected */
	Uninitialized = 'uninitialized',

	/** The socket is in the process of trying to connect to an address */
	Connecting = 'connecting',

	/** The socket is currently connected to an address */
	Connected = 'connected',

	/** The socket is disconnected */
	Disconnected = 'disconnected',

	/** The socket has been disposed */
	Disposed = 'disposed'
}

/**
 * A wrapper for a ZeroMQ socket that encapsulates the socket and its state.
 */
export class JupyterSocket implements vscode.Disposable {
	private readonly _socket: zmq.Socket;
	private readonly _title: string;
	private _connectPromise?: PromiseHandles<void>;
	private _connectTimeout?: NodeJS.Timeout;
	private _addr: string;
	private _port: number;
	private _disconnectEmitter = new vscode.EventEmitter<void>();
	private _messageEmitter = new vscode.EventEmitter<any[]>();
	private _state: JupyterSocketState = JupyterSocketState.Uninitialized;

	static _jupyterSocketCount = 0;

	/**
	 * Create a new JupyterSocket
	 *
	 * @param title The title of the socket
	 * @param socketType The type of socket to create; limited to client socket types
	 * @param _logger A function that logs a message
	 */
	constructor(title: string, socketType: 'sub' | 'dealer' | 'req',
		private readonly _logger: (msg: string) => void) {
		this._socket = zmq.createSocket(socketType);
		this._title = title;
		this.onDisconnected = this._disconnectEmitter.event;
		this.onMessage = this._messageEmitter.event;

		this._addr = '';
		this._port = 0;
		const count = ++JupyterSocket._jupyterSocketCount;
		this._logger(`${this._title} socket created (count = ${count})`);

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

		this.onMessageEvent = this.onMessageEvent.bind(this);
		this._socket.on('message', this.onMessageEvent);
	}

	/**
	 * Sends a message to the socket.
	 *
	 * @param message The message to send
	 * @returns A promise that resolves when the message has been sent
	 */
	public send(message: any): Promise<void> {

		// Ensure the socket is connected before we try to send the message;
		// ZeroMQ can enter a bad state if we try to send a message to a socket
		// that is not connected.
		if (this._state !== JupyterSocketState.Connected) {
			return Promise.reject(new Error(`Attempt to send message to ${this._title} socket ` +
				`in non-connected state '${this._state}'`));
		}

		// Return a promise that resolves when the message has been sent
		return new Promise<void>((resolve, reject) => {
			this._socket.send(message, 0, (err?: Error) => {
				// If there was an error, reject the promise
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	/**
	 * Event that fires when the socket is disconnected
	 */
	onDisconnected: vscode.Event<void>;

	/**
	 * Event that fires when a message is received on the socket
	 */
	onMessage: vscode.Event<any>;

	/**
	 * Disconnects the socket from the address it is connected to.
	 */
	private disconnect() {
		// Only disconnect if we're connected
		if (this._state !== JupyterSocketState.Connected) {
			this._logger(`Attempt to disconnect ${this._title} socket in ` +
				`state '${this._state}'`);
			return;
		}

		// Perform the disconnection at the ZeroMQ level
		try {
			this._socket.disconnect(this._addr);
		} catch (err) {
			this._logger(`Error disconnecting ${this._title} socket from ${this._addr}: ${err}`);
		}


		// Update the state and fire the disconnect event
		this._state = JupyterSocketState.Disconnected;
		this._disconnectEmitter.fire();
	}

	/**
	 * Indicate whether the socket is connected to an address
	 *
	 * @returns True if the socket is connected, false otherwise
	 */
	public isConnected() {
		return this._state === JupyterSocketState.Connected;
	}

	/**
	 * Handles the `disconnect` event from the ZeroMQ socket
	 *
	 * @param _evt ZeroMQ event (ignored)
	 * @param addr The address the socket connected to
	 */
	private onDisconnectedEvent(_evt: any, addr: string) {
		this._logger(`${this._title} socket disconnected from ${addr}`);

		// We still need to disconnect from our end of the socket
		this.disconnect();
	}

	/**
	 * Handles the `message` event from the ZeroMQ socket
	 *
	 * @param args The message arguments
	 */
	private onMessageEvent(...args: any[]) {
		this._messageEmitter.fire(args);
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

		// Subscribe to all messages if this is a sub socket
		if (this._socket.type === 'sub') {
			this._socket.subscribe('');
		}

		// Resolve the promise
		this._connectPromise.resolve();
		this._connectPromise = undefined;
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
		// Ensure we are not already connected
		if (this._state !== JupyterSocketState.Uninitialized) {
			throw new Error(`Attempt to connect ${this._title} socket in ` +
				` state '${this._state}'`);
		}

		this._port = port;
		this._addr = 'tcp://127.0.0.1:' + port.toString();
		this._logger(`${this._title} socket connecting to ${this._addr}...`);

		this._state = JupyterSocketState.Connecting;

		// Create a new promise to wait for the socket to connect
		this._connectPromise = new PromiseHandles<void>();

		// Start a timer to time out the connection attempt
		const startTime = Date.now();
		this._connectTimeout = setInterval(() => {
			// Nothing to do if we're not waiting for a connection
			if (!this._connectPromise || this._connectPromise.settled) {
				return;
			}
			// Compute how long we've been waiting
			const waitTime = Date.now() - startTime;
			if (waitTime >= 10000) {
				// If we've been waiting for more than 10 seconds, reject the promise
				this._logger(`${this._title} socket connect timed out after 10 seconds`);
				this._connectPromise.reject(new Error('Socket connect timed out after 10 seconds'));
				this._connectPromise = undefined;

				// Return to the uninitialized state so a new connection can be attempted if
				// desired
				this._state = JupyterSocketState.Uninitialized;

				// Stop the timer
				clearInterval(this._connectTimeout);
				this._connectTimeout = undefined;
			} else {
				// Otherwise, log the wait time and keep waiting
				this._logger(`${this._title} socket still connecting ` +
					`(${Math.floor(waitTime / 1000)}s)`);
			}
		}, 2000);

		// Initiate the actual connection to the TCP address
		this._socket.connect(this._addr);

		// Return the promise; we will resolve it when the socket connects
		return this._connectPromise.promise;
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

		// Clear any connection timeout interval
		if (this._connectTimeout) {
			clearInterval(this._connectTimeout);
		}

		// If we were waiting for a connection, reject the promise
		if (this._connectPromise) {
			this._connectPromise.reject(new Error('Socket disposed'));
			this._connectPromise = undefined;
		}

		// Disconnect the socket if it's connected
		if (this._state === JupyterSocketState.Connected) {
			// This generally should not happen, so log a warning
			this._logger(`WARN: ${this._title} socket disposed while connected; ` +
				` disconnecting from ${this._addr}...`);
			this.disconnect();
		}

		// Dispose of the event emitters
		this._disconnectEmitter.dispose();
		this._messageEmitter.dispose();

		// Clean up event handlers
		this._socket.off('connect', this.onConnectedEvent);
		this._socket.off('message', this.onMessageEvent);
		this._socket.off('disconnect', this.onDisconnectedEvent);

		// Close the socket if it's not already closed
		if (!this._socket.closed) {
			this._socket.close();
		}

		this._state = JupyterSocketState.Disposed;
	}
}
