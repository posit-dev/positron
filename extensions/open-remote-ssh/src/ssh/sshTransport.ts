/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SSHCommandResult {
	stdout: string;
	stderr: string;
}

export interface SSHTunnelConfig {
	/** Remote address to connect to. */
	remoteAddr?: string;
	/** Local port to bind to. */
	localPort?: number;
	/** Remote port to connect to. */
	remotePort?: number;
	/** Remote socket path to connect to. */
	remoteSocketPath?: string;
	/** Create a SOCKS proxy instead of a local forwarding tunnel. */
	socks?: boolean;
	/** Unique name used to find and close the tunnel. */
	name?: string;
}

/** Operations shared by the ssh2 and native OpenSSH transports. */
export default interface SSHTransport {
	connect(): Promise<SSHTransport>;
	exec(command: string, params?: string[]): Promise<SSHCommandResult>;
	execPartial(command: string, tester: (stdout: string, stderr: string) => boolean, params?: string[]): Promise<SSHCommandResult>;
	addTunnel(config: SSHTunnelConfig): Promise<SSHTunnelConfig>;
	closeTunnel(name?: string): Promise<void>;
	close(): Promise<void>;
}
