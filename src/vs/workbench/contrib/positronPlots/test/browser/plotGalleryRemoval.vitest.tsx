/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubGridLayoutWithSize } from '../../../../../test/vitest/stubGridLayout.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronPlots } from '../../browser/positronPlots.js';
import { PlotsNextAction, PlotsPreviousAction } from '../../browser/positronPlotsActions.js';
import { INotebookOutputWebview } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { PositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewServiceImpl.js';
import { RuntimeOutputKind } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';

describe('Plot gallery removal', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	let restoreLayout: () => void;
	beforeEach(() => {
		restoreLayout = stubGridLayoutWithSize(800, 600);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() =>
			stubInterface<CanvasRenderingContext2D & GPUCanvasContext>({
				font: '',
				measureText: () => stubInterface<TextMetrics>({ width: 30 }),
			}));
		// Webview plots never finish creating their webview; these tests check
		// the toolbar, not the rendered plot. A .stub() can't do this because
		// the preset builds the plots service before user stubs apply.
		vi.spyOn(PositronNotebookOutputWebviewService.prototype, 'createNotebookOutputWebview')
			.mockReturnValue(new DeferredPromise<INotebookOutputWebview>().p);
	});
	afterEach(() => { restoreLayout(); vi.unstubAllGlobals(); });

	// A large container so the "Automatic" history policy keeps the gallery visible.
	const reactComponentContainer: IReactComponentContainer = {
		width: 800,
		height: 600,
		containerVisible: true,
		takeFocus: () => { },
		onFocused: Event.None,
		onSizeChanged: Event.None,
		onPositionChanged: Event.None,
		onVisibilityChanged: Event.None,
		onSaveScrollPosition: Event.None,
		onRestoreScrollPosition: Event.None,
	};

	it('removing one plot from the gallery leaves the other plots in the gallery', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot3');
		expect(plotsService.positronPlotInstances.length).toBe(3);

		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		// The gallery shows one "Remove plot" button per plot thumbnail.
		expect(screen.getAllByRole('button', { name: 'Remove plot' })).toHaveLength(3);

		// Remove a single (non-selected) plot, as the user would by clicking the
		// Remove button on its thumbnail.
		act(() => {
			plotsService.removePlot('plot1');
		});

		// Only the removed plot should be gone; the service should still hold
		// the other two plots.
		expect(plotsService.positronPlotInstances.map(p => p.id)).toEqual(['plot2', 'plot3']);

		// The two remaining plots should still be shown in the gallery.
		expect(screen.getAllByRole('button', { name: 'Remove plot' })).toHaveLength(2);
	});

	it('keeps dynamic plot controls and disables both arrows after removing an earlier plot', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'earlier');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'selected');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		act(() => plotsService.removePlot('earlier'));

		expect(plotsService.selectedPlotId).toBe('selected');
		expect(screen.getByRole('button', { name: 'Save Plot' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Copy Plot to Clipboard' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show Previous Plot' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Show Next Plot' })).toBeDisabled();
	});

	it('describes a webview plot added after a removal, and navigates in creation order', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const user = userEvent.setup();
		ctx.disposables.add(registerAction2(PlotsNextAction));
		ctx.disposables.add(registerAction2(PlotsPreviousAction));
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'earlier');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'remaining');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);
		act(() => plotsService.removePlot('earlier'));

		// What the toolbar shows. A webview plot has no Save or Copy buttons and
		// a dynamic plot has both, so this tells the two plots apart.
		const toolbar = () => ({
			selected: plotsService.selectedPlotId,
			save: screen.queryByRole('button', { name: 'Save Plot' }) !== null,
			copy: screen.queryByRole('button', { name: 'Copy Plot to Clipboard' }) !== null,
			previousEnabled: !screen.getByRole('button', { name: 'Show Previous Plot' }).hasAttribute('disabled'),
			nextEnabled: !screen.getByRole('button', { name: 'Show Next Plot' }).hasAttribute('disabled'),
		});

		// A webview plot, like the Plotly plot in issue 17245, goes after the
		// remaining plot.
		act(() => session.receiveOutputMessage({ id: 'widget', kind: RuntimeOutputKind.PlotWidget, data: { 'text/html': '<div></div>' } }));
		expect(toolbar()).toEqual({ selected: 'widget', save: false, copy: false, previousEnabled: true, nextEnabled: false });

		await user.click(screen.getByRole('button', { name: 'Show Previous Plot' }));
		expect(toolbar()).toEqual({ selected: 'remaining', save: true, copy: true, previousEnabled: false, nextEnabled: true });

		await user.click(screen.getByRole('button', { name: 'Show Next Plot' }));
		expect(toolbar()).toEqual({ selected: 'widget', save: false, copy: false, previousEnabled: true, nextEnabled: false });
	});

	it('shows controls for the surviving plot when the selected plot is removed', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'first');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'selected');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		act(() => plotsService.removePlot('selected'));

		expect(plotsService.selectedPlotId).toBe('first');
		expect(screen.getByRole('button', { name: 'Save Plot' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show Previous Plot' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Show Next Plot' })).toBeDisabled();
	});

	it('hides controls after clearing and restores them for the next plot', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'first');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		act(() => plotsService.removeAllPlots());
		expect(screen.queryByRole('button', { name: 'Save Plot' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show Previous Plot' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Show Next Plot' })).toBeDisabled();

		act(() => { session.createClient(RuntimeClientType.Plot, {}, {}, 'new'); });
		expect(plotsService.selectedPlotId).toBe('new');
		expect(screen.getByRole('button', { name: 'Save Plot' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show Previous Plot' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Show Next Plot' })).toBeDisabled();
	});

	it('does not attribute toolbar controls to a removed last plot', async () => {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'only');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);

		act(() => plotsService.removePlot('only'));

		expect(screen.queryByRole('button', { name: 'Save Plot' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show Previous Plot' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Show Next Plot' })).toBeDisabled();
	});
});
