/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyFill } from '../../../../services/positronPlots/common/sizingPolicyFill.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { DynamicPlotInstance } from '../../browser/components/dynamicPlotInstance.js';

// The error R returns when the pane is too small for the plot's margins (#8049).
const R_RENDER_ERROR = 'Failed to render plot with `id` plot-1 due to: Error evaluating \'.ps.graphics.render_plot_from_recording(...)\': invalid graphics state R backtrace: 0. tryCatchOne(expr, names, parentenv, handlers[[1L]])';

describe('DynamicPlotInstance', () => {
	const warnNotification = vi.fn();
	const logWarn = vi.fn();
	// Describe-level so each plot client stub shares the same event.
	const onDidChangeSizingPolicy = new Emitter<IPositronPlotSizingPolicy>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(INotificationService, { warn: warnNotification })
		.stub(ILogService, Object.assign(new NullLogService(), { warn: logWarn }))
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderWithSizingPolicy = vi.fn();
	const earlierRender: IRenderedPlot = { uri: 'data:image/png;base64,earlier', pixel_ratio: 1, renderTimeMs: 0 };

	function makeFailingPlotClient(lastRender?: IRenderedPlot, error = new Error(R_RENDER_ERROR)): PlotClientInstance {
		renderWithSizingPolicy.mockRejectedValue(error);
		return stubInterface<PlotClientInstance>({
			metadata: { id: 'plot-1', created: 0, code: '', session_id: 'session-1', name: 'My Plot' },
			lastRender,
			sizingPolicy: new PlotSizingPolicyAuto(),
			getIntrinsicSize: () => Promise.resolve(undefined),
			renderWithSizingPolicy,
			onDidCompleteRender: Event.None,
			onDidChangeSizingPolicy: onDidChangeSizingPolicy.event,
			onDidChangeState: Event.None,
		});
	}

	function plotAt(plotClient: PlotClientInstance, height = 325) {
		return <DynamicPlotInstance height={height} plotClient={plotClient} width={525} zoom={ZoomLevel.Fit} />;
	}

	function renderPlot(plotClient: PlotClientInstance) {
		return rtl.render(plotAt(plotClient));
	}

	describe('when a render fails', () => {
		it('shows a short message instead of the R backtrace when there is no earlier image', async () => {
			renderPlot(makeFailingPlotClient());

			expect(await screen.findByText(/Couldn't render this plot\. Try making the plot area larger/)).toBeInTheDocument();
			expect(screen.queryByText(/R backtrace/)).not.toBeInTheDocument();
			expect(warnNotification).not.toHaveBeenCalled();
			expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('invalid graphics state'));
		});

		it('keeps showing the earlier image', async () => {
			renderPlot(makeFailingPlotClient(earlierRender));

			await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
			expect(screen.getByRole('img', { name: 'My Plot' })).toHaveAttribute('src', earlierRender.uri);
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
			expect(warnNotification).not.toHaveBeenCalled();
		});

		it('shows the plot once a later render at a bigger size succeeds', async () => {
			const plotClient = makeFailingPlotClient();
			const { rerender } = renderPlot(plotClient);
			expect(await screen.findByText(/Couldn't render/)).toBeInTheDocument();

			renderWithSizingPolicy.mockResolvedValue({ uri: 'data:image/png;base64,bigger', pixel_ratio: 1, renderTimeMs: 0 });
			rerender(plotAt(plotClient, 700));

			expect(await screen.findByRole('img', { name: 'My Plot' })).toHaveAttribute('src', 'data:image/png;base64,bigger');
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
		});

		it('drops the old message while a render at a new size is in progress', async () => {
			const plotClient = makeFailingPlotClient();
			const { rerender } = renderPlot(plotClient);
			expect(await screen.findByText(/Couldn't render/)).toBeInTheDocument();

			renderWithSizingPolicy.mockReturnValue(new Promise(() => { }));
			rerender(plotAt(plotClient, 700));

			expect(await screen.findByText('Rendering plot')).toBeInTheDocument();
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
		});

		it('shows a popup when the user picks a size that fails, since the earlier image hides it', async () => {
			renderPlot(makeFailingPlotClient(earlierRender));
			await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
			expect(warnNotification).not.toHaveBeenCalled();

			act(() => onDidChangeSizingPolicy.fire(new PlotSizingPolicyFill()));

			await vi.waitFor(() => expect(warnNotification).toHaveBeenCalledWith(expect.stringContaining('Fill')));
			expect(screen.getByRole('img', { name: 'My Plot' })).toHaveAttribute('src', earlierRender.uri);
		});

		it('stays quiet when a resize cancels the render', async () => {
			renderPlot(makeFailingPlotClient(undefined, new Error('Canceled')));

			await vi.waitFor(() => expect(renderWithSizingPolicy).toHaveBeenCalled());
			// The component's catch was chained first, so it has run once this settles.
			await expect(renderWithSizingPolicy.mock.results[0].value).rejects.toThrow('Canceled');
			expect(screen.getByText('Rendering plot')).toBeInTheDocument();
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
			expect(logWarn).not.toHaveBeenCalled();
		});
	});
});
