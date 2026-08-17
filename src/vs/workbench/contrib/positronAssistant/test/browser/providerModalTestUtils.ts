/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';

/**
 * A renderer for view tests. PositronDynamicModalDialog only reads onResize from
 * it while mounted; dispose is there for the close paths.
 */
export function makeDialogRenderer(): PositronModalDialogReactRenderer {
	return stubInterface<PositronModalDialogReactRenderer>({
		onResize: new Emitter<UIEvent>().event,
		dispose: () => { },
	});
}

/** The dialog props each provider modal view needs to draw its own box. */
export function dialogProps() {
	return {
		renderer: makeDialogRenderer(),
		title: 'Test Title',
		width: 600,
	};
}
