/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2 } from '../../../../../platform/actions/common/actions.js';

/**
 * `Action2.desc.keybinding` is typed as `OneOrN<...>` (a single rule or an array)
 * upstream. Positron's notebook actions each declare exactly one keybinding, so
 * tests can normalize to that single rule for metadata assertions.
 */
export function singleKeybinding(keybinding: Action2['desc']['keybinding']) {
	return Array.isArray(keybinding) ? keybinding[0] : keybinding;
}
