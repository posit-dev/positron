/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { userEvent, UserEvent } from '@testing-library/user-event';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IntrinsicSize, PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { IOneTimeRender, IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { showCopyPlotModalDialog } from '../../browser/modalDialogs/copyPlotModalDialog.js';

class FakeRender implements IOneTimeRender {
	readonly result = new DeferredPromise<IRenderedPlot>();
	readonly cancel = vi.fn();
	get promise() { return this.result.p; }
	get started() { return new Promise<void>(() => { }); }
}

const rendered = (size: IPlotSize, uri: string): IRenderedPlot => ({ size, pixel_ratio: 1, uri, renderTimeMs: 0 });

describe('Copy Plot dialog', () => {
	const notifyError = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(INotificationService, { error: notifyError })
		.build();

	// The dialog renders through its own PositronModalReactRenderer; this only sets up the services.
	setupRTLRenderer(() => ctx.reactServices);

	const closeEmitter = new Emitter<void>();
	let renders: FakeRender[];

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton to find its container.
		PositronReactServices.services = ctx.reactServices;
		renders = [];
		notifyError.mockClear();
	});

	afterEach(() => {
		PositronModalReactRenderer.disposeAll();
	});

	function createClient(lastRenderSize: IPlotSize | undefined, intrinsicSize?: IntrinsicSize) {
		const renderOnce = vi.fn((_size: IPlotSize, _pixelRatio: number) => {
			const render = new FakeRender();
			renders.push(render);
			return render;
		});
		const client = stubInterface<PlotClientInstance>({
			metadata: { id: 'plot-1', created: 0, session_id: 'session-1', code: 'plot()', language: 'r', zoom_level: ZoomLevel.Fit },
			lastRender: lastRenderSize ? rendered(lastRenderSize, 'last') : undefined,
			intrinsicSize,
			renderOnce,
			onDidClose: closeEmitter.event,
		});
		return { client, renderOnce };
	}

	async function open(options: { lastRenderSize?: IPlotSize; intrinsicSize?: IntrinsicSize; keepRatio?: boolean; resolution?: number } = {}) {
		const { client, renderOnce } = createClient('lastRenderSize' in options ? options.lastRenderSize : { width: 700, height: 500 }, options.intrinsicSize);
		const onCopy = vi.fn(async (_uri: string) => { });
		const onKeepRatioChange = vi.fn();
		const onResolutionChange = vi.fn();
		showCopyPlotModalDialog({ plotClient: client, keepRatio: options.keepRatio ?? false, onKeepRatioChange, resolution: options.resolution, onResolutionChange, onCopy });
		// The modal renderer mounts the dialog asynchronously.
		expect(await screen.findByRole('button', { name: 'Copy' })).toBeInTheDocument();
		return { renderOnce, onCopy, onKeepRatioChange, onResolutionChange, user: userEvent.setup() };
	}

	const copyButton = () => screen.queryByRole('button', { name: 'Copy' });
	const widthInput = () => screen.getByRole('spinbutton', { name: 'Width' });
	const heightInput = () => screen.getByRole('spinbutton', { name: 'Height' });
	const resolutionButton = () => screen.getByRole('button', { name: 'Resolution' });

	async function pickResolution(user: UserEvent, entry: string) {
		await user.click(resolutionButton());
		await user.click(await screen.findByRole('button', { name: entry }));
	}

	it('opens at the last render size', async () => {
		await open();
		expect(widthInput()).toHaveValue(700);
		expect(heightInput()).toHaveValue(500);
	});

	it('opens at the intrinsic size without a last render', async () => {
		await open({ lastRenderSize: undefined, intrinsicSize: { width: 6, height: 4, unit: PlotUnit.Inches, source: 'Matplotlib' } });
		expect(widthInput()).toHaveValue(600);
		expect(heightInput()).toHaveValue(400);
	});

	it('opens at 640 x 480 without any known size', async () => {
		await open({ lastRenderSize: undefined });
		expect(widthInput()).toHaveValue(640);
		expect(heightInput()).toHaveValue(480);
	});

	it('does not draw on open when the last render is the opening size', async () => {
		const { renderOnce } = await open();
		expect(renderOnce).not.toHaveBeenCalled();
	});

	it('draws a preview on open when the opening size is not the last render size', async () => {
		const { renderOnce } = await open({ lastRenderSize: undefined });
		expect(renderOnce).toHaveBeenCalledWith({ width: 640, height: 480 }, 1);
	});

	it.each([
		['a last render below the minimum', { lastRenderSize: { width: 50, height: 400 } }],
		['a last render of zero', { lastRenderSize: { width: 0, height: 0 } }],
		['an intrinsic size above the maximum', { lastRenderSize: undefined, intrinsicSize: { width: 200, height: 4, unit: PlotUnit.Inches, source: 'Matplotlib' } }],
	])('opens at 640 x 480 for %s', async (_name, options) => {
		await open(options);
		expect(widthInput()).toHaveValue(640);
		expect(heightInput()).toHaveValue(480);
		expect(copyButton()).toBeEnabled();
	});

	describe('on a 2x screen', () => {
		const original = Object.getOwnPropertyDescriptor(mainWindow, 'devicePixelRatio')!;
		beforeEach(() => {
			Object.defineProperty(mainWindow, 'devicePixelRatio', { configurable: true, value: 2 });
		});
		afterEach(() => {
			Object.defineProperty(mainWindow, 'devicePixelRatio', original);
		});

		it('caps the size so the drawn copy stays within 10000 px', async () => {
			const { user } = await open();
			await user.clear(widthInput());
			await user.type(widthInput(), '5001');
			await user.keyboard('{Enter}');
			expect(widthInput()).toHaveAccessibleDescription('Enter at most 5000 px.');
			expect(copyButton()).toBeDisabled();
		});

		it('starts at 2x and copies at it', async () => {
			const { renderOnce, onResolutionChange, user } = await open();
			expect(resolutionButton()).toHaveTextContent('2x');
			await user.click(copyButton()!);
			expect(renderOnce).toHaveBeenCalledWith({ width: 700, height: 500 }, 2);
			expect(onResolutionChange).not.toHaveBeenCalled();
		});

		it('picking 1x copies at 1x, raises the cap, and reports the pick', async () => {
			const { renderOnce, onResolutionChange, user } = await open();
			await pickResolution(user, '1x');
			expect(onResolutionChange).toHaveBeenCalledWith(1);

			await user.clear(widthInput());
			await user.type(widthInput(), '5001');
			await user.keyboard('{Enter}');
			expect(widthInput()).not.toHaveAccessibleDescription();
			expect(renderOnce).toHaveBeenLastCalledWith({ width: 5001, height: 500 }, 1);
		});

		it('redraws for copy when the preview was drawn at another resolution', async () => {
			const { renderOnce, onCopy, user } = await open();
			await user.clear(widthInput());
			await user.type(widthInput(), '800{Enter}');
			await act(async () => renders[0].result.complete({ ...rendered({ width: 800, height: 500 }, 'preview-2x'), pixel_ratio: 2 }));

			await pickResolution(user, '1x');
			await user.click(copyButton()!);

			expect(renderOnce).toHaveBeenLastCalledWith({ width: 800, height: 500 }, 1);
			await act(async () => renders[1].result.complete(rendered({ width: 800, height: 500 }, 'copy-1x')));
			await vi.waitFor(() => expect(onCopy).toHaveBeenCalledWith('copy-1x'));
		});

		it('opens at 640 x 480 for a last render above the cap', async () => {
			await open({ lastRenderSize: { width: 6000, height: 4000 } });
			expect(widthInput()).toHaveValue(640);
			expect(heightInput()).toHaveValue(480);
		});
	});

	it('copy uses the preview when it matches', async () => {
		const { renderOnce, onCopy, user } = await open();
		await user.clear(widthInput());
		await user.type(widthInput(), '800');
		await vi.waitFor(() => expect(renderOnce).toHaveBeenCalledWith({ width: 800, height: 500 }, 1));
		await act(async () => renders[0].result.complete(rendered({ width: 800, height: 500 }, 'preview')));

		await user.click(copyButton()!);

		await vi.waitFor(() => expect(onCopy).toHaveBeenCalledWith('preview'));
		expect(renderOnce).toHaveBeenCalledOnce();
		expect(copyButton()).not.toBeInTheDocument();
	});

	it('copy reuses an in-flight preview of the same size', async () => {
		const { renderOnce, onCopy, user } = await open();
		await user.clear(widthInput());
		await user.type(widthInput(), '800');
		await vi.waitFor(() => expect(renderOnce).toHaveBeenCalledOnce());

		await user.click(copyButton()!);
		await act(async () => renders[0].result.complete(rendered({ width: 800, height: 500 }, 'in-flight')));

		await vi.waitFor(() => expect(onCopy).toHaveBeenCalledWith('in-flight'));
		expect(renderOnce).toHaveBeenCalledOnce();
	});

	it('copy right after typing copies the typed size', async () => {
		const { renderOnce, onCopy, user } = await open();
		await user.clear(widthInput());
		await user.type(widthInput(), '500');
		await user.clear(heightInput());
		await user.type(heightInput(), '400');

		// Clicking Copy does not take focus from the size box, so no blur commits the size.
		await user.click(copyButton()!);

		expect(renderOnce).toHaveBeenCalledOnce();
		expect(renderOnce).toHaveBeenCalledWith({ width: 500, height: 400 }, 1);
		await act(async () => renders[0].result.complete(rendered({ width: 500, height: 400 }, 'typed')));
		await vi.waitFor(() => expect(onCopy).toHaveBeenCalledWith('typed'));
	});

	it('copy draws at the chosen size when no preview matches', async () => {
		const { renderOnce, onCopy, user } = await open();

		await user.click(copyButton()!);
		expect(renderOnce).toHaveBeenCalledWith({ width: 700, height: 500 }, 1);
		await act(async () => renders[0].result.complete(rendered({ width: 700, height: 500 }, 'drawn')));

		await vi.waitFor(() => expect(onCopy).toHaveBeenCalledWith('drawn'));
		expect(copyButton()).not.toBeInTheDocument();
	});

	it('a failed draw shows an error and keeps the dialog open', async () => {
		const { onCopy, user } = await open();

		await user.click(copyButton()!);
		await act(async () => renders[0].result.error(new Error('kernel went away')));

		// The runtime's error (often a backtrace) stays out of the toast.
		await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith('Error copying plot: The plot could not be drawn at 700 x 500.'));
		expect(onCopy).not.toHaveBeenCalled();
		expect(copyButton()).toBeEnabled();
	});

	it('a failed copy of an in-flight preview does not draw that size again', async () => {
		const { renderOnce, user } = await open();
		await user.clear(widthInput());
		await user.type(widthInput(), '800');
		await vi.waitFor(() => expect(renderOnce).toHaveBeenCalledOnce());

		await user.click(copyButton()!);
		await act(async () => renders[0].result.error(new Error('too big')));

		await vi.waitFor(() => expect(notifyError).toHaveBeenCalled());
		expect(renderOnce).toHaveBeenCalledOnce();
	});

	it('a draw cancelled because the plot closed shows no error', async () => {
		const { onCopy, user } = await open();

		await user.click(copyButton()!);
		act(() => closeEmitter.fire());
		await act(async () => renders[0].result.error(new CancellationError()));

		await vi.waitFor(() => expect(copyButton()).toBeDisabled());
		expect(notifyError).not.toHaveBeenCalled();
		expect(onCopy).not.toHaveBeenCalled();
	});

	it('a draw cancelled while the plot stays open, e.g. the console exited, shows an error', async () => {
		const { onCopy, user } = await open();

		await user.click(copyButton()!);
		await act(async () => renders[0].result.error(new CancellationError()));

		await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith('Error copying plot: The plot was not drawn because the draw was cancelled.'));
		expect(onCopy).not.toHaveBeenCalled();
		expect(copyButton()).toBeEnabled();
	});

	it('copy is disabled for an invalid size', async () => {
		const { user } = await open();
		await user.clear(widthInput());
		await user.type(widthInput(), '50');
		expect(copyButton()).toBeDisabled();
	});

	it('copy is disabled when the plot is unavailable', async () => {
		await open();
		act(() => closeEmitter.fire());
		expect(copyButton()).toBeDisabled();
	});

	it('starts at the remembered resolution and caps the size by it', async () => {
		const { user } = await open({ resolution: 3 });
		expect(resolutionButton()).toHaveTextContent('3x');
		await user.clear(widthInput());
		await user.type(widthInput(), '3334{Enter}');
		expect(widthInput()).toHaveAccessibleDescription('Enter at most 3333 px.');
		expect(copyButton()).toBeDisabled();
	});

	it('the checkbox change calls onKeepRatioChange', async () => {
		const { onKeepRatioChange, user } = await open({ keepRatio: true });
		await user.click(screen.getByRole('checkbox', { name: 'Maintain aspect ratio' }));
		expect(onKeepRatioChange).toHaveBeenCalledWith(false);
	});

	it('Enter in a size box redraws and does not copy', async () => {
		const { renderOnce, onCopy, user } = await open();
		await user.clear(widthInput());
		await user.type(widthInput(), '800{Enter}');

		expect(renderOnce).toHaveBeenCalledWith({ width: 800, height: 500 }, 1);
		expect(onCopy).not.toHaveBeenCalled();
		expect(copyButton()).toBeInTheDocument();
	});

	it('Enter on the handle right after an arrow-key resize copies the new size', async () => {
		const { renderOnce, onCopy, user } = await open();
		screen.getByRole('button', { name: 'Resize plot' }).focus();
		await user.keyboard('{ArrowRight}{Enter}');

		await vi.waitFor(() => expect(renderOnce).toHaveBeenCalledWith({ width: 710, height: 500 }, 1));
		await act(async () => renders[0].result.complete(rendered({ width: 710, height: 500 }, 'resized')));

		await vi.waitFor(() => expect(onCopy).toHaveBeenCalledWith('resized'));
		expect(renderOnce).toHaveBeenCalledOnce();
	});

	it('Enter on Cancel closes without copying', async () => {
		const { renderOnce, onCopy, user } = await open();
		screen.getByRole('button', { name: 'Cancel' }).focus();
		await user.keyboard('{Enter}');

		await vi.waitFor(() => expect(copyButton()).not.toBeInTheDocument());
		expect(renderOnce).not.toHaveBeenCalled();
		expect(onCopy).not.toHaveBeenCalled();
	});

	it('Enter outside the size boxes copies', async () => {
		const { onCopy, user } = await open();
		copyButton()!.focus();
		await user.keyboard('{Enter}');
		await act(async () => renders[0].result.complete(rendered({ width: 700, height: 500 }, 'drawn')));

		await vi.waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
		expect(renders).toHaveLength(1);
	});
});
