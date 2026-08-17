/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Determines the uid that owns a localhost TCP listening socket so the `/proxy/<port>/` route
// can refuse to proxy to ports owned by other users (rstudio-pro#11470, vscode-server#388).
//
// This reproduces the guarantee of the rserver fix (which uses NETLINK_SOCK_DIAG) by reading the
// same kernel data exposed as text in `/proc/net/tcp[6]`. It is dependency-free, needs no special
// privileges, and -- being a plain file read -- is not blocked by the seccomp/capability profiles
// that can restrict netlink. Linux-only; callers fail open on non-Linux / when `/proc` is absent.

import { readFileSync } from 'fs';

/**
 * The subset of this module's exports that `WebClientServer` depends on for its `/proxy/`
 * ownership gate, expressed as an interface so tests can inject stubs in place of the real
 * `/proc`-reading implementations (see webClientServer.vitest.ts).
 */
export interface ISocketOwnershipCheck {
	getListeningPortUid(port: number): number | undefined;
	isProxyPortOwnershipEnforced(uid: number): boolean;
}

const PROC_TCP_FILES = ['/proc/net/tcp', '/proc/net/tcp6'];

/** `st` column value for a socket in the LISTEN state, as rendered in /proc/net/tcp. */
const TCP_LISTEN_STATE = '0A';

/**
 * Parse a `/proc/net/tcp[6]` `local_address`/`rem_address` hex string into its address bytes in
 * network order. The kernel prints each 32-bit word of the address byte-swapped (host order), so
 * this reverses the bytes within each 8-hex-char word while preserving word order -- this works
 * unchanged for both the single-word IPv4 form and the four-word IPv6 form.
 */
function parseProcAddressBytes(hexAddr: string): number[] {
	const bytes: number[] = [];
	for (let wordStart = 0; wordStart < hexAddr.length; wordStart += 8) {
		const word = hexAddr.slice(wordStart, wordStart + 8);
		for (let i = word.length - 2; i >= 0; i -= 2) {
			bytes.push(parseInt(word.slice(i, i + 2), 16));
		}
	}
	return bytes;
}

/**
 * Whether an address's bytes are exactly the IPv4 loopback address `127.0.0.1` -- the specific
 * address Linux's `ip_route_connect()` rewrites an unspecified (`0.0.0.0`) destination to (see
 * `getListeningPortUid`), as opposed to any other address in `127.0.0.0/8`.
 */
function isExactLoopbackMatch(bytes: number[]): boolean {
	return bytes.length === 4 && bytes[0] === 127 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1;
}

/**
 * Whether an address's bytes are the IPv4 wildcard (`0.0.0.0`) or IPv6 wildcard (`::`, which under
 * Linux's default dual-stack behaviour also accepts an IPv4-mapped connection).
 */
function isWildcardMatch(bytes: number[]): boolean {
	return (bytes.length === 4 || bytes.length === 16) && bytes.every(b => b === 0);
}

/** A LISTEN socket found in `/proc/net/tcp[6]` for a given port, before address-reachability filtering. */
interface ListenerEntry {
	addressHex: string;
	uid: number;
}

/**
 * Scan `/proc/net/tcp` and `/proc/net/tcp6` for all LISTEN sockets bound to `port`, in file order.
 */
function collectListeners(port: number): ListenerEntry[] {
	const entries: ListenerEntry[] = [];
	for (const file of PROC_TCP_FILES) {
		let contents: string;
		try {
			contents = readFileSync(file, 'utf8');
		} catch {
			continue; // file absent (e.g. no IPv6) or unreadable -- try the next
		}

		const lines = contents.split('\n');
		// Skip the header line (index 0); each subsequent line is one socket.
		for (let i = 1; i < lines.length; i++) {
			const fields = lines[i].trim().split(/\s+/);
			// Columns: 0=sl 1=local_address 2=rem_address 3=st ... 7=uid
			if (fields.length < 8) {
				continue;
			}
			if (fields[3] !== TCP_LISTEN_STATE) {
				continue;
			}
			const [addressHex, portHex] = fields[1].split(':');
			if (parseInt(portHex, 16) !== port) {
				continue;
			}
			const uid = parseInt(fields[7], 10);
			if (!Number.isNaN(uid)) {
				entries.push({ addressHex, uid });
			}
		}
	}
	return entries;
}

