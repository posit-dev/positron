/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';

/**
 * A renderer for view tests. PositronDynamicModalDialog reads onResize and onKeyDown from it
 * while mounted; dispose is there for the close paths.
 */
export function makeDialogRenderer(): PositronModalReactRenderer {
	return stubInterface<PositronModalReactRenderer>({
		onKeyDown: new Emitter<KeyboardEvent>().event,
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
