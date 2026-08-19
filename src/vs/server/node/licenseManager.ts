/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { DeferredPromise, TimeoutTimer, timeout } from '../../base/common/async.js';
import { Disposable, toDisposable } from '../../base/common/lifecycle.js';
import { StreamSplitter } from '../../base/node/nodeStreams.js';

/**
 * Supervises the `license-manager-aws-sagemaker` client.
 *
 */

/**
 * The hex-encoded key the client's digests are keyed with.
 */
const MessageKey = '';

/** Status value that indicates an active lease. */
const STATUS_ACTIVATED = 'activated';

/** How far a message's own timestamp may sit from ours. */
const MAX_MESSAGE_AGE_MS = 2 * 60_000;

/** How long a lost lease is tolerated before the server is unlicensed. */
const DEFAULT_GRACE_MS = 10 * 60_000;

/** How long to wait for the first activated message at startup. */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/** How long to wait before respawning a client that exited. */
const DEFAULT_RESTART_DELAY_MS = 10_000;

/** How long to wait for the client to check the seat back in on shutdown. */
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

/** A message decoded from the client's stdout. */
export interface ILicenseManagerMessage {
	/** Lease status; 'activated' or 'expired'. */
	status: string;
	/** Lease expiration as unix milliseconds. */
	expirationMs?: number;
	/** Days remaining on the entitlement. */
	daysLeft?: number;
	/** Named user count. Arrives string-encoded via Go's `,string` tag. */
	users?: number;
}

/**
 * The parts of a spawned client that {@link LicenseManager} uses.
 *
 * Narrower than ChildProcess so a test can supply a fake without standing up
 * the whole process surface. A real ChildProcess satisfies it.
 */
