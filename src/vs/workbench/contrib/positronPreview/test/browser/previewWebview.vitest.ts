/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { PreviewOverlayWebview } from '../../browser/previewOverlayWebview.js';
import { PreviewWebview } from '../../browser/previewWebview.js';

describe('PreviewWebview stop requests', () => {
	const disposables = ensureNoLeakedDisposables();

	function createPreview(): { preview: PreviewWebview; events: string[] } {
		const preview = disposables.add(new PreviewWebview('test.view', 'preview-1', 'Test',
			stubInterface<PreviewOverlayWebview>({ dispose: () => { } })));
		const events: string[] = [];
		disposables.add(preview.onDidChangeStoppable(stoppable => events.push(`stoppable: ${stoppable}`)));
		disposables.add(preview.onDidRequestStop(() => events.push('stop requested')));
		return { preview, events };
	}

	it('hides the stop button and asks the owner to stop when the preview is stoppable', () => {
		const { preview, events } = createPreview();
		preview.stoppable = true;

		preview.requestStop();

		expect({ stoppable: preview.stoppable, events }).toEqual({
			stoppable: false,
			events: ['stoppable: true', 'stoppable: false', 'stop requested'],
		});
	});

	it('ignores a stop request when the preview is not stoppable', () => {
		const { preview, events } = createPreview();

		preview.requestStop();

		expect(events).toEqual([]);
	});
});
