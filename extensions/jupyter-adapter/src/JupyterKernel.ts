/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as zmq from 'zeromq';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { JupyterSocket } from './JupyterSocket';
import { serializeJupyterMessage } from './JupyterMessageSerializer';
import { deserializeJupyterMessage } from './JupyterMessageDeserializer';
import { EventEmitter } from 'events';
import { JupyterMessageHeader } from './JupyterMessageHeader';
import { JupyterMessage } from './JupyterMessage';
import { JupyterMessageSpec } from './JupyterMessageSpec';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterCommOpen } from './JupyterCommOpen';
import { v4 as uuidv4 } from 'uuid';
import { JupyterShutdownRequest } from './JupyterShutdownRequest';
import { JupyterInterruptRequest } from './JupyterInterruptRequest';
import { JupyterKernelSpec } from './JupyterKernelSpec';
import { JupyterConnectionSpec } from './JupyterConnectionSpec';
import { JupyterSockets } from './JupyterSockets';

export class JupyterKernel extends EventEmitter implements vscode.Disposable {
	private readonly _spec: JupyterKernelSpec;
	private _process: ChildProcess | null;

	/** The kernel connection file (path to JSON file) */
	private _file: string | null;

	/** The kernel's current state */
	private _status: string;

	/** The security key to use to sign messages to the kernel */
	private readonly _key: string;

	/** The session identifier */
	private readonly _sessionId: string;

	// ZeroMQ sockets ---
	private _control: JupyterSocket | null;
	private _shell: JupyterSocket | null;
	private _stdin: JupyterSocket | null;
	private _iopub: JupyterSocket | null;
	private _heartbeat: JupyterSocket | null;

	private _heartbeatTimer: NodeJS.Timeout | null;
	private _lastHeartbeat: number;

	constructor(spec: JupyterKernelSpec) {
		super();
		this._spec = spec;
		this._process = null;
		this._file = null;

		this._control = null;
		this._shell = null;
		this._stdin = null;
		this._iopub = null;
		this._heartbeat = null;
		this._heartbeatTimer = null;
		this._lastHeartbeat = 0;

		this._status = 'Uninitialized';
		this._key = crypto.randomBytes(16).toString('hex');
		this._sessionId = crypto.randomBytes(16).toString('hex');
	}

	public async start() {

		// Create ZeroMQ sockets
		this._control = new JupyterSocket('Control', zmq.socket('dealer'));
		this._shell = new JupyterSocket('Shell', zmq.socket('dealer'));
		this._stdin = new JupyterSocket('Stdin', zmq.socket('dealer'));
		this._iopub = new JupyterSocket('I/O', zmq.socket('sub'));
		this._heartbeat = new JupyterSocket('Heartbeat', zmq.socket('req'));

		// Create a random ZeroMQ identity for the shell and stdin sockets
		const shellId = crypto.randomBytes(16);
		this._shell.setZmqIdentity(shellId);
		this._stdin.setZmqIdentity(shellId);

		// Array of bound ports
		const ports: Array<number> = [];

		// Find an available port to bind for each socket
		ports.push(await this._control.bind(ports));
		ports.push(await this._shell.bind(ports));
		ports.push(await this._stdin.bind(ports));
		ports.push(await this._iopub.bind(ports));
		ports.push(await this._heartbeat.bind(ports));

		// Create connection definition
		const conn: JupyterConnectionSpec = {
			control_port: this._control.port(),  // eslint-disable-line
			shell_port: this._shell.port(),      // eslint-disable-line
			stdin_port: this._stdin.port(),      // eslint-disable-line
			iopub_port: this._iopub.port(),      // eslint-disable-line
			hb_port: this._heartbeat.port(),     // eslint-disable-line
			signature_scheme: 'hmac-sha256',     // eslint-disable-line
			ip: '127.0.0.1',
			transport: 'tcp',
			key: this._key
		};

		// Write connection definition to a file
		const tempdir = os.tmpdir();
		const sep = path.sep;
		this._file = path.join(fs.mkdtempSync(`${tempdir}${sep}kernel-`), 'connection.json');
		fs.writeFileSync(this._file, JSON.stringify(conn));

		// Replace the {connection_file} argument with our connection file
		const args = this._spec.argv.map((arg, idx) => {
			if (arg === '{connection_file}') {
				return this._file;
			}
			return arg;
		}) as Array<string>;

		const command = args.join(' ');

		// If environment variables were provided in the kernel spec, apply them
		let options = {};
		if (this._spec.env) {
			options = {
				'env': this._spec.env
			};
		}

		this.setStatus(KernelStatus.starting);

		const output = vscode.window.createOutputChannel(this._spec.display_name);
		output.appendLine('Starting ' + this._spec.display_name + ' kernel: ' + command + '...');
		this._process = spawn(args[0], args.slice(1), options);
		this._process.stdout?.on('data', (data) => {
			output.append(data.toString());
		});
		this._process.stderr?.on('data', (data) => {
			output.append(data.toString());
		});
		this._process.on('close', (code) => {
			this.setStatus(KernelStatus.exited);
			output.appendLine(this._spec.display_name + ' kernel exited with status ' + code);
		});
		this._process.once('spawn', () => {
			console.log(`${this._spec.display_name} kernel started`);
			this._heartbeat?.socket().once('message', (msg: string) => {

				console.log('Receieved initial heartbeat: ' + msg);
				this.setStatus(KernelStatus.ready);

				const seconds = vscode.workspace.getConfiguration('myriac').get('heartbeat') as number;
				if (seconds > 0) {
					console.info(`Starting heartbeat check at ${seconds} second intervals...`);
					this.heartbeat();
					this._heartbeat?.socket().on('message', (msg: string) => {
						this.onHeartbeat(msg);
					});
				} else {
					console.info(`Heartbeat check disabled via configuration.`);
				}
			});
			this._heartbeat?.socket().send(['hello']);
		});

		// Subscribe to all topics
		this._iopub.socket().subscribe('');
		this._iopub.socket().on('message', (...args: any[]) => {
			const msg = deserializeJupyterMessage(args, this._key);
			if (msg !== null) {
				console.log('iopub message: ' + JSON.stringify(msg));
				this.emitMessage(JupyterSockets.iopub, msg);
			}
		});
		this._shell.socket().on('message', (...args: any[]) => {
			const msg = deserializeJupyterMessage(args, this._key);
			if (msg !== null) {
				console.log('shell message: ' + JSON.stringify(msg));
				this.emitMessage(JupyterSockets.shell, msg);
			}
		});
		this._stdin.socket().on('message', (...args: any[]) => {
			const msg = deserializeJupyterMessage(args, this._key);
			if (msg !== null) {
				console.log('stdin message: ' + JSON.stringify(msg));
				this.emitMessage(JupyterSockets.stdin, msg);
			}
		});
	}

