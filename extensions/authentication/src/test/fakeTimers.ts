/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';

/**
 * Install sinon fake timers that forward clears of native timers to the real
 * clearTimeout/clearInterval. The fake clock replaces the extension host's
 * global timers, so other code clearing a native timer mid-test would
 * otherwise trigger a FakeTimers warning.
 */
export function useFakeTimers(): sinon.SinonFakeTimers {
	// @types/sinon lags fake-timers and does not declare this option.
	const config: Partial<sinon.SinonFakeTimersConfig> & { shouldClearNativeTimers: boolean } = {
		shouldClearNativeTimers: true,
	};
	return sinon.useFakeTimers(config);
}
