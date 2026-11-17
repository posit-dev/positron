/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import Severity from '../../../../../base/common/severity.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { IPositronPlotsService, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyFill } from '../../../../services/positronPlots/common/sizingPolicyFill.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyCustom } from '../../../../services/positronPlots/common/sizingPolicyCustom.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { showWindowLogActionId } from '../../../../services/log/common/logConstants.js';
import { DynamicPlotInstance } from '../../browser/components/dynamicPlotInstance.js';

// The errors R returns when the pane is too small for the plot's margins (#8049).
const R_RENDER_ERROR = 'Failed to render plot with `id` plot-1 due to: Error evaluating \'.ps.graphics.render_plot_from_recording(...)\': invalid graphics state R backtrace: 0. tryCatchOne(expr, names, parentenv, handlers[[1L]])';
const R_MARGINS_ERROR = 'Failed to render plot with `id` plot-1 due to: Error in plot.new(): figure margins too large';
const R_FIGURE_REGION_ERROR = 'Failed to render plot with `id` plot-1 due to: Error in plot.new(): figure region too large';
const R_PLOT_REGION_ERROR = 'Failed to render plot with `id` plot-1 due to: Error in plot.new(): plot region too large';

const OTHER_RENDER_ERROR = 'Failed to render plot with `id` plot-1 due to: object \'x\' not found';