	/**
	 * Requests that the kernel start a Language Server Protocol server, and
	 * connect it to the client with the given TCP address.
	 *
	 * @param clientAddress The client's TCP address, e.g. '127.0.0.1:1234'
	 */
	public startLsp(clientAddress: string) {
		// TODO: Should we query the kernel to see if it can create an LSP
		// (QueryInterface style) instead of just demanding it?

		// Create the message to send to the kernel
		const msg: JupyterCommOpen = {
			target_name: 'Language Server Protocol',  // eslint-disable-line
			comm_id: 'C8C5265A-028C-4A3E-BA3F-D50A28E2B8E4',  // eslint-disable-line
			data: {
				client_address: clientAddress,  // eslint-disable-line
			}
		};
		this.send(uuidv4(), 'comm_open', this._shell!, msg);
	}

	/**
	 * Get the kernel's display name
	 *
	 * @returns The kernel's display name
	 */
	public displayName(): string {
		return this._spec.display_name;
	}

	/**
	 * Gets the kernel's metadata (specification)
	 *
	 * @returns The kernel's metadata
	 */
	public spec(): JupyterKernelSpec {
		return this._spec;
	}

	/**
	 * Get the kernel's current status
	 *
	 * @returns The kernel's current status
	 */
	public status(): string {
		return this._status;
	}

	/**
	 * Restarts the kernel
	 */
	public async restart() {
		// Request that the kernel shut down
		this.shutdown(true);

		// Start the kernel again once the process finishes shutting down
		console.info(`Waiting for '${this._spec.display_name}' to shut down...`);
		this._process?.on('exit', () => {
			console.info(`Waiting for '${this._spec.display_name}' to restart...`);
			this.start();
		});
	}

	/**
	 * Tells the kernel to shut down
	 */
	public shutdown(restart: boolean) {
		this.setStatus(KernelStatus.exiting);
		console.info('Requesting shutdown of kernel: ' + this._spec.display_name);
		const msg: JupyterShutdownRequest = {
			restart: restart
		};
		this.send(uuidv4(), 'shutdown_request', this._control!, msg);
	}

	/**
	 * Interrupts the kernel
	 */
	public interrupt() {
		this.setStatus(KernelStatus.interrupting);
		console.info('Requesting interrupt of kernel: ' + this._spec.display_name);
		const msg: JupyterInterruptRequest = {};
		this.send(uuidv4(), 'interrupt_request', this._control!, msg);
	}

	/**
	 * Emits a message packet to the webview
	 *
	 * @param socket The socket on which the message was emitted
	 * @param msg The message itself
	 */
	private emitMessage(socket: JupyterSockets, msg: JupyterMessage) {
		const packet: JupyterMessagePacket = {
			type: 'jupyter-message',
			message: msg.content,
			msgId: msg.header.msg_id,
			msgType: msg.header.msg_type,
			originId: msg.parent_header ? msg.parent_header.msg_id : '',
			socket: socket
		};
		this.emit('message', packet);
	}

