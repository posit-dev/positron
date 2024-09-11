/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import { raceTimeout, retryTimeout } from './async';

// Port utilities; some copied from Positron core.

/**
 * @returns Returns a random port between 1025 and 65535.
 */
export function randomPort(): number {
	const min = 1025;
	const max = 65535;
	return min + Math.floor((max - min) * Math.random());
}

/**
 * Given a start point and a max number of retries, will find a port that
 * is openable. Will return 0 in case no free port can be found.
 */
export function findFreePort(startPort: number, giveUpAfter: number, timeout: number, stride = 1): Promise<number> {
	let done = false;

	return new Promise(resolve => {
		const timeoutHandle = setTimeout(() => {
			if (!done) {
				done = true;
				return resolve(0);
			}
		}, timeout);

		doFindFreePort(startPort, giveUpAfter, stride, (port) => {
			if (!done) {
				done = true;
				clearTimeout(timeoutHandle);
				return resolve(port);
			}
		});
	});
}

function doFindFreePort(startPort: number, giveUpAfter: number, stride: number, clb: (port: number) => void): void {
	if (giveUpAfter === 0) {
		return clb(0);
	}

	const client = new net.Socket();

	// If we can connect to the port it means the port is already taken so we continue searching
	client.once('connect', () => {
		dispose(client);

		return doFindFreePort(startPort + stride, giveUpAfter - 1, stride, clb);
	});

	client.once('data', () => {
		// this listener is required since node.js 8.x
	});

	client.once('error', (err: Error & { code?: string }) => {
		dispose(client);

		// If we receive any non ECONNREFUSED error, it means the port is used but we cannot connect
		if (err.code !== 'ECONNREFUSED') {
			return doFindFreePort(startPort + stride, giveUpAfter - 1, stride, clb);
		}

		// Otherwise it means the port is free to use!
		return clb(startPort);
	});

	client.connect(startPort, '127.0.0.1');
}

// Reference: https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/net/base/port_util.cc#56
export const BROWSER_RESTRICTED_PORTS: any = {
	1: true,      // tcpmux
	7: true,      // echo
	9: true,      // discard
	11: true,     // systat
	13: true,     // daytime
	15: true,     // netstat
	17: true,     // qotd
	19: true,     // chargen
	20: true,     // ftp data
	21: true,     // ftp access
	22: true,     // ssh
	23: true,     // telnet
	25: true,     // smtp
	37: true,     // time
	42: true,     // name
	43: true,     // nicname
	53: true,     // domain
	69: true,     // tftp
	77: true,     // priv-rjs
	79: true,     // finger
	87: true,     // ttylink
	95: true,     // supdup
	101: true,    // hostriame
	102: true,    // iso-tsap
	103: true,    // gppitnp
	104: true,    // acr-nema
	109: true,    // pop2
	110: true,    // pop3
	111: true,    // sunrpc
	113: true,    // auth
	115: true,    // sftp
	117: true,    // uucp-path
	119: true,    // nntp
	123: true,    // NTP
	135: true,    // loc-srv /epmap
	137: true,    // netbios
	139: true,    // netbios
	143: true,    // imap2
	161: true,    // snmp
	179: true,    // BGP
	389: true,    // ldap
	427: true,    // SLP (Also used by Apple Filing Protocol)
	465: true,    // smtp+ssl
	512: true,    // print / exec
	513: true,    // login
	514: true,    // shell
	515: true,    // printer
	526: true,    // tempo
	530: true,    // courier
	531: true,    // chat
	532: true,    // netnews
	540: true,    // uucp
	548: true,    // AFP (Apple Filing Protocol)
	554: true,    // rtsp
	556: true,    // remotefs
	563: true,    // nntp+ssl
	587: true,    // smtp (rfc6409)
	601: true,    // syslog-conn (rfc3195)
	636: true,    // ldap+ssl
	989: true,    // ftps-data
	990: true,    // ftps
	993: true,    // ldap+ssl
	995: true,    // pop3+ssl
	1719: true,   // h323gatestat
	1720: true,   // h323hostcall
	1723: true,   // pptp
	2049: true,   // nfs
	3659: true,   // apple-sasl / PasswordServer
	4045: true,   // lockd
	5060: true,   // sip
	5061: true,   // sips
	6000: true,   // X11
	6566: true,   // sane-port
	6665: true,   // Alternate IRC [Apple addition]
	6666: true,   // Alternate IRC [Apple addition]
	6667: true,   // Standard IRC [Apple addition]
	6668: true,   // Alternate IRC [Apple addition]
	6669: true,   // Alternate IRC [Apple addition]
	6697: true,   // IRC + TLS
	10080: true   // Amanda
};

function dispose(socket: net.Socket): void {
	try {
		socket.removeAllListeners('connect');
		socket.removeAllListeners('error');
		socket.end();
		socket.destroy();
		socket.unref();
	} catch (error) {
		console.error(error); // otherwise this error would get lost in the callback chain
	}
}

/**
 * Wait for a port on localhost to be ready for a connection.
 *
 * @param port The port on localhost.
 * @param timeout Stop retrying after this number of milliseconds.
 * @returns A promise that resolves when the port is ready for a connection,
 *          or rejects if the timeout is reached.
 */
export async function waitForPortConnection(port: number, timeout: number): Promise<void> {
	// Retry connecting to the port until it is ready.
	return retryTimeout(() => {
		// Also apply a timeout to the connection attempt.
		return raceTimeout(
			// Create a promise that resolves when the port is ready for a connection,
			// or rejects if the connection attempt fails.
			new Promise((resolve, reject) => {
				const client = new net.Socket();

				// If we can connect to the port, resolve the promise.
				client.once('connect', () => {
					dispose(client);
					resolve();
				});

				// If we can't connect to the port, reject the promise.
				client.once('error', (err) => {
					dispose(client);
					reject(err);
				});

				client.connect(port, '127.0.0.1');
			}), 5000);
	}, 50, timeout);
}
