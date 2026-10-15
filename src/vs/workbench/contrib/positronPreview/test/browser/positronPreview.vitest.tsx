/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { PositronPreview } from '../../browser/positronPreview.js';
import { IPositronPreviewService } from '../../browser/positronPreviewSevice.js';
import { PositronPreviewViewPane } from '../../browser/positronPreviewView.js';
import { PreviewOverlayWebview } from '../../browser/previewOverlayWebview.js';
import { PreviewWebview } from '../../browser/previewWebview.js';

describe('PositronPreview stop button', () => {
	let preview: PreviewWebview;
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPreviewService, {
			get activePreviewWebview() { return preview; },
			onDidChangeActivePreviewWebview: Event.None,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const container = stubInterface<PositronPreviewViewPane>({
		width: 400,
		height: 300,
		containerVisible: false,
		onSizeChanged: Event.None,
		onPositionChanged: Event.None,
		onVisibilityChanged: Event.None,
	});

	beforeEach(() => {
		preview = ctx.disposables.add(new PreviewWebview('test.view', 'preview-1', 'Test', stubInterface<PreviewOverlayWebview>({
			webview: stubInterface<IOverlayWebview>({ release: () => { } }),
			dispose: () => { },
		})));
	});

	it('shows the stop button only while the preview is stoppable', () => {
		rtl.render(<PositronPreview reactComponentContainer={container} />);
		expect(screen.queryByRole('button', { name: 'Interrupt execution' })).not.toBeInTheDocument();

		act(() => { preview.stoppable = true; });
		expect(screen.getByRole('button', { name: 'Interrupt execution' })).toBeInTheDocument();

		act(() => { preview.stoppable = false; });
		expect(screen.queryByRole('button', { name: 'Interrupt execution' })).not.toBeInTheDocument();
	});

	it('asks the preview\'s owner to stop and hides the button when the user clicks stop', async () => {
		const user = userEvent.setup();
		const onStop = vi.fn();
		ctx.disposables.add(preview.onDidRequestStop(onStop));
		preview.stoppable = true;
		rtl.render(<PositronPreview reactComponentContainer={container} />);

		await user.click(screen.getByRole('button', { name: 'Interrupt execution' }));

		expect(onStop).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('button', { name: 'Interrupt execution' })).not.toBeInTheDocument();
	});
});
