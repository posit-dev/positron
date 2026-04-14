/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RefObject, useLayoutEffect } from 'react';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { addDisposableListener, getWindow } from '../../../../base/browser/dom.js';

/**
 * Wall-clock time (ms) the scroll position must remain stable (no corrections
 * needed) before we consider the layout settled and stop the loop.
 */
const STABLE_DURATION_MS = 200;

/** Maximum time (ms) to keep the restoration loop running before giving up. */
const TIMEOUT_MS = 1500;

/**
 * Restores scroll position by continuously scrolling the container to the
 * target returned by {@link getScrollTop}. A requestAnimationFrame loop
 * runs for up to 1.5 s to accommodate async layout shifts (e.g. from markdown
 * previews and editor model loading). The loop stops early once the position
 * has been stable for 200 ms of wall-clock time, or if the user scrolls
 * (detected via wheel/pointer/keyboard events, since programmatic scrollTop
 * assignments also fire scroll events).
 *
 * @param containerRef Ref to the scrollable container element.
 * @param getScrollTop Callback returning the target scrollTop, or undefined
 *   if the target cannot be resolved. Called each frame. Pass undefined to skip.
 * @param logService Logger for debug output.
 */
export function useScrollRestoration(
	containerRef: RefObject<HTMLElement | null>,
	getScrollTop: (() => number | undefined) | undefined,
	logService: ILogService
) {
	// Use a layout effect so that if the first scroll position update is correct
	// it'll apply before the paint, avoiding a flash of incorrect scroll position.
	return useLayoutEffect(() => {
		// Nothing to restore.
		if (!getScrollTop) {
			logService.debug('[scroll-restore] skipped: no getScrollTop callback');
			return;
		}

		const container = containerRef.current;

		// Container not yet in the DOM, nothing we can do.
		if (!container) {
			logService.debug('[scroll-restore] skipped: container not in DOM');
			return;
		}

		const initialScrollTop = container.scrollTop;
		const initialTarget = getScrollTop();
		logService.debug(
			`[scroll-restore] starting: initialScrollTop=${initialScrollTop}, target=${initialTarget}`
		);

		const startTimestamp = performance.now();
		const targetWindow = getWindow(container);
		const disposables = new DisposableStore();
		let running = true;
		let pendingFrame: number | undefined;
		let frameCount = 0;

		/** Wall-clock time of the last correction. Used for time-based stability
		 *  detection. We declare stable once no correction has been needed for
		 *  STABLE_DURATION_MS of real elapsed time. */
		let lastCorrectionTime = startTimestamp;

		/** Stop the restoration loop and log the final state. */
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
			const drift = target !== undefined
				? container.scrollTop - target
				: NaN;
			const stableSince = performance.now() - lastCorrectionTime;
			logService.debug(
				`[scroll-restore] ${reason} +${(performance.now() - startTimestamp).toFixed(0)}ms` +
				` (${frameCount} frames, stable ${stableSince.toFixed(0)}ms):` +
				` final scrollTop=${container.scrollTop}, target=${target}, drift=${drift.toFixed(1)}px`
			);
		};

		/** Schedule a scroll position correction for the next frame. */
		const scheduleUpdate = () => {
			if (!running) {
				return;
			}

			pendingFrame = targetWindow.requestAnimationFrame(() => {
				pendingFrame = undefined;
				frameCount++;

				const target = getScrollTop();

				if (target === undefined) {
					logService.debug(`[scroll-restore] target became undefined on frame ${frameCount}`);
					stop('no-target');
					return;
				}

				if (Math.abs(container.scrollTop - target) < 1) {
					// Close enough. If no correction has been needed for
					// STABLE_DURATION_MS of wall-clock time, the layout has
					// settled and we can stop.
					if (performance.now() - lastCorrectionTime >= STABLE_DURATION_MS) {
						stop('stable');
						return;
					}
				} else {
					// Still drifting (e.g. async content is shifting layout).
					// Record the correction time and fix the scroll position.
					logService.debug(
						`[scroll-restore] correcting frame ${frameCount}:` +
						` scrollTop=${container.scrollTop} -> target=${target}, delta=${(container.scrollTop - target).toFixed(1)}`
					);
					lastCorrectionTime = performance.now();
					container.scrollTop = target;
				}

				// Check the timeout inside the rAF callback so the last
				// frame always gets a correction attempt before we stop.
				if (performance.now() - startTimestamp > TIMEOUT_MS) {
					stop('timeout');
					return;
				}

				scheduleUpdate();
			});
		};

		// Kick off the loop.
		scheduleUpdate();

		// Cancel restoration on user-initiated scroll input. We listen for
		// specific input events rather than the generic 'scroll' event because
		// our own programmatic scrollTop assignments also fire 'scroll'.
		disposables.add(addDisposableListener(container, 'wheel', () => stop('wheel')));
		disposables.add(addDisposableListener(container, 'pointerdown', () => stop('pointerdown')));
		disposables.add(addDisposableListener(container, 'keydown', () => stop('keydown')));

		return () => {
			stop('unmount');
		};
	}, [getScrollTop, logService, containerRef]);
}