export interface ILicenseManagerProcess {
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	once(event: 'error', listener: (err: Error) => void): unknown;
	once(event: 'exit', listener: () => void): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

/** Spawns the client. Split out so tests can substitute a fake. */
function spawnLicenseManager(binaryPath: string, args: string[], env: NodeJS.ProcessEnv): ILicenseManagerProcess {
	return spawn(binaryPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Options for {@link LicenseManager}. */
export interface ILicenseManagerOptions {
	/** Path to the license manager client binary. */
	binaryPath: string;
	/** Called when the lease is lost for longer than the grace period. */
	onUnlicensed: () => void;
	/** Arguments for the client; defaults to the lease acquisition subcommand. */
	args?: string[];
	/** Environment for the client; defaults to this process's environment. */
	env?: NodeJS.ProcessEnv;
	/** Key the client's messages are checked against; defaults to the built-in one. */
	key?: string;
	/** How long a lost lease is tolerated. */
	graceMs?: number;
	/** How long to wait for the first activated message. */
	startupTimeoutMs?: number;
	/** Delay before respawning a client that exited. */
	restartDelayMs?: number;
	/** How long {@link LicenseManager.stop} waits for the client to exit. */
	stopTimeoutMs?: number;
	/** Spawns the client; defaults to the real one. Tests pass a fake. */
	spawn?: (binaryPath: string, args: string[], env: NodeJS.ProcessEnv) => ILicenseManagerProcess;
}

/**
 * Decodes one frame of the client's stdout.
 *
 * @param digest The frame's first line.
 * @param line The frame's second line.
 * @param key Overrides the built-in key. Used by tests.
 * @returns The message, or undefined for anything that is not a JSON object we
 * can account for. Base64 never starts with '{', so the two lines of a frame
 * can be told apart without tracking position in the stream.
 */
export function parseLicenseManagerFrame(digest: string, line: string, key: string = MessageKey): ILicenseManagerMessage | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{')) {
		return undefined;
	}

	if (!matchesDigest(digest, trimmed, key)) {
		return undefined;
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		// A truncated or malformed line must not kill the stream; the next
		// refresh cycle reports status again.
		return undefined;
	}

	// The client stamps every message as it writes it, so one that is not from
	// about now is not from this run of the client. An unstamped one
	// cannot be placed in time at all, so it would stay replayable
	// forever.
	const ts = optionalNumber(parsed['ts']);
	if (ts === undefined || Math.abs(Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
		return undefined;
	}

	// `users` is string-encoded by Go's `,string` struct tag while `days-left`
	// and `expiration` are plain numbers, so both forms are accepted.
	return {
		status: String(parsed['status'] ?? ''),
		expirationMs: optionalNumber(parsed['expiration']),
		daysLeft: optionalNumber(parsed['days-left']),
		users: optionalNumber(parsed['users']),
	};
}

/**
 * Verifies that a given digest matches the HMAC-SHA256 of a line under a key.
 *
 * @param digest The base64-encoded digest to verify.
 * @param line The line whose HMAC is being verified.
 * @param key The hex-encoded key used for the HMAC.
 * @returns `true` if the digest matches, `false` otherwise.
 *
 * A key that is missing or not hex fails here, as does every frame that follows.
 */
function matchesDigest(digest: string, line: string, key: string): boolean {
	if (!/^(?:[0-9a-fA-F]{2})+$/.test(key)) {
		return false;
	}

	// Buffer.from drops characters it cannot decode rather than throwing, so a
	// malformed digest lands here as a short buffer and fails the comparison.
	const claimed = Buffer.from(digest.trim(), 'base64');
	const computed = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(line).digest();
	return claimed.length === computed.length && crypto.timingSafeEqual(claimed, computed);
}

/** Coerces a field that may arrive as a JSON number or a string-encoded number. */
function optionalNumber(value: unknown): number | undefined {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

/**
 * Runs the license manager client and tracks whether the server is licensed.
 *
 * Message cadence is not used as a liveness signal: the client only speaks after
 * each lease refresh, and leases run up to 90 minutes, so a healthy client can
 * be silent for over an hour. The license is held until something positively
 * says otherwise -- an `expired` message, or the client exiting.
 */
export class LicenseManager extends Disposable {
	private child: ILicenseManagerProcess | undefined;
	private childExited: DeferredPromise<void> | undefined;
	private licensed = false;
	private stopped = false;
	private readonly graceTimer = this._register(new TimeoutTimer());
	private readonly restartTimer = this._register(new TimeoutTimer());
	private readonly startupTimer = this._register(new TimeoutTimer());
	private readonly startup = new DeferredPromise<boolean>();

	constructor(private readonly options: ILicenseManagerOptions) {
		super();
		// The synchronous last-ditch path, for exits that cannot await anything
		// (a process `exit` handler). Prefer `stop()`, which also waits for the
		// client to finish returning the lease.
		this._register(toDisposable(() => {
			this.stopped = true;
			this.child?.kill('SIGTERM');
			this.child = undefined;
		}));
	}

	/**
	 * Spawns the client and waits for it to confirm a lease.
	 *
	 * @returns true if a license was confirmed within the startup timeout.
	 */
	async start(): Promise<boolean> {
		this.spawnChild();
		this.startupTimer.cancelAndSet(
			() => this.startup.complete(false),
			this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
		);
		return this.startup.p;
	}

	/**
	 * Terminates the client and waits for it to check the seat back in.
	 *
	 * SIGTERM is what makes the client return the lease, so shutdown cannot just
	 * fire the signal and exit: when the server is PID 1 in a container, exiting
	 * tears the container down and the client is killed part-way through the
	 * check-in, leaving the seat held until its lease expires. Bounded by
	 * {@link ILicenseManagerOptions.stopTimeoutMs} so a wedged client cannot keep
	 * the server from exiting.
	 */
	async stop(): Promise<void> {
		const exited = this.childExited;
		this.dispose();
		if (!exited || exited.isSettled) {
			return;
		}
		const expiry = timeout(this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
		try {
			await Promise.race([exited.p, expiry]);
		} finally {
			expiry.cancel();
		}
	}

	private spawnChild(): void {
		if (this.stopped) {
			return;
		}

		const child = (this.options.spawn ?? spawnLicenseManager)(
			this.options.binaryPath,
			this.options.args ?? ['acquire-lease'],
			this.options.env ?? process.env
		);
		this.child = child;
		const exited = new DeferredPromise<void>();
		this.childExited = exited;

		// Each frame arrives as two lines, so the first is held until the second
		// can be checked against it.
		let digest = '';
		child.stdout?.pipe(new StreamSplitter('\n')).on('data', (chunk: Buffer) => {
			const line = chunk.toString('utf8').trim();
			if (!line) {
				return;
			}
			if (!line.startsWith('{')) {
				digest = line;
				return;
			}

			const message = parseLicenseManagerFrame(digest, line, this.options.key);
			digest = '';
			if (message) {
				this.onMessage(message);
			} else {
				console.error('[license-manager] Discarding an unusable message.');
			}
		});

		// The message contract lives on stdout; stderr is diagnostics only.
		child.stderr?.on('data', chunk => {
			console.error('[license-manager] ', String(chunk).trimEnd());
		});

		// A binary that is missing or not executable raises 'error' and never
		// raises 'exit', so both paths have to be treated as the client dying.
		// `exited` is completed before `onChildDown` because that method drops its
		// reference to the child, which a concurrent `stop()` would otherwise be
		// left waiting on forever.
		child.once('error', err => {
			console.error('[license-manager] failed to run: ', err);
			exited.complete();
			this.onChildDown(child);
		});
		child.once('exit', () => {
			exited.complete();
			this.onChildDown(child);
		});
	}

	/** Handles the client dying, ignoring a child we have already replaced. */
	private onChildDown(child: ILicenseManagerProcess): void {
		if (this.child !== child) {
			return;
		}
		this.child = undefined;
		if (this.stopped) {
			return;
		}
		this.beginGrace();
		this.restartTimer.cancelAndSet(
			() => this.spawnChild(),
			this.options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS
		);
	}

	private onMessage(message: ILicenseManagerMessage): void {
		if (message.status !== STATUS_ACTIVATED) {
			// Any non-activated status means the client could not hold a lease.
			this.beginGrace();
			return;
		}

		this.graceTimer.cancel();
		if (!this.licensed) {
			this.licensed = true;
			console.log(
				`Positron license acquired from the license manager ` +
				`(days left: ${message.daysLeft ?? 'unknown'}, users: ${message.users ?? 'unknown'}).`
			);
		}
		this.startup.complete(true);
	}

	/**
	 * Enters the grace period, if not already counting down.
	 *
	 * `setIfNotSet` is what keeps the countdown from restarting: while failing,
	 * the client reports roughly every 10 seconds, and rearming each time would
	 * keep the server alive indefinitely without a license.
	 */
	private beginGrace(): void {
		if (this.stopped || !this.licensed) {
			// Before the first lease there is nothing to lose; startup times out
			// on its own. After enforcement, further failures change nothing.
			return;
		}

		this.graceTimer.setIfNotSet(() => {
			this.licensed = false;
			this.options.onUnlicensed();
		}, this.options.graceMs ?? DEFAULT_GRACE_MS);
	}
}
