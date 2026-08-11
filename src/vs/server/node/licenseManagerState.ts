/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LicenseManagerMessage } from './licenseManagerStream.js';

/** Default window during which a lost license does not yet stop the server. */
const DEFAULT_GRACE_MS = 10 * 60_000;

/** Default time to wait for the first successful checkout at startup. */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/** Status reported by an activated lease. */
const STATUS_ACTIVATED = 'activated';

/**
 * The server's view of its license.
 *
 * `grace` means the license is not currently confirmed but the server keeps
 * running, to avoid killing a user's session over a transient AWS failure.
 */
export type LicenseState = 'unlicensed' | 'licensed' | 'grace';

/** Options for {@link LicenseStateMachine}. */
export interface LicenseStateOptions {
	/** How long to stay in grace before giving up. */
	graceMs?: number;
	/** How long to wait for the first activated message. */
	startupTimeoutMs?: number;
}

/**
 * Tracks whether the server is licensed, based on what the license manager
 * client reports.
 *
 * Message cadence is deliberately not used as a liveness signal. The client
 * only speaks after each lease refresh, and leases run up to 90 minutes, so a
 * healthy client can be silent for over an hour. The license is therefore held
 * until something positively says otherwise: an `expired` message, or the child
 * process going away.
 */
export class LicenseStateMachine {
	private currentState: LicenseState = 'unlicensed';
	private graceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly listeners: ((s: LicenseState) => void)[] = [];
	/** Resolves the pending awaitStartup() call, if any. */
	private startupResolve: ((licensed: boolean) => void) | undefined;
	private startupTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly options: LicenseStateOptions = {}) { }

	/** The current license state. */
	get state(): LicenseState {
		return this.currentState;
	}

	/** Subscribes to state transitions. */
	onStateChange(cb: (s: LicenseState) => void): void {
		this.listeners.push(cb);
	}

	/**
	 * Waits for the license manager to confirm a license at startup.
	 *
	 * @returns true if a license was confirmed within the startup timeout.
	 */
	awaitStartup(): Promise<boolean> {
		if (this.currentState === 'licensed') {
			return Promise.resolve(true);
		}
		return new Promise<boolean>(resolve => {
			this.startupResolve = resolve;
			this.startupTimer = setTimeout(() => {
				this.startupTimer = undefined;
				this.settleStartup(false);
			}, this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
		});
	}

	/** Handles a message from the license manager client. */
	onMessage(m: LicenseManagerMessage): void {
		if (m.status === STATUS_ACTIVATED) {
			this.clearGraceTimer();
			this.transitionTo('licensed');
			this.settleStartup(true);
			return;
		}

		// Any non-activated status means the client could not hold a license.
		this.beginGrace();
	}

	/**
	 * Handles the client process exiting. The supervisor will respawn it, so
	 * this is treated as a temporary loss rather than an immediate failure.
	 */
	onChildDown(): void {
		this.beginGrace();
	}

	/**
	 * Enters grace, if not already counting down.
	 *
	 * The timer is deliberately not restarted on repeat signals: while failing,
	 * the client reports roughly every 10 seconds, and restarting the countdown
	 * each time would keep the server alive indefinitely without a license.
	 */
	private beginGrace(): void {
		if (this.graceTimer) {
			return;
		}
		// Once grace has already expired, further failures change nothing.
		if (this.currentState === 'unlicensed') {
			return;
		}

		this.transitionTo('grace');
		this.graceTimer = setTimeout(() => {
			this.graceTimer = undefined;
			this.transitionTo('unlicensed');
		}, this.options.graceMs ?? DEFAULT_GRACE_MS);
	}

	private clearGraceTimer(): void {
		if (this.graceTimer) {
			clearTimeout(this.graceTimer);
			this.graceTimer = undefined;
		}
	}

	/** Resolves a pending awaitStartup() exactly once. */
	private settleStartup(licensed: boolean): void {
		if (this.startupTimer) {
			clearTimeout(this.startupTimer);
			this.startupTimer = undefined;
		}
		const resolve = this.startupResolve;
		this.startupResolve = undefined;
		resolve?.(licensed);
	}

	private transitionTo(next: LicenseState): void {
		if (this.currentState === next) {
			return;
		}
		this.currentState = next;
		for (const listener of this.listeners) {
			listener(next);
		}
	}
}
