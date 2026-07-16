/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KallichoreTransport } from './KallichoreApiInstance.js';

/**
 * The persisted state of the Kallichore server. This metadata is saved in
 * workspace state storage and used to re-establish a connection to the server
 * when the extension (or Positron) is reloaded.
 */
export interface KallichoreServerState {
	/** The port the server is listening on, e.g. 8182 (for TCP) */
	port?: number;

	/** The full base path of the API, e.g. http://127.0.0.1:8182/ or http://unix:/path/to/socket: */
	base_path?: string;

	/** The path to the server binary, e.g. /usr/lib/bin/kcserver. */
	server_path: string;

	/** The PID of the server process */
	server_pid: number;

	/** The bearer token used to authenticate with the server */
	bearer_token: string;

	/**
	 * A unique identifier reported by the server in its status, generated each
	 * time the server starts. Used to detect when a previously persisted
	 * connection now points at a different server instance (and therefore that
	 * the saved bearer token is stale). May be undefined for state saved before
	 * this field existed, or when connecting to an older server that does not
	 * report it.
	 */
	server_id?: string;

	/** The path to the log file */
	log_path: string;

	/** The transport protocol used */
	transport?: KallichoreTransport;

	/** The path to the unix domain socket (when using socket transport) */
	socket_path?: string;

	/** The name of the named pipe (when using named pipe transport) */
	named_pipe?: string;
}
