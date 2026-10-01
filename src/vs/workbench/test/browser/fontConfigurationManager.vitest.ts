/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as DOM from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { IPixelRatioMonitor, PixelRatio } from '../../../base/browser/pixelRatio.js';
import { FontInfo } from '../../../editor/common/config/fontInfo.js';
import { FontMeasurements } from '../../../editor/browser/config/fontMeasurements.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { stubInterface } from '../../../test/vitest/stubInterface.js';
import { FontConfigurationManager } from '../../browser/fontConfigurationManager.js';

describe('FontConfigurationManager.getFontInfo', () => {
	// Fonts are measured in a particular window, because pixel ratio and zoom are per window: a
	// popped-out (auxiliary) window can differ from the main one. The measurement itself isn't under
	// test, only which window it is taken in, so both measuring calls are stubbed.
	function stubMeasurement() {
		vi.spyOn(PixelRatio, 'getInstance').mockReturnValue(stubInterface<IPixelRatioMonitor>({ value: 1 }));
		return vi.spyOn(FontMeasurements, 'readFontInfo').mockReturnValue(stubInterface<FontInfo>({}));
	}

	const configurationService = new TestConfigurationService({ editor: {} });

	it('measures in the container\'s own window when given one', () => {
		const readFontInfo = stubMeasurement();
		// An iframe's document stands in for an auxiliary window's.
		const iframe = mainWindow.document.createElement('iframe');
		mainWindow.document.body.appendChild(iframe);
		const container = iframe.contentDocument!.createElement('div');
		iframe.contentDocument!.body.appendChild(container);

		try {
			FontConfigurationManager.getFontInfo(configurationService, 'editor', container);

			expect(readFontInfo.mock.calls[0][0]).toBe(iframe.contentWindow);
		} finally {
			iframe.remove();
		}
	});

	it('measures in the active window when given no container', () => {
		const readFontInfo = stubMeasurement();

		FontConfigurationManager.getFontInfo(configurationService, 'editor');

		expect(readFontInfo.mock.calls[0][0]).toBe(DOM.getActiveWindow());
	});
});
