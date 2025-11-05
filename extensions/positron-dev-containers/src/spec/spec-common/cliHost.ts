/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

import { readLocalFile, writeLocalFile, mkdirpLocal, isLocalFile, renameLocal, readLocalDir, isLocalFolder } from '../spec-utils/pfs';
import { URI } from 'vscode-uri';
import { ExecFunction, getLocalUsername, plainExec, plainPtyExec, PtyExecFunction } from './commonUtils';
import { Abort, Duplex, Sink, Source, SourceCallback } from 'pull-stream';

const toPull = require('stream-to-pull-stream');


export type CLIHostType = 'local' | 'wsl' | 'container' | 'ssh';

export interface CLIHost {
	type: CLIHostType;
	platform: NodeJS.Platform;
	arch: NodeJS.Architecture;
	exec: ExecFunction;
	ptyExec: PtyExecFunction;
	cwd: string;
	env: NodeJS.ProcessEnv;
	path: typeof path.posix | typeof path.win32;
	homedir(): Promise<string>;
	tmpdir(): Promise<string>;
	isFile(filepath: string): Promise<boolean>;
	isFolder(filepath: string): Promise<boolean>;
	readFile(filepath: string): Promise<Buffer>;
	writeFile(filepath: string, content: Buffer): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	mkdirp(dirpath: string): Promise<void>;
	readDir(dirpath: string): Promise<string[]>;
	readDirWithTypes?(dirpath: string): Promise<[string, FileTypeBitmask][]>;
	getUsername(): Promise<string>;
	getuid?: () => Promise<number>;
	getgid?: () => Promise<number>;
	toCommonURI(filePath: string): Promise<URI | undefined>;
	connect: ConnectFunction;
	reconnect?(): Promise<void>;
	terminate?(): Promise<void>;
}

export type ConnectFunction = (socketPath: string) => Duplex<Buffer, Buffer>;

