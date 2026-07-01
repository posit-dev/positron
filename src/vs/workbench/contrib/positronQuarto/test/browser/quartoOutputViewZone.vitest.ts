/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { hideWebviewOverlayWhenAnchorHidden } from '../../browser/quartoOutputViewZone.js';

describe('hideWebviewOverlayWhenAnchorHidden', () => {
	it('hides the overlay when its anchor is no longer visible', () => {
		// The inline output webview is a fixed-position overlay anchored to a
		// placeholder inside the editor view zone. When the placeholder scrolls
		// out of the rendered range and is removed, the overlay must be hidden
		// rather than falling back to (and "sticking" in) the editor corner.
		// See posit-dev/positron#13978.
		const overlayContent = document.createElement('div');

		hideWebviewOverlayWhenAnchorHidden(overlayContent);

		expect(overlayContent.style.getPropertyValue('position-visibility')).toBe('anchors-visible');
	});
});
