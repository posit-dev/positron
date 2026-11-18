/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PLOT_LOCATOR_BANNER_HEIGHT } from '../../browser/components/plotLocatorBanner.js';
import { DynamicPlotInstance } from '../../browser/components/dynamicPlotInstance.js';
import { IPositronPlotMetadata, PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { IPositronPlotsService, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { IPlotSize, IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { TestPositronPlotsService } from '../../../../services/positronPlots/test/common/testPositronPlotsService.js';

const WIDTH = 400;
const HEIGHT = 200;
const SESSION_ID = 'session-1';
const PLOT_ID = 'plot-1';
const IMAGE_URI = 'data:image/png;base64,abc';

describe('Plot locator mode', () => {
	const plotsService = new TestPositronPlotsService();
	const renderEmitter = new Emitter<IRenderedPlot>();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPlotsService, plotsService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		plotsService.activeLocator = undefined;
		plotsService.resolvedLocatorPoints.length = 0;
	});

	afterAll(() => {
		renderEmitter.dispose();
		plotsService.dispose();
	});

	function makePlotClient(uri = IMAGE_URI): PlotClientInstance {
		return stubInterface<PlotClientInstance>({
			id: PLOT_ID,
			metadata: stubInterface<IPositronPlotMetadata>({ id: PLOT_ID, session_id: SESSION_ID, name: 'My plot' }),
			lastRender: stubInterface<IRenderedPlot>({ uri, size: { width: WIDTH, height: HEIGHT } }),
			sizingPolicy: stubInterface<IPositronPlotSizingPolicy>({ getPlotSize: () => ({ width: WIDTH, height: HEIGHT }) }),
			onDidCompleteRender: renderEmitter.event,
			onDidChangeSizingPolicy: Event.None,
			onDidChangeState: Event.None,
			getIntrinsicSize: () => Promise.resolve(undefined),
			renderWithSizingPolicy: () => new Promise(() => { }),
		});
	}

	/**
	 * Renders the plot instance inside a focusable parent, as .plots-container is.
	 */
	function renderPlot(zoom: ZoomLevel = ZoomLevel.Fit, uri = IMAGE_URI, showLocatorBanner?: boolean) {
		rtl.render(
			<div className='plots-container' tabIndex={0}>
				<DynamicPlotInstance height={HEIGHT} plotClient={makePlotClient(uri)} showLocatorBanner={showLocatorBanner} width={WIDTH} zoom={zoom} />
			</div>
		);
		return screen.getByRole('img', { name: 'My plot' });
	}

	function startLocator(plotId = PLOT_ID, size: IPlotSize = { width: WIDTH, height: HEIGHT }) {
		act(() => plotsService.setActiveLocator({ sessionId: SESSION_ID, plotId, size }));
	}

	/**
	 * Gives the image a layout box and natural size, as a browser would.
	 */
	function sizeImage(img: HTMLElement, naturalWidth: number, naturalHeight: number) {
		img.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
		Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
		Object.defineProperty(img, 'naturalHeight', { value: naturalHeight, configurable: true });
	}

	/**
	 * Gives the image a natural size and finishes loading it, as a browser would.
	 */
	function loadImage(img: HTMLElement, naturalWidth: number, naturalHeight: number) {
		sizeImage(img, naturalWidth, naturalHeight);
		fireEvent.load(img);
	}

	/**
	 * Returns the plot instance wrapper, the closest ancestor of the image that is a plot-instance.
	 */
	function wrapperOf(img: HTMLElement): HTMLElement {
		const wrapper = img.closest<HTMLElement>('.plot-instance');
		if (!wrapper) {
			throw new Error('Plot instance wrapper not found');
		}
		return wrapper;
	}

	it('shows no banner when no locator is active', () => {
		renderPlot();
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('shows the banner when a locator starts for this plot', () => {
		renderPlot();
		startLocator();
		expect(screen.getByRole('status')).toHaveTextContent('Click the plot to choose a point.');
	});

	it('shows no banner when a locator starts for another plot', () => {
		renderPlot();
		startLocator('other-plot');
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('removes the banner when the locator is cleared', () => {
		renderPlot();
		startLocator();
		act(() => plotsService.setActiveLocator(undefined));
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('resolves the locator with undefined when Finish is clicked', async () => {
		const user = userEvent.setup();
		renderPlot();
		startLocator();
		await user.click(screen.getByRole('button', { name: 'Finish' }));
		expect(plotsService.resolvedLocatorPoints).toEqual([undefined]);
	});

	it('finishes on Escape after a click on the plot, even with a focusable ancestor', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 200, 200);
		startLocator();

		// A click in the letterbox area sends no point but still moves focus.
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 10, clientY: 100 } });
		expect(wrapperOf(img)).toHaveFocus();

		// The key goes to whatever has focus, as in the real pane.
		await user.keyboard('{Escape}');
		expect(plotsService.resolvedLocatorPoints).toEqual([undefined]);
	});

	it('keeps Escape working for the next request after a click on a point', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 400, 200);
		startLocator();
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([{ x: 0.25, y: 0.25 }]);

		// The service ends the mode after the click. The focus goes back to the Plots pane,
		// not to the document body.
		act(() => plotsService.setActiveLocator(undefined));
		const container = img.closest<HTMLElement>('.plots-container');
		expect(container).toHaveFocus();

		// The next request (the next point of locator()) takes the focus back.
		startLocator();
		expect(wrapperOf(img)).toHaveFocus();

		// The key goes to whatever has focus, as in the real pane.
		act(() => {
			document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		expect(plotsService.resolvedLocatorPoints).toEqual([{ x: 0.25, y: 0.25 }, undefined]);
	});

	it('hands the focus to a focusable ancestor outside the Plots pane, as in an editor tab', async () => {
		const user = userEvent.setup();
		rtl.render(
			<div data-testid='editor-container' tabIndex={-1}>
				<DynamicPlotInstance height={HEIGHT} plotClient={makePlotClient()} width={WIDTH} zoom={ZoomLevel.Fit} />
			</div>
		);
		const img = screen.getByRole('img', { name: 'My plot' });
		loadImage(img, 400, 200);
		startLocator();
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(wrapperOf(img)).toHaveFocus();

		act(() => plotsService.setActiveLocator(undefined));
		expect(screen.getByTestId('editor-container')).toHaveFocus();

		// The next request (the next point of identify()) takes the focus back.
		startLocator();
		expect(wrapperOf(img)).toHaveFocus();
	});

	it('has no tab index and does not take focus on mouse down outside locator mode', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		await user.pointer({ keys: '[MouseLeft>]', target: img });
		expect(wrapperOf(img)).not.toHaveAttribute('tabindex');
		expect(wrapperOf(img)).not.toHaveFocus();
	});

	it('reserves space for the banner so the whole plot stays visible', () => {
		const img = renderPlot();
		// The image's parent is the Scrollable element, sized to the image area.
		expect(img.parentElement).toHaveStyle({ height: `${HEIGHT}px` });

		startLocator();
		expect(img.parentElement).toHaveStyle({ height: `${HEIGHT - PLOT_LOCATOR_BANNER_HEIGHT}px` });

		act(() => plotsService.setActiveLocator(undefined));
		expect(img.parentElement).toHaveStyle({ height: `${HEIGHT}px` });
	});

	it('shows no banner and keeps the full height when the banner is turned off', async () => {
		const user = userEvent.setup();
		const img = renderPlot(ZoomLevel.Fit, IMAGE_URI, false);
		loadImage(img, 400, 200);
		startLocator();

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(img.parentElement).toHaveStyle({ height: `${HEIGHT}px` });

		// Clicks still choose a point.
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([{ x: 0.25, y: 0.25 }]);
	});

	it('resolves the locator with the clicked point', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 400, 200);
		startLocator();
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([{ x: 0.25, y: 0.25 }]);
	});

	it('reads the natural size at click time', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 400, 200);
		startLocator();
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toHaveLength(1);

		// The element now reports a different natural size.
		sizeImage(img, 200, 200);
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 10, clientY: 100 } });
		expect(plotsService.resolvedLocatorPoints).toHaveLength(1);
	});

	it('ignores a click in the letterbox at Fit zoom and stays in locator mode', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 200, 200);
		startLocator();
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 10, clientY: 100 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([]);
		expect(screen.getByRole('status')).toBeInTheDocument();
	});

	it('takes clicks only on the image of the requested size', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 400, 200);
		startLocator(PLOT_ID, { width: 300, height: 150 });

		// The image shown is from an earlier render at another size.
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([]);
		expect(img).not.toHaveStyle({ cursor: 'crosshair' });

		// The image the kernel sent for the request arrives and loads.
		const uri = 'data:image/png;base64,def';
		act(() => renderEmitter.fire(stubInterface<IRenderedPlot>({ uri, size: { width: 300, height: 150 } })));
		expect(img).toHaveAttribute('src', uri);
		loadImage(img, 400, 200);
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([{ x: 0.25, y: 0.25 }]);
	});

	it('takes no clicks until the image has loaded', async () => {
		const user = userEvent.setup();
		// The test DOM loads data URIs at once but never loads other URLs.
		const img = renderPlot(ZoomLevel.Fit, 'https://example.com/plot.png');
		sizeImage(img, 400, 200);
		startLocator();
		expect(img).not.toHaveStyle({ cursor: 'crosshair' });

		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([]);

		fireEvent.load(img);
		expect(img).toHaveStyle({ cursor: 'crosshair' });
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([{ x: 0.25, y: 0.25 }]);
	});

	it('ignores clicks on the image when no locator is active', async () => {
		const user = userEvent.setup();
		const img = renderPlot();
		loadImage(img, 400, 200);
		await user.pointer({ keys: '[MouseLeft]', target: img, coords: { clientX: 100, clientY: 50 } });
		expect(plotsService.resolvedLocatorPoints).toEqual([]);
	});
});
