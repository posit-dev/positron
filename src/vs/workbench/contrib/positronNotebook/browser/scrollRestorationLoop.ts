/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { addDisposableListener, getWindow } from '../../../../base/browser/dom.js';

/**
 * Wall-clock time (ms) the scroll position must remain stable (no corrections
 * needed) before we consider the layout settled and stop the loop.
 */
const STABLE_DURATION_MS = 500;

/**
 * Maximum time (ms) to keep the restoration loop running before giving up.
 * Generous enough to cover slow CI environments where pre-target cells
 * (especially markdown with mixed content) finish their async render after
 * the loop has started; shorter timeouts left scroll position stale at the
 * height the cells had part-way through rendering. The loop short-circuits
 * via STABLE_DURATION_MS in the common case, so this is a worst-case bound.
 */
const TIMEOUT_MS = 5000;

/**
 * Drive an rAF scroll restoration loop on `container`, correcting drift to
 * `getScrollTop()` until the position is stable, the user scrolls, or the
 * timeout elapses. Returns a disposable that stops the loop.
 */
export function startScrollRestorationLoop(
	container: HTMLElement,
	getScrollTop: () => number | undefined,
	logService: ILogService
): IDisposable {
	const initialScrollTop = container.scrollTop;
	const initialTarget = getScrollTop();
	logService.debug(
		`[scroll-restore] starting: initialScrollTop=${initialScrollTop}, target=${initialTarget}`
	);

	// Synchronous initial correction so callers in pre-paint positions (or
	// right after a DOM reattach that reset scrollTop to 0) don't paint a
	// frame at the wrong scrollTop before the first rAF callback runs.
	if (initialTarget !== undefined && Math.abs(container.scrollTop - initialTarget) >= 1) {
		container.scrollTop = initialTarget;
	}

	const startTimestamp = performance.now();
	const targetWindow = getWindow(container);
	const disposables = new DisposableStore();
	let running = true;
	let pendingFrame: number | undefined;
	let frameCount = 0;
	let lastCorrectionTime = startTimestamp;

	const stop = (reason: string) => {
		if (!running) {
			return;
		}
		running = false;

		if (pendingFrame !== undefined) {
			targetWindow.cancelAnimationFrame(pendingFrame);
			pendingFrame = undefined;
		}
		disposables.dispose();

		const target = getScrollTop();
		const drift = target && container.scrollTop - target;
		const driftString = drift ? `${drift.toFixed(1)}px` : 'N/A (getScrollTop returned undefined)';
		const stableSince = performance.now() - lastCorrectionTime;
		logService.debug(
			`[scroll-restore] stopped with reason: ${reason} +${(performance.now() - startTimestamp).toFixed(0)}ms` +
			` (${frameCount} frames, stable ${stableSince.toFixed(0)}ms):` +
			` final scrollTop=${container.scrollTop}, target=${target}, drift=${driftString}`
		);
	};

	const scheduleUpdate = () => {
		if (!running) {
			return;
		}

		pendingFrame = targetWindow.requestAnimationFrame(() => {
			pendingFrame = undefined;
			frameCount++;

			// Container parked off-DOM (e.g. clearInput on a cached notebook):
			// scrollTop writes are useless and we should stop instead of
			// burning rAF until the timeout.
			if (!container.isConnected) {
				stop('detached');
				return;
			}

			const target = getScrollTop();

			if (target === undefined) {
				logService.debug(`[scroll-restore] target became undefined on frame ${frameCount}`);
				stop('no-target');
				return;
			}

			if (Math.abs(container.scrollTop - target) < 1) {
				if (performance.now() - lastCorrectionTime >= STABLE_DURATION_MS) {
					stop('stable');
					return;
				}
			} else {
				logService.debug(
					`[scroll-restore] correcting frame ${frameCount}:` +
					` scrollTop=${container.scrollTop} -> target=${target}, delta=${(container.scrollTop - target).toFixed(1)}`
				);
				lastCorrectionTime = performance.now();
				container.scrollTop = target;
			}

			// Check the timeout inside the rAF callback so the last frame always
			// gets a correction attempt before we stop.
			if (performance.now() - startTimestamp > TIMEOUT_MS) {
				stop('timeout');
				return;
			}

			scheduleUpdate();
		});
	};

	scheduleUpdate();

	// Listen for specific input events rather than 'scroll' because our own
	// programmatic scrollTop assignments also fire 'scroll'.
	disposables.add(addDisposableListener(container, 'wheel', () => stop('wheel')));
	disposables.add(addDisposableListener(container, 'pointerdown', () => stop('pointerdown')));
	disposables.add(addDisposableListener(container, 'keydown', () => stop('keydown')));

	return toDisposable(() => stop('disposed'));
}

