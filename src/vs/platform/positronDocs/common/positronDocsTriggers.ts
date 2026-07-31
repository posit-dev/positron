/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDocsBundleRequest } from './positronDocsBundle.js';
import { IDocsLogger, ILocalDocs } from './positronDocsIO.js';

const LOG_PREFIX = '[positron-docs]';

/** The slice of PositronDocsCache the triggers need. */
export interface IDocsCacheLike {
	ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined>;
	peek(request: IDocsBundleRequest): Promise<ILocalDocs | undefined>;
	invalidate(): void;
}

export interface IPositronDocsTriggersOptions {
	readonly cache: IDocsCacheLike;
	readonly request: IDocsBundleRequest;
	readonly logger: IDocsLogger;
	/** Read live: ai.enabled is WINDOW-scoped and toggles without a reload. */
	readonly isAiEnabled: () => Promise<boolean>;
	/** How long getLocalDocs() waits for an in-flight fetch. */
	readonly waitMs: number;
	/** Injected so tests control the timeout without fake timers. */
	readonly delay: (ms: number) => Promise<void>;
}

/** Race outcome, tagged so a resolved-but-undefined fetch stays distinguishable. */
type RaceOutcome =
	| { readonly timedOut: false; readonly docs: ILocalDocs | undefined }
	| { readonly timedOut: true };

/**
 * The three entry points into one operation.
 *
 * Launch and config-flip are fire-and-forget with no timeout, since nothing is
 * waiting on them. Only `getLocalDocs()` is bounded, because a slow link must
 * not stall an assistant response.
 */
export class PositronDocsTriggers {

	constructor(private readonly _options: IPositronDocsTriggersOptions) { }

	/** Launch trigger, and the tail of a config flip. Never throws. */
	async runBackgroundFetch(): Promise<void> {
		if (!await this._options.isAiEnabled()) {
			this._options.logger.info(`${LOG_PREFIX} ai.enabled is off; not fetching docs`);
			return;
		}
		try {
			await this._options.cache.ensure(this._options.request);
		} catch (error) {
			// A background trigger has no caller to surface this to, and a docs
			// download failing is not worth interrupting anyone over.
			this._options.logger.warn(`${LOG_PREFIX} background docs fetch failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** ai.enabled false-to-true: the one in-session re-attempt the design allows. */
	async onAiEnabledFlippedTrue(): Promise<void> {
		this._options.cache.invalidate();
		await this.runBackgroundFetch();
	}

	/**
	 * First-need trigger. Starts the operation if idle, joins it if in flight,
	 * or returns the completed result.
	 */
	async getLocalDocs(): Promise<ILocalDocs | undefined> {
		const { cache, delay, logger, request, waitMs } = this._options;
		if (!await this._options.isAiEnabled()) {
			return undefined;
		}

		const fetching: Promise<RaceOutcome> = cache.ensure(request)
			.then(docs => ({ timedOut: false as const, docs }))
			.catch(error => {
				logger.warn(`${LOG_PREFIX} docs fetch failed: ${error instanceof Error ? error.message : String(error)}`);
				return { timedOut: false as const, docs: undefined };
			});
		const timingOut: Promise<RaceOutcome> = delay(waitMs).then(() => ({ timedOut: true as const }));

		const winner = await Promise.race([fetching, timingOut]);
		if (!winner.timedOut) {
			return winner.docs;
		}

		// The download continues in the background and is available to the next
		// call; only this caller stops waiting. The cache-present rule still
		// applies, so hand back whatever is already on disk.
		logger.info(`${LOG_PREFIX} local docs not ready within ${waitMs}ms; continuing in the background`);
		return await cache.peek(request);
	}
}