export enum FileTypeBitmask {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export async function getCLIHost(localCwd: string, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>, allowInheritTTY: boolean): Promise<CLIHost> {
	const exec = plainExec(localCwd);
	const ptyExec = await plainPtyExec(localCwd, loadNativeModule, allowInheritTTY);
	return createLocalCLIHostFromExecFunctions(localCwd, exec, ptyExec, connectLocal);
}

function createLocalCLIHostFromExecFunctions(localCwd: string, exec: ExecFunction, ptyExec: PtyExecFunction, connect: ConnectFunction): CLIHost {
	return {
		type: 'local',
		platform: process.platform,
		arch: process.arch,
		exec,
		ptyExec,
		cwd: localCwd,
		env: process.env,
		path: path,
		homedir: async () => os.homedir(),
		tmpdir: async () => os.tmpdir(),
		isFile: isLocalFile,
		isFolder: isLocalFolder,
		readFile: readLocalFile,
		writeFile: writeLocalFile,
		rename: renameLocal,
		mkdirp: async (dirpath) => {
			await mkdirpLocal(dirpath);
		},
		readDir: readLocalDir,
		getUsername: getLocalUsername,
		getuid: process.platform === 'linux' || process.platform === 'darwin' ? async () => process.getuid!() : undefined,
		getgid: process.platform === 'linux' || process.platform === 'darwin' ? async () => process.getgid!() : undefined,
		toCommonURI: async (filePath) => URI.file(filePath),
		connect,
	};
}

// Parse a Cygwin socket cookie string to a raw Buffer
function cygwinUnixSocketCookieToBuffer(cookie: string) {
	let bytes: number[] = [];

	cookie.split('-').map((number: string) => {
		const bytesInChar = number.match(/.{2}/g);
		if (bytesInChar !== null) {
			bytesInChar.reverse().map((byte) => {
				bytes.push(parseInt(byte, 16));
			});
		}
	});
	return Buffer.from(bytes);
}

// The cygwin/git bash ssh-agent server will reply us with the cookie back (16 bytes)
// + identifiers (12 bytes), skip them while forwarding data from ssh-agent to the client
function skipHeader(headerSize: number, err: Abort, data?: Buffer) {
	if (err || data === undefined) {
		return { headerSize, err };
	}

	if (headerSize === 0) {
		// Fast path avoiding data buffer manipulation
		// We don't need to modify the received data (handshake header
		// already removed)
		return { headerSize, data };
	} else if (data.length > headerSize) {
		// We need to remove part of the data to forward
		data = data.slice(headerSize, data.length);
		headerSize = 0;
		return { headerSize, data };
	} else {
		// We need to remove all forwarded data
		headerSize = headerSize - data.length;
		return { headerSize };
	}
}

// Function to handle the Cygwin/Gpg4win socket filtering
// These sockets need an handshake before forwarding client and server data
function handleUnixSocketOnWindows(socket: net.Socket, socketPath: string): Duplex<Buffer, Buffer> {
	let headerSize = 0;
	let pendingSourceCallbacks: { abort: Abort; cb: SourceCallback<Buffer> }[] = [];
	let pendingSinkCalls: Source<Buffer>[] = [];
	let connectionDuplex: Duplex<Buffer, Buffer> | undefined = undefined;

	let handleError = (err: Abort) => {
		if (err instanceof Error) {
			console.error(err);
		}
		socket.destroy();

		// Notify pending callbacks with the error
		for (let callback of pendingSourceCallbacks) {
			callback.cb(err, undefined);
		}
		pendingSourceCallbacks = [];

		for (let callback of pendingSinkCalls) {
			callback(err, (_abort, _data) => { });
		}
		pendingSinkCalls = [];
	};

	function doSource(abort: Abort, cb: SourceCallback<Buffer>) {
		(connectionDuplex as Duplex<Buffer, Buffer>).source(abort, function (err, data) {
			const res = skipHeader(headerSize, err, data);
			headerSize = res.headerSize;
			if (res.err || res.data) {
				cb(res.err || null, res.data);
			} else {
				doSource(abort, cb);
			}
		});
	}

	(async () => {
		const buf = await readLocalFile(socketPath);
		const str = buf.toString();

		// Try to parse cygwin socket data
		const cygwinSocketParameters = str.match(/!<socket >(\d+)( s)? ((([A-Fa-f0-9]{2}){4}-?){4})/);

		let port: number;
		let handshake: Buffer;

		if (cygwinSocketParameters !== null) {
			// Cygwin / MSYS / Git Bash unix socket on Windows
			const portStr = cygwinSocketParameters[1];
			const guidStr = cygwinSocketParameters[3];
			port = parseInt(portStr, 10);
			const guid = cygwinUnixSocketCookieToBuffer(guidStr);

			let identifierData = Buffer.alloc(12);
			identifierData.writeUInt32LE(process.pid, 0);

			handshake = Buffer.concat([guid, identifierData]);

			// Recv header size = GUID (16 bytes) + identifiers (3 * 4 bytes)
			headerSize = 16 + 3 * 4;
		} else {
			// Gpg4Win unix socket
			const i = buf.indexOf(0xa);
			port = parseInt(buf.slice(0, i).toString(), 10);
			handshake = buf.slice(i + 1);

			// No header will be received from Gpg4Win agent
			headerSize = 0;
		}

		// Handle connection errors and resets
		socket.on('error', err => {
			handleError(err);
		});

		socket.connect(port, '127.0.0.1', () => {
			// Write handshake data to the ssh-agent/gpg-agent server
			socket.write(handshake, err => {
				if (err) {
					// Error will be handled via the 'error' event
					return;
				}

				connectionDuplex = toPull.duplex(socket);

				// Call pending source calls, if the pull-stream connection was
				// pull-ed before we got connected to the ssh-agent/gpg-agent
				// server.
				// The received data from ssh-agent/gpg-agent server is filtered
				// to skip the handshake header.
				for (let callback of pendingSourceCallbacks) {
					doSource(callback.abort, callback.cb);
				}
				pendingSourceCallbacks = [];

				// Call pending sink calls after the handshake is completed
				// to send what the client sent to us
				for (let callback of pendingSinkCalls) {
					(connectionDuplex as Duplex<Buffer, Buffer>).sink(callback);
				}
				pendingSinkCalls = [];
			});
		});
	})()
		.catch(err => {
			handleError(err);
		});

	// pull-stream source that remove the first <headerSize> bytes
	let source: Source<Buffer> = function (abort: Abort, cb: SourceCallback<Buffer>) {
		if (connectionDuplex !== undefined) {
			doSource(abort, cb);
		} else {
			pendingSourceCallbacks.push({ abort: abort, cb: cb });
		}
	};

	// pull-stream sink. No filtering done, but we need to store calls in case
	// the connection to the upstram ssh-agent/gpg-agent is not yet connected
	let sink: Sink<Buffer> = function (source: Source<Buffer>) {
		if (connectionDuplex !== undefined) {
			connectionDuplex.sink(source);
		} else {
			pendingSinkCalls.push(source);
		}
	};

	return {
		source: source,
		sink: sink
	};
}

// Connect to a ssh-agent or gpg-agent, supporting multiple platforms
function connectLocal(socketPath: string) {
	if (process.platform !== 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) {
		// Simple case: direct forwarding
		return toPull.duplex(net.connect(socketPath));
	}

	// More complex case: we need to do an handshake to support Cygwin / Git Bash
	// sockets or Gpg4Win sockets

	const socket = new net.Socket();

	return handleUnixSocketOnWindows(socket, socketPath);
}
