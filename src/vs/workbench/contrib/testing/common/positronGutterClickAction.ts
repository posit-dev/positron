/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultGutterClickAction } from './configuration.js';
import { TestRunProfileBitset } from './testTypes.js';

/**
 * The profile groups a click on a test's gutter decoration runs.
 */
export interface IGutterClickGroups {
	/** The group a plain click runs. */
	readonly primary: TestRunProfileBitset;
	/** The group an Alt+click runs. Equal to `primary` when there is no distinct alternate. */
	readonly alternate: TestRunProfileBitset;
}

/**
 * Resolves which profile groups a gutter click and Alt+click should run, given
 * the `testing.defaultGutterClickAction` setting and the capabilities of the
 * test's controller (see `ITestProfileService.capabilitiesForTest`).
 *
 * A primary group the controller has no profile for falls back to Run, so a
 * click on a Run-only test (e.g. R) runs it instead of silently doing nothing.
 * An unsupported alternate falls back to the primary group, which also tells
 * the caller not to swap the gutter icon while Alt is held.
 */
export function resolveGutterClickGroups(action: DefaultGutterClickAction, capabilities: number): IGutterClickGroups {
	const isSupported = (group: TestRunProfileBitset) => (capabilities & group) !== 0;

	let requestedPrimary: TestRunProfileBitset;
	let requestedAlternate: TestRunProfileBitset;
	switch (action) {
		case DefaultGutterClickAction.Debug:
			requestedPrimary = TestRunProfileBitset.Debug;
			requestedAlternate = TestRunProfileBitset.Run;
			break;
		case DefaultGutterClickAction.Coverage:
			requestedPrimary = TestRunProfileBitset.Coverage;
			requestedAlternate = TestRunProfileBitset.Debug;
			break;
		case DefaultGutterClickAction.Run:
		case DefaultGutterClickAction.ContextMenu:
		default:
			requestedPrimary = TestRunProfileBitset.Run;
			requestedAlternate = TestRunProfileBitset.Debug;
			break;
	}

	const primary = isSupported(requestedPrimary) ? requestedPrimary : TestRunProfileBitset.Run;
	const alternate = isSupported(requestedAlternate) && requestedAlternate !== primary ? requestedAlternate : primary;
	return { primary, alternate };
}
