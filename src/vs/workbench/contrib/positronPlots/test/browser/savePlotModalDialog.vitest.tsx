/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent, UserEvent } from '@testing-library/user-event';
import { Mock } from 'vitest';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IntrinsicSize, PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { PlotRenderFormat, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { IPlotSize, IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyCustom } from '../../../../services/positronPlots/common/sizingPolicyCustom.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { showSavePlotModalDialog } from '../../browser/modalDialogs/savePlotModalDialog.js';

/**
 * A fake plot client. Its `renderWithSizingPolicy` behaves like the real
 * client's: it passes the requested size through the plot's sizing policy
 * before rendering. `render` records the size the kernel would be asked for.
 */
function createFakePlotClient(policy: IPositronPlotSizingPolicy, intrinsicSize?: IntrinsicSize, withLastRender = true) {
	const render: Mock<(size: IPlotSize | undefined, pixelRatio: number, format?: PlotRenderFormat, preview?: boolean) => Promise<IRenderedPlot>> =
		vi.fn().mockResolvedValue({ uri: 'data:image/svg+xml;base64,AA==', pixel_ratio: 1 });
	const client = stubInterface<PlotClientInstance>({
		metadata: {
			id: 'plot-1',
			created: 0,
			session_id: 'session-1',
			code: 'plot()',
			language: 'r',
			name: 'plot',
			zoom_level: ZoomLevel.Fit,
		},
		intrinsicSize,
		lastRender: withLastRender
			? { size: { width: 700, height: 500 }, pixel_ratio: 2, uri: 'data:image/png;base64,AA==', renderTimeMs: 0 }
			: undefined,
		sizingPolicy: policy,
		render,
		renderWithSizingPolicy: (size: IPlotSize | undefined, pixelRatio: number, format?: PlotRenderFormat, preview?: boolean) =>
			render(size ? policy.getPlotSize(size) : size, pixelRatio, format, preview),
	});
	return { client, render };
}

const LOCK_NAME = 'Maintain aspect ratio';

/** Turns the aspect ratio lock off if it is on, so width and height can be typed independently. */
async function unlockAspectRatio(user: UserEvent) {
	const lock = screen.queryByRole('checkbox', { name: LOCK_NAME, checked: true });
	if (lock) {
		await user.click(lock);
	}
}

async function typeSize(user: UserEvent, width: number, height: number) {
	await unlockAspectRatio(user);
	const widthInput = screen.getByRole('spinbutton', { name: 'Width' });
	const heightInput = screen.getByRole('spinbutton', { name: 'Height' });
	await user.clear(widthInput);
	await user.type(widthInput, String(width));
	await user.clear(heightInput);
	await user.type(heightInput, String(height));
}

describe('Save Plot dialog size', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IFileService, { exists: vi.fn().mockResolvedValue(false) })
		.build();

	// The dialog renders itself through its own PositronModalReactRenderer rather than being
	// handed to rtl.render, so this only establishes the services context it renders into.
	setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// PositronModalReactRenderer reads the services singleton in its constructor to find the
		// container to render into, so the container's services have to be reachable from there.
		PositronReactServices.services = ctx.reactServices;
	});

	const intrinsicSize: IntrinsicSize = { width: 6.3, height: 4.7, unit: PlotUnit.Inches, source: 'Matplotlib' };

	async function save(user: UserEvent, savePlotCallback: Mock) {
		await user.click(screen.getByRole('button', { name: 'Save' }));
		await vi.waitFor(() => expect(savePlotCallback).toHaveBeenCalled());
	}

	async function open(policy: IPositronPlotSizingPolicy, plotIntrinsicSize?: IntrinsicSize, withLastRender = true) {
		const { client, render } = createFakePlotClient(policy, plotIntrinsicSize, withLastRender);
		const savePlotCallback = vi.fn();
		showSavePlotModalDialog(policy, client, savePlotCallback, URI.file('/tmp'), PlotRenderFormat.Svg);
		// The modal renderer mounts the dialog asynchronously.
		expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
		return { render, savePlotCallback };
	}

	it('honors the typed size under the Auto policy', async () => {
		const user = userEvent.setup();
		const { render, savePlotCallback } = await open(new PlotSizingPolicyAuto());

		await typeSize(user, 3270, 1772);
		await save(user, savePlotCallback);

		expect(render).toHaveBeenCalledWith({ width: 3270, height: 1772 }, 1, PlotRenderFormat.Svg, true);
	});

	it('honors the typed size under a Custom policy', async () => {
		const user = userEvent.setup();
		const { render, savePlotCallback } = await open(new PlotSizingPolicyCustom({ width: 500, height: 500 }));

		await typeSize(user, 800, 600);
		await save(user, savePlotCallback);

		expect(render).toHaveBeenCalledWith({ width: 800, height: 600 }, 1, PlotRenderFormat.Svg, true);
	});

	it('honors the typed size under the Intrinsic policy when Use intrinsic size is unticked', async () => {
		const user = userEvent.setup();
		const { render, savePlotCallback } = await open(new PlotSizingPolicyIntrinsic(), intrinsicSize);

		await user.click(screen.getByRole('checkbox', { name: 'Use intrinsic size' }));
		await typeSize(user, 600, 400);
		await save(user, savePlotCallback);

		expect(render).toHaveBeenCalledWith({ width: 600, height: 400 }, 1, PlotRenderFormat.Svg, true);
	});

	it('renders at the intrinsic size when Use intrinsic size is ticked', async () => {
		const user = userEvent.setup();
		const { render, savePlotCallback } = await open(new PlotSizingPolicyIntrinsic(), intrinsicSize);

		await save(user, savePlotCallback);

		expect(render).toHaveBeenCalledWith(undefined, 1, PlotRenderFormat.Svg, true);
	});

	it('previews at the typed size', async () => {
		const user = userEvent.setup();
		const { render } = await open(new PlotSizingPolicyAuto());

		await typeSize(user, 3270, 1772);
		await user.click(screen.getByRole('button', { name: 'Preview' }));

		await vi.waitFor(() => expect(render).toHaveBeenCalledWith({ width: 3270, height: 1772 }, 1, PlotRenderFormat.Png, true));

		// Preview leaves the dialog open; close it so its renderer is disposed.
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
	});

	describe('aspect ratio lock', () => {
		// The fake plot is 700 x 500, an aspect ratio of 1.4.
		const widthInput = () => screen.getByRole('spinbutton', { name: 'Width' });
		const heightInput = () => screen.getByRole('spinbutton', { name: 'Height' });

		async function typeInto(user: UserEvent, input: HTMLElement, value: number) {
			await user.clear(input);
			await user.type(input, String(value));
		}

		async function close(user: UserEvent) {
			await user.click(screen.getByRole('button', { name: 'Cancel' }));
		}

		it('is on by default and derives Height from a typed Width', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto());

			await typeInto(user, widthInput(), 1400);

			expect(screen.getByRole('checkbox', { name: LOCK_NAME, checked: true })).toBeInTheDocument();
			expect(heightInput()).toHaveValue(1000);
			await close(user);
		});

		it('derives Width from a typed Height', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto());

			await typeInto(user, heightInput(), 250);

			expect(widthInput()).toHaveValue(350);
			await close(user);
		});

		it('saves at the derived size while on', async () => {
			const user = userEvent.setup();
			const { render, savePlotCallback } = await open(new PlotSizingPolicyAuto());

			await typeInto(user, widthInput(), 1400);
			await save(user, savePlotCallback);

			expect(render).toHaveBeenCalledWith({ width: 1400, height: 1000 }, 1, PlotRenderFormat.Svg, true);
		});

		it('keeps the fields independent when turned off', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto());

			await unlockAspectRatio(user);
			await typeInto(user, widthInput(), 1400);

			expect(heightInput()).toHaveValue(500);
			await close(user);
		});

		it('leaves the other field alone while one is cleared', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto());

			await user.clear(widthInput());

			expect(heightInput()).toHaveValue(500);
			await close(user);
		});

		it('captures a new ratio from the current size when turned back on', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto());

			await typeSize(user, 800, 400);
			await user.click(screen.getByRole('checkbox', { name: LOCK_NAME, checked: false }));
			await typeInto(user, widthInput(), 1200);

			expect(heightInput()).toHaveValue(600);
			await close(user);
		});

		it('cannot be turned on while a size field is empty', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto());

			await unlockAspectRatio(user);
			await user.clear(widthInput());

			expect(screen.getByRole('checkbox', { name: LOCK_NAME, checked: false })).toBeDisabled();
			await close(user);
		});

		it('is disabled while Use intrinsic size is ticked', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyIntrinsic(), intrinsicSize);

			expect(screen.getByRole('checkbox', { name: LOCK_NAME })).toBeDisabled();
			await close(user);
		});

		it('is enabled again, still on, when Use intrinsic size is unticked', async () => {
			const user = userEvent.setup();
			// Under the Intrinsic policy the last render has no size, so the lock comes from the intrinsic size.
			await open(new PlotSizingPolicyIntrinsic(), intrinsicSize, false);

			await user.click(screen.getByRole('checkbox', { name: 'Use intrinsic size' }));

			expect(screen.getByRole('checkbox', { name: LOCK_NAME, checked: true })).toBeEnabled();
			await close(user);
		});

		it('takes the size from the intrinsic size when the plot has no last render', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyIntrinsic(), intrinsicSize, false);

			await user.click(screen.getByRole('checkbox', { name: 'Use intrinsic size' }));
			await typeInto(user, widthInput(), 1260);

			// 6.3in x 4.7in at 100 DPI.
			expect(widthInput()).toHaveValue(1260);
			expect(heightInput()).toHaveValue(940);
			await close(user);
		});

		it('starts off when the plot has no known size', async () => {
			const user = userEvent.setup();
			await open(new PlotSizingPolicyAuto(), undefined, false);

			expect(screen.getByRole('checkbox', { name: LOCK_NAME, checked: false })).toBeInTheDocument();
			await close(user);
		});
	});
});
