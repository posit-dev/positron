/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronPreview } from '../../browser/positronPreview.js';
import { PositronOpenUrlInViewerAction } from '../../browser/positronPreviewActions.js';
import { IPositronPreviewService, POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, PreviewOpenTarget } from '../../browser/positronPreviewSevice.js';
import { PositronPreviewViewPane } from '../../browser/positronPreviewView.js';
import { IPreviewSurface } from '../../browser/previewSurface.js';
import { PreviewWebview } from '../../browser/previewWebview.js';
import { PreviewUrl } from '../../browser/previewUrl.js';

describe('PositronPreview stop button', () => {
	let preview: PreviewWebview;
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPreviewService, {
			get activePreviewWebview() { return preview; },
			onDidChangeActivePreviewWebview: Event.None,
			onDidChangeNavigationState: Event.None,
			canGoBack: false,
			canGoForward: false,
			getDefaultOpenTarget: () => PreviewOpenTarget.Browser,
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
		preview = ctx.disposables.add(new PreviewWebview('test.view', 'preview-1', 'Test', stubInterface<IPreviewSurface>({
			kind: 'webview',
			title: undefined,
			onDidLoad: Event.None,
			release: () => { },
			dispose: () => { },
		})));
	});

	it('leaves navigation to an extension webview', () => {
		rtl.render(<PositronPreview reactComponentContainer={container} />);
		expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
		expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
	});

	it('shows the stop button only while the preview is stoppable', () => {
		rtl.render(<PositronPreview reactComponentContainer={container} />);
		expect(screen.queryByRole('button', { name: 'Stop the preview' })).not.toBeInTheDocument();

		act(() => { preview.stoppable = true; });
		expect(screen.getByRole('button', { name: 'Stop the preview' })).toBeInTheDocument();

		act(() => { preview.stoppable = false; });
		expect(screen.queryByRole('button', { name: 'Stop the preview' })).not.toBeInTheDocument();
	});

	it('asks the preview\'s owner to stop and hides the button when the user clicks stop', async () => {
		const user = userEvent.setup();
		const onStop = vi.fn();
		ctx.disposables.add(preview.onDidRequestStop(onStop));
		preview.stoppable = true;
		rtl.render(<PositronPreview reactComponentContainer={container} />);

		await user.click(screen.getByRole('button', { name: 'Stop the preview' }));

		expect(onStop).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('button', { name: 'Stop the preview' })).not.toBeInTheDocument();
	});
});

describe('PositronPreview empty state', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPreviewService, {
			activePreviewWebview: undefined,
			onDidChangeActivePreviewWebview: Event.None,
			onDidChangeNavigationState: Event.None,
			canGoBack: false,
			canGoForward: false,
			getDefaultOpenTarget: () => PreviewOpenTarget.Browser,
		})
		.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
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

	it('opens the URL the user enters in the Viewer', async () => {
		const user = userEvent.setup();
		rtl.render(<PositronPreview reactComponentContainer={container} />);

		await user.type(screen.getByRole('textbox', { name: 'The current URL' }), 'localhost:8080{Enter}');

		expect(ctx.get(ICommandService).executeCommand).toHaveBeenCalledWith(PositronOpenUrlInViewerAction.ID, 'localhost:8080');
	});
});

describe('PositronPreview content without a URL', () => {
	let preview: PreviewWebview;
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPreviewService, {
			get activePreviewWebview() { return preview; },
			onDidChangeActivePreviewWebview: Event.None,
			onDidChangeNavigationState: Event.None,
			canGoBack: true,
			canGoForward: false,
			goBack: vi.fn(),
			getDefaultOpenTarget: () => PreviewOpenTarget.Browser,
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
		preview = ctx.disposables.add(new PreviewWebview(POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, 'widget-1', 'R 4.5.0', stubInterface<IPreviewSurface>({
			kind: 'webview',
			title: undefined,
			onDidLoad: Event.None,
			release: () => { },
			dispose: () => { },
		})));
	});

	it('shows its title in a URL bar that can\'t be edited, and goes back through the Viewer\'s history', async () => {
		const user = userEvent.setup();
		rtl.render(<PositronPreview reactComponentContainer={container} />);
		const bar = screen.getByRole('textbox', { name: 'The content showing' });

		await user.click(screen.getByRole('button', { name: 'Go back' }));

		expect({
			title: (bar as HTMLInputElement).value,
			disabled: (bar as HTMLInputElement).disabled,
			forwardDisabled: screen.getByRole('button', { name: 'Go forward' }).getAttribute('aria-disabled'),
			wentBack: vi.mocked(ctx.get(IPositronPreviewService).goBack).mock.calls.length,
		}).toEqual({ title: 'R 4.5.0 output', disabled: true, forwardDisabled: 'true', wentBack: 1 });
	});
});

describe('PositronPreview zoom', () => {
	const zoom = new Emitter<number>();
	let preview: PreviewWebview;
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPreviewService, {
			get activePreviewWebview() { return preview; },
			onDidChangeActivePreviewWebview: Event.None,
			onDidChangeNavigationState: Event.None,
			canGoBack: false,
			canGoForward: false,
			getDefaultOpenTarget: () => PreviewOpenTarget.Browser,
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
		preview = ctx.disposables.add(new PreviewUrl('preview-1', stubInterface<IPreviewSurface>({
			kind: 'browser',
			title: undefined,
			onDidLoad: Event.None,
			onDidNavigate: Event.None,
			onDidZoom: zoom.event,
			loadUri: () => { },
			release: () => { },
			dispose: () => { },
		}), URI.parse('http://localhost:8000/')));
	});

	it('shows the zoom in the URL bar briefly after the user zooms', () => {
		vi.useFakeTimers();
		rtl.render(<PositronPreview reactComponentContainer={container} />);

		act(() => zoom.fire(1.25));
		expect(screen.getByText('125%')).toBeInTheDocument();

		act(() => { vi.advanceTimersByTime(750); });
		expect(screen.queryByText('125%')).not.toBeInTheDocument();
		vi.useRealTimers();
	});
});