describe('DynamicPlotInstance', () => {
	const promptNotification = vi.fn();
	const executeCommand = vi.fn();
	const logWarn = vi.fn();
	const selectSizingPolicy = vi.fn();
	// Describe-level so each plot client stub shares the same event.
	const onDidChangeSizingPolicy = new Emitter<IPositronPlotSizingPolicy>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(INotificationService, { prompt: promptNotification })
		.stub(ICommandService, { executeCommand })
		.stub(ILogService, Object.assign(new NullLogService(), { warn: logWarn }))
		.stub(IPositronPlotsService, { selectSizingPolicy })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderWithSizingPolicy = vi.fn();
	const earlierRender: IRenderedPlot = { uri: 'data:image/png;base64,earlier', pixel_ratio: 1, renderTimeMs: 0 };

	function makeFailingPlotClient(lastRender?: IRenderedPlot, error = new Error(R_RENDER_ERROR), sizingPolicy: IPositronPlotSizingPolicy = new PlotSizingPolicyAuto()): PlotClientInstance {
		renderWithSizingPolicy.mockRejectedValue(error);
		return stubInterface<PlotClientInstance>({
			metadata: { id: 'plot-1', created: 0, code: '', session_id: 'session-1', name: 'My Plot' },
			lastRender,
			sizingPolicy,
			intrinsicSize: undefined,
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
		it.each([
			['invalid graphics state', R_RENDER_ERROR],
			['figure margins too large', R_MARGINS_ERROR],
			['figure region too large', R_FIGURE_REGION_ERROR],
			['plot region too large', R_PLOT_REGION_ERROR],
		])('suggests a larger plot area when R reports "%s"', async (_error, message) => {
			renderPlot(makeFailingPlotClient(undefined, new Error(message)));

			expect(await screen.findByText(/plot area is too small\. Try making it larger/)).toBeInTheDocument();
			expect(screen.queryByText(/R backtrace/)).not.toBeInTheDocument();
			expect(promptNotification).not.toHaveBeenCalled();
			expect(logWarn).toHaveBeenCalledWith(expect.stringContaining(message));
		});

		it('suggests a larger size, not a larger pane, when a custom size is too small', async () => {
			renderPlot(makeFailingPlotClient(undefined, undefined, new PlotSizingPolicyCustom({ width: 100, height: 100 })));

			expect(await screen.findByText(/at the '100.100 \(custom\)' size because it's too small\. Choose a larger size/)).toBeInTheDocument();
			expect(screen.queryByText(/Try making it larger/)).not.toBeInTheDocument();
		});

		it('shows a general message with a way to the logs for other errors', async () => {
			const user = userEvent.setup();
			renderPlot(makeFailingPlotClient(undefined, new Error(OTHER_RENDER_ERROR)));

			expect(await screen.findByText(/^Couldn't render this plot\.$/)).toBeInTheDocument();
			expect(screen.queryByText(/too small/)).not.toBeInTheDocument();

			await user.click(screen.getByRole('button', { name: 'Show Logs' }));
			expect(executeCommand).toHaveBeenCalledWith(showWindowLogActionId);
		});

		it('keeps showing the earlier image', async () => {
			renderPlot(makeFailingPlotClient(earlierRender));

			await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
			expect(screen.getByRole('img', { name: 'My Plot' })).toHaveAttribute('src', earlierRender.uri);
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
			expect(promptNotification).not.toHaveBeenCalled();
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

		it('ignores a failure from a render at an earlier size', async () => {
			let rejectEarlier!: (e: Error) => void;
			const earlier = new Promise((_resolve, reject) => { rejectEarlier = reject; });
			const plotClient = makeFailingPlotClient();
			renderWithSizingPolicy.mockReturnValue(earlier);
			const { rerender } = renderPlot(plotClient);
			await vi.waitFor(() => expect(renderWithSizingPolicy).toHaveBeenCalled());

			renderWithSizingPolicy.mockReturnValue(new Promise(() => { }));
			rerender(plotAt(plotClient, 700));
			rejectEarlier(new Error(R_RENDER_ERROR));
			// The component's catch was chained first, so it has run once this settles.
			await expect(earlier).rejects.toThrow();

			expect(screen.getByText('Rendering plot')).toBeInTheDocument();
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
			expect(logWarn).not.toHaveBeenCalled();
		});

		it.each([
			['a too-small error', R_RENDER_ERROR, true],
			['another error', OTHER_RENDER_ERROR, false],
		])('shows a popup for %s when the user picks a size that fails, since the earlier image hides it', async (_label, message, tooSmall) => {
			renderPlot(makeFailingPlotClient(earlierRender, new Error(message)));
			await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
			expect(promptNotification).not.toHaveBeenCalled();

			act(() => onDidChangeSizingPolicy.fire(new PlotSizingPolicyFill()));

			await vi.waitFor(() => expect(promptNotification).toHaveBeenCalledWith(
				Severity.Warning,
				expect.stringContaining('Fill'),
				[expect.objectContaining({ label: 'Show Logs' })],
			));
			const [, popupMessage, [showLogs]] = promptNotification.mock.calls[0];
			expect(popupMessage.includes('too small')).toBe(tooSmall);
			expect(screen.getByRole('img', { name: 'My Plot' })).toHaveAttribute('src', earlierRender.uri);

			showLogs.run();
			expect(executeCommand).toHaveBeenCalledWith(showWindowLogActionId);
		});

		it('shows only the pane message when the user picks a size that fails before the plot has drawn', async () => {
			renderPlot(makeFailingPlotClient());
			expect(await screen.findByText(/plot area is too small/)).toBeInTheDocument();

			act(() => onDidChangeSizingPolicy.fire(new PlotSizingPolicyFill()));

			await vi.waitFor(() => expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('Fill')));
			expect(promptNotification).not.toHaveBeenCalled();
			expect(screen.getByText(/plot area is too small/)).toBeInTheDocument();
		});

		it.each([
			['it starts on', false],
			['the user picks', true],
		])('passes the pane size to the plot when %s intrinsic, without changing any plot\'s setting', async (_label, picked) => {
			const intrinsic = new PlotSizingPolicyIntrinsic();
			const plotClient = makeFailingPlotClient(earlierRender, undefined, picked ? undefined : intrinsic);
			renderWithSizingPolicy.mockResolvedValue({ uri: 'data:image/png;base64,auto', pixel_ratio: 1, renderTimeMs: 0 });
			renderPlot(plotClient);
			if (picked) {
				act(() => onDidChangeSizingPolicy.fire(intrinsic));
			}

			expect(await screen.findByRole('img', { name: 'My Plot' })).toHaveAttribute('src', 'data:image/png;base64,auto');
			// The plot client falls back to Auto with this size when the plot has no intrinsic size.
			expect(renderWithSizingPolicy).toHaveBeenLastCalledWith({ width: 525, height: 325 }, expect.any(Number));
			expect(selectSizingPolicy).not.toHaveBeenCalled();
			expect(promptNotification).not.toHaveBeenCalled();
		});

		it('stays quiet when a resize cancels the render', async () => {
			renderPlot(makeFailingPlotClient(undefined, new CancellationError()));

			await vi.waitFor(() => expect(renderWithSizingPolicy).toHaveBeenCalled());
			// The component's catch was chained first, so it has run once this settles.
			await expect(renderWithSizingPolicy.mock.results[0].value).rejects.toThrow('Canceled');
			expect(screen.getByText('Rendering plot')).toBeInTheDocument();
			expect(screen.queryByText(/Couldn't render/)).not.toBeInTheDocument();
			expect(logWarn).not.toHaveBeenCalled();
		});
	});
});