	/**
	 * Send a message to the kernel
	 *
	 * @param packet The message package
	 */
	public sendMessage(packet: JupyterMessagePacket) {
		let socket: JupyterSocket | null = null;

		switch (packet.socket) {
			case JupyterSockets.control:
				socket = this._control;
				break;
			case JupyterSockets.heartbeat:
				socket = this._heartbeat;
				break;
			case JupyterSockets.iopub:
				socket = this._iopub;
				break;
			case JupyterSockets.shell:
				socket = this._shell;
				break;
			case JupyterSockets.stdin:
				socket = this._stdin;
				break;
		}

		if (socket === null) {
			console.warn(`No socket ${packet.socket} found.`);
			return;
		}

		this.send(packet.msgId, packet.msgType, socket, packet.message);
	}

	public dispose() {
		// Clean up connection file
		if (this._file) {
			fs.rmSync(this._file);
		}

		// Close sockets
		this._control?.dispose();
		this._shell?.dispose();
		this._stdin?.dispose();
		this._heartbeat?.dispose();
		this._iopub?.dispose();

		console.log('Shutting down ' + this._spec.display_name + ' kernel');
		this.shutdown(false);
	}

	private generateMessageHeader(id: string, type: string): JupyterMessageHeader {
		return {
			msg_id: id,            // eslint-disable-line
			msg_type: type,        // eslint-disable-line
			version: '5.0',
			date: (new Date()).toISOString(),
			session: this._sessionId,
			username: os.userInfo().username
		};
	}

	/**
	 * Sends a message to the kernel.
	 *
	 * @param id The unique ID of the message
	 * @param type The type of the message
	 * @param dest The socket to which the message should be sent
	 * @param message The body of the message
	 */
	private send(id: string, type: string, dest: JupyterSocket, message: JupyterMessageSpec) {
		const msg: JupyterMessage = {
			buffers: [],
			content: message,
			header: this.generateMessageHeader(id, type),
			metadata: new Map(),
			parent_header: {} as JupyterMessageHeader // eslint-disable-line
		};
		console.log('sending request: ' + JSON.stringify(msg));
		dest.socket().send(serializeJupyterMessage(msg, this._key));
	}

	/**
	 * Emits a heartbeat message and waits for the kernel to respond.
	 */
	private heartbeat() {
		const seconds = vscode.workspace.getConfiguration('myriac').get('heartbeat') as number;
		console.info('Sent heartbeat message to kernel');
		this._lastHeartbeat = new Date().getUTCMilliseconds();
		this._heartbeat?.socket().send(['hello']);
		this._heartbeatTimer = setTimeout(() => {
			// If the kernel hasn't responded in the given amount of time,
			// mark it as offline
			this.setStatus(KernelStatus.offline);
		}, seconds * 1000);
	}

	/**
	 * Processes a heartbeat message from the kernel.
	 *
	 * @param msg The heartbeat received from the kernel
	 */
	private onHeartbeat(msg: string) {
		// Clear the timer that's tracking the heartbeat
		if (this._heartbeatTimer) {
			clearTimeout(this._heartbeatTimer);
		}

		// If we know how long the kernel took, log it
		if (this._lastHeartbeat) {
			const now = new Date().getUTCMilliseconds();
			const diff = now - this._lastHeartbeat;
			console.info(`Heartbeat received from kernel in ${diff}ms`);
		}

		// Schedule the next heartbeat at the configured interval
		const seconds = vscode.workspace.getConfiguration('myriac').get('heartbeat') as number;
		setTimeout(() => {
			this.heartbeat();
		}, seconds * 1000);
	}

	/**
	 * Changes the kernel's status
	 *
	 * @param status The new status of the kernel
	 */
	private setStatus(status: KernelStatus) {
		this.emit('status', status);
		this._status = status;
	}
}

/**
 * The set of possible statuses for a kernel
 */
export enum KernelStatus {
	/** The kernel is in the process of starting up. It isn't ready for messages. */
	starting = 'starting',

	/** The kernel has a heartbeat and is ready for messages. */
	ready = 'ready',

	/** The kernel is ready to execute code. */
	idle = 'idle',

	/** The kernel is busy executing code. */
	busy = 'busy',

	/** The kernel is in the process of shutting down. */
	exiting = 'exiting',

	/** The kernel's host process has ended. */
	exited = 'exited',

	/** The kernel is not responding to heartbeats and is presumed offline. */
	offline = 'offline',

	/** The user has interrupted a busy kernel, but the kernel is not idle yet. */
	interrupting = 'interrupting',
}
