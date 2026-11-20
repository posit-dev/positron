/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, type RefObject } from 'react';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { shiftWheelToHorizontal } from '../../../../../base/common/positronWheel.js';

/**
 * Forwards wheel events from `sourceRef` to `targetRef` so that scrolling
 * works even when the cursor is over an overlay like an action bar.
 * Only prevents default if the scroll position actually changed, so that
 * parent scrolling kicks in at boundaries.
 * @param sourceRef The element whose wheel events are forwarded.
 * @param targetRef The scrollable element that receives them.
 * @param isMac Whether the platform is macOS, which decides how shift + wheel is converted.
 * Defaults to the current platform.
 */
export function useWheelForwarding(
	sourceRef: RefObject<HTMLElement | null>,
	targetRef: RefObject<HTMLElement | null>,
	isMac: boolean = isMacintosh,
) {
	useEffect(() => {
		const source = sourceRef.current;
		if (!source) {
			return;
		}
		const handleWheel = (e: WheelEvent) => {
			const scrollable = targetRef.current;
			if (scrollable) {
				const prevTop = scrollable.scrollTop;
				const prevLeft = scrollable.scrollLeft;
				// The source is outside the target, so the browser's conversion of shift + wheel
				// to horizontal scrolling would not reach the target. Do that conversion here.
				const { deltaX, deltaY } = shiftWheelToHorizontal(e, isMac);
				scrollable.scrollTop += deltaY;
				scrollable.scrollLeft += deltaX;
				if (scrollable.scrollTop !== prevTop || scrollable.scrollLeft !== prevLeft) {
					e.preventDefault();
				}
			}
		};
		source.addEventListener('wheel', handleWheel, { passive: false });
		return () => source.removeEventListener('wheel', handleWheel);
	}, [sourceRef, targetRef, isMac]);
}
