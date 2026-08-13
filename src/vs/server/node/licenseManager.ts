/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { Readable } from 'stream';
import { DeferredPromise, TimeoutTimer } from '../../base/common/async.js';
import { Disposable, toDisposable } from '../../base/common/lifecycle.js';
import { StreamSplitter } from '../../base/node/nodeStreams.js';

/**
 * Supervises the `license-manager-aws-sagemaker` client.
 *
 * In hosted environments such as SageMaker there is no signed license token to
 * present. Instead the client checks a seat out of AWS License Manager and holds
 * it for as long as it runs, extending the lease before it expires. The server's
 * licensed state follows what the client reports on stdout.
 *
 * Wire contract (rstudio/licensing-clients, `types.Message.WriteJson`): the
 * client writes two LF-terminated lines per refresh, a base64 HMAC-SHA256 line
 * followed by a single-line JSON object. We read the JSON and deliberately
 * ignore the HMAC: the key is injected at the client's build time, so verifying
 * it here would mean embedding a shared symmetric secret in this repository for
 * no in-container gain -- the client is already our own child process.
 *
 * Check-in on shutdown is deliberately not implemented here. The client calls
 * `PR_SET_PDEATHSIG(SIGHUP)` and handles SIGHUP/SIGINT/SIGTERM by checking the
 * lease back in, so the kernel releases the seat even if this process dies
 * abruptly. Duplicating that with a supervised shutdown sequence would add a
 * failure mode without adding a guarantee.
 */

/** The only two statuses the client reports (`types.go`). */
const STATUS_ACTIVATED = 'activated';

/** How long a lost lease is tolerated before the server is unlicensed. */
const DEFAULT_GRACE_MS = 10 * 60_000;

/** How long to wait for the first activated message at startup. */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/** How long to wait before respawning a client that exited. */
const DEFAULT_RESTART_DELAY_MS = 10_000;

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
	/** How long a lost lease is tolerated. */
	graceMs?: number;
	/** How long to wait for the first activated message. */
	startupTimeoutMs?: number;
	/** Delay before respawning a client that exited. */
	restartDelayMs?: number;
	/** Spawns the client; defaults to the real one. Tests pass a fake. */
	spawn?: (binaryPath: string, args: string[], env: NodeJS.ProcessEnv) => ILicenseManagerProcess;
}

/**
 * Decodes one line of the client's stdout.
 *
 * @returns The message, or undefined for the HMAC line and anything else that
 * is not a JSON object. Base64 never starts with '{', so this cleanly selects
 * messages without needing to track position in the two-line frame.
 */
export function parseLicenseManagerLine(line: string): ILicenseManagerMessage | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{')) {
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

	// `users` is string-encoded by Go's `,string` struct tag while `days-left`
	// and `expiration` are plain numbers, so both forms are accepted.
	return {
		status: String(parsed['status'] ?? ''),
		expirationMs: optionalNumber(parsed['expiration']),
		daysLeft: optionalNumber(parsed['days-left']),
		users: optionalNumber(parsed['users']),
	};
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
	private licensed = false;
	private stopped = false;
	private readonly graceTimer = this._register(new TimeoutTimer());
	private readonly restartTimer = this._register(new TimeoutTimer());
	private readonly startupTimer = this._register(new TimeoutTimer());
	private readonly startup = new DeferredPromise<boolean>();

	constructor(private readonly options: ILicenseManagerOptions) {
		super();
		this._register(toDisposable(() => {
			this.stopped = true;
			// Best effort, and deliberately not awaited: the client checks the
			// lease back in on SIGTERM, and its PR_SET_PDEATHSIG covers the case
			// where this process dies without getting here.
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

		child.stdout?.pipe(new StreamSplitter('\n')).on('data', (line: Buffer) => {
			const message = parseLicenseManagerLine(line.toString('utf8'));
			if (message) {
				this.onMessage(message);
			}
		});

		// The client logs JSON diagnostics to stderr. Surfaced but never parsed:
		// the message contract lives on stdout, and reading stderr would risk
		// acting on log text that happens to look like a lease message.
		child.stderr?.on('data', chunk => {
			console.error('[license-manager] ', String(chunk).trimEnd());
		});

		// A binary that is missing or not executable raises 'error' and never
		// raises 'exit', so both paths have to be treated as the client dying.
		child.once('error', err => {
			console.error('[license-manager] failed to run: ', err);
			this.onChildDown(child);
		});
		child.once('exit', () => this.onChildDown(child));
	}

	/** Handles the client dying, ignoring a child we have already replaced. */
	private onChildDown(child: ILicenseManagerProcess): void {
		if (this.child !== child) {
			return;
		}
		this.child = undefined;
		if (this.stopped) {
			// Teardown kills the client itself; respawning here would race the
			// disposal of the restart timer and leave a stray child behind.
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