/**
 * Pick the uid of the LISTEN entry that would actually service a `/proxy/<port>/` request.
 * `WebClientServer` always dials `http://0.0.0.0:<port>`, which Linux's `ip_route_connect()`
 * rewrites to exactly `127.0.0.1` -- so a listener bound to that specific address, if one exists,
 * is who receives the connection. Mirroring the kernel's own listener lookup in
 * `__inet_lookup_listener()` (which hashes on the destination address first and only falls back to
 * the wildcard/`INADDR_ANY` bucket if that exact lookup misses), an exact `127.0.0.1` match takes
 * priority over a wildcard (`0.0.0.0`/`::`) match on the same port -- if both exist, simply
 * returning whichever entry appears first could attribute the port to the wrong uid, independent
 * of which process actually started listening first. A listener bound only to some other specific
 * address -- including other loopback addresses like `127.0.0.2`, or the IPv6-only loopback `::1`
 * -- is never reachable this way, even though it may share the same port, so it must not be treated
 * as the owner of that port for this check.
 *
 * Exported (rather than folded into `getListeningPortUid`) so the priority policy can be unit
 * tested against fabricated entries, independent of real `/proc` state or process uids.
 */
export function selectOwnerUid(entries: ListenerEntry[]): number | undefined {
	const parsed = entries.map(e => ({ bytes: parseProcAddressBytes(e.addressHex), uid: e.uid }));
	return parsed.find(e => isExactLoopbackMatch(e.bytes))?.uid
		?? parsed.find(e => isWildcardMatch(e.bytes))?.uid;
}

/**
 * Look up the uid owning the TCP socket that would actually service a `/proxy/<port>/` request, by
 * scanning `/proc/net/tcp` and `/proc/net/tcp6` (see `selectOwnerUid` for the priority policy).
 *
 * @returns the owner uid, or `undefined` if no reachable LISTEN socket for the port was found or
 *          /proc could not be read.
 */
export function getListeningPortUid(port: number): number | undefined {
	return selectOwnerUid(collectListeners(port));
}

let procTcpAvailable: boolean | undefined;

/**
 * One-time (cached) capability probe: whether this process can read `/proc/net/tcp` and parse a
 * numeric uid column from it. Mirrors the rserver fix's `probeSockDiagAvailable()` -- when this is
 * false the runtime cannot support the ownership check at all and callers degrade to no enforcement
 * rather than break proxying.
 */
export function isProcTcpAvailable(): boolean {
	if (procTcpAvailable === undefined) {
		procTcpAvailable = probeProcTcp();
	}
	return procTcpAvailable;
}

function probeProcTcp(): boolean {
	let contents: string;
	try {
		contents = readFileSync('/proc/net/tcp', 'utf8');
	} catch {
		return false;
	}
	// Require at least the header plus one parseable data row with a numeric uid column, so a
	// stubbed/empty procfs (e.g. in a restricted sandbox) is treated as unavailable.
	const lines = contents.split('\n');
	for (let i = 1; i < lines.length; i++) {
		const fields = lines[i].trim().split(/\s+/);
		if (fields.length >= 8 && !Number.isNaN(parseInt(fields[7], 10))) {
			return true;
		}
	}
	return false;
}

/**
 * Whether `/proxy/` port-ownership enforcement can and should run for a session with the given uid.
 * Enforcement is skipped for root-owned sessions (uid 0 -- every port trivially "matches", so the
 * check adds nothing; parity with rserver's `launcher-sessions-container-run-as-root` behaviour) and
 * when the /proc capability is absent.
 */
export function isProxyPortOwnershipEnforced(uid: number): boolean {
	return uid !== 0 && isProcTcpAvailable();
}
