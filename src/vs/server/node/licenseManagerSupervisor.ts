/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { createLicenseManagerStreamParser, LicenseManagerMessage } from './licenseManagerStream.js';

/** How long to wait before respawning a license manager that exited. */
const DEFAULT_RESTART_DELAY_MS = 10_000;

/** How long a child gets to check its license in after SIGTERM. */
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

/** Options for {@link LicenseManagerSupervisor}. */
export interface LicenseManagerSupervisorOptions {
	/** Path to the license manager binary. */
	binaryPath: string;
	/** Arguments to pass; defaults to the lease acquisition subcommand. */
	args?: string[];
	/** Environment for the child; defaults to this process's environment. */
	env?: NodeJS.ProcessEnv;
	/** Called for each message decoded from the child's stdout. */
	onMessage(m: LicenseManagerMessage): void;
	/** Called every time the child exits, whether expected or not. */
	onChildDown(code: number | null): void;
	/** Delay before respawning after an exit. */
	restartDelayMs?: number;
}

/**
 * Runs the license manager client as a supervised child process.
 *
 * The client is expected to run for as long as the server does, holding a
 * checked-out license and refreshing it. If it dies we respawn it, and on
 * shutdown we stop it with SIGTERM so it checks the license back in — skipping
 * that would strand the seat until its lease expires.
 *
 * This class only reports what the child says; deciding what a message means
 * for licensing is the state machine's job.
 */
export class LicenseManagerSupervisor {
	private child: ChildProcess | undefined;
	private restartTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set by stop() so an in-flight exit does not trigger a respawn. */
	private stopped = false;
	/** Resolved when the current child has exited. */
	private exited: Promise<void> | undefined;

	constructor(private readonly options: LicenseManagerSupervisorOptions) { }

	/**
	 * Spawns the license manager and keeps it running until {@link stop} is
	 * called. Safe to call once; subsequent calls while running are ignored.
	 */
	start(): void {
		this.stopped = false;
		if (this.child) {
			return;
		}
		this.spawnChild();
	}

	/**
	 * Stops the license manager, giving it the chance to check its license in.
	 *
	 * @param timeoutMs How long to wait after SIGTERM before sending SIGKILL.
	 */
	async stop(timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
		this.stopped = true;

		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}

		const child = this.child;
		const exited = this.exited;
		if (!child || !exited) {
			return;
		}

		child.kill('SIGTERM');

		// A client that is wedged must not block server shutdown; the seat is
		// then left to expire with its lease.
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const escalate = new Promise<void>(resolve => {
			killTimer = setTimeout(() => {
				child.kill('SIGKILL');
				resolve();
			}, timeoutMs);
		});

		await Promise.race([exited, escalate]);
		// If SIGKILL was needed, still wait for the process to actually go away.
		await exited;

		if (killTimer) {
			clearTimeout(killTimer);
		}
	}

	/** Spawns a child and wires up its output and exit handling. */
	private spawnChild(): void {
		const child = spawn(
			this.options.binaryPath,
			this.options.args ?? ['acquire-lease'],
			{
				env: this.options.env ?? process.env,
				stdio: ['ignore', 'pipe', 'pipe'],
			}
		);
		this.child = child;

		const parse = createLicenseManagerStreamParser(this.options.onMessage);
		child.stdout?.on('data', chunk => parse(chunk));

		// Diagnostics only. The message contract lives on stdout, and parsing
		// stderr would risk acting on log text that happens to look like JSON.
		child.stderr?.on('data', chunk => {
			console.error('[license-manager] ', String(chunk).trimEnd());
		});

		this.exited = new Promise<void>(resolve => {
			let settled = false;

			/** Records the child as gone, exactly once. */
			const settle = (code: number | null): void => {
				if (settled) {
					return;
				}
				settled = true;
				this.child = undefined;
				resolve();
				this.options.onChildDown(code);

				if (!this.stopped) {
					this.restartTimer = setTimeout(
						() => this.spawnChild(),
						this.options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS
					);
				}
			};

			child.on('exit', code => settle(code));

			child.on('error', err => {
				// A binary that is missing or not executable raises this and
				// never raises 'exit'. Treating it as the child being down is
				// what keeps stop() from waiting for an exit that never comes.
				console.error('[license-manager] failed to run: ', err);
				settle(null);
			});
		});
	}
}
