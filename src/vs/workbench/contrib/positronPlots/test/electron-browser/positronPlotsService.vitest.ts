/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { raceTimeout } from '../../../../../base/common/async.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IPositronPlotMetadata, PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { HistoryPolicy, IPositronPlotClient, IPositronPlotsService, PlotsDisplayLocation } from '../../../../services/positronPlots/common/positronPlots.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronPlotCommProxy } from '../../../../services/languageRuntime/common/positronPlotCommProxy.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyFill } from '../../../../services/positronPlots/common/sizingPolicyFill.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { mock } from '../../../../../base/test/common/mock.js';

describe('Positron - Plots Service', () => {

	const ctx = createTestContainer().withWorkbenchServices().build();
	let plotsService: IPositronPlotsService;

	beforeEach(() => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		plotsService = accessor.positronPlotsService;
	});

	async function createSession() {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);

		const out: {
			session: TestLanguageRuntimeSession;
			plotClient: IPositronPlotClient | undefined;
		} = {
			session, plotClient: undefined,
		};

		ctx.disposables.add(session.onDidCreateClientInstance(client => out.plotClient = {
			id: client.client.getClientId(),
			metadata: {} as IPositronPlotMetadata,
		} as IPositronPlotClient));

		return out;
	}

	it('history policy: change history policy', () => {
		plotsService.selectHistoryPolicy(HistoryPolicy.AlwaysVisible);
		expect(plotsService.historyPolicy).toBe(HistoryPolicy.AlwaysVisible);

		plotsService.selectHistoryPolicy(HistoryPolicy.Automatic);
		expect(plotsService.historyPolicy).toBe(HistoryPolicy.Automatic);

		plotsService.selectHistoryPolicy(HistoryPolicy.NeverVisible);
		expect(plotsService.historyPolicy).toBe(HistoryPolicy.NeverVisible);
	});

	it('history policy: change event', async () => {
		let historyPolicyChanged = 0;

		const didChangeHistoryPolicy = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidChangeHistoryPolicy((e) => {
				historyPolicyChanged++;
				resolve();
			});
			ctx.disposables.add(disposable);
		});

		// no event since 'Automatic' is the default
		plotsService.selectHistoryPolicy(HistoryPolicy.Automatic);

		// event occurs when changing to 'AlwaysVisible'
		plotsService.selectHistoryPolicy(HistoryPolicy.AlwaysVisible);

		await raceTimeout(didChangeHistoryPolicy, 100, () => expect.unreachable('onDidChangeHistoryPolicy event did not fire'));
		expect(historyPolicyChanged, 'onDidChangeHistoryPolicy event should fire once').toBe(1);
	});

	it('display location: change event', async () => {
		let displayLocationChanged = 0;
		let lastLocation: PlotsDisplayLocation | undefined;

		const didChangeDisplayLocation = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidChangeDisplayLocation((location) => {
				displayLocationChanged++;
				lastLocation = location;
				resolve();
			});
			ctx.disposables.add(disposable);
		});

		// No event since MainWindow is the default
		plotsService.setDisplayLocation(PlotsDisplayLocation.MainWindow);
		expect(displayLocationChanged, 'no event should fire when setting to default value').toBe(0);

		// Event should fire when changing to AuxiliaryWindow
		plotsService.setDisplayLocation(PlotsDisplayLocation.AuxiliaryWindow);

		await raceTimeout(didChangeDisplayLocation, 100, () => expect.unreachable('onDidChangeDisplayLocation event did not fire'));
		expect(displayLocationChanged, 'onDidChangeDisplayLocation event should fire once').toBe(1);
		expect(lastLocation).toBe(PlotsDisplayLocation.AuxiliaryWindow);
	});

	it('display location: no event when setting same location', () => {
		let displayLocationChanged = 0;

		const disposable = plotsService.onDidChangeDisplayLocation(() => {
			displayLocationChanged++;
		});
		ctx.disposables.add(disposable);

		// Change to AuxiliaryWindow
		plotsService.setDisplayLocation(PlotsDisplayLocation.AuxiliaryWindow);
		expect(displayLocationChanged).toBe(1);

		// Set to AuxiliaryWindow again - should not fire event
		plotsService.setDisplayLocation(PlotsDisplayLocation.AuxiliaryWindow);
		expect(displayLocationChanged, 'event should not fire when setting to same location').toBe(1);
	});

	it('sizing policy: check options and change size', () => {
		expect(() => plotsService.selectSizingPolicy('non-existant sizing policy')).toThrow();

		expect(plotsService.sizingPolicies.length).toBe(6);

		plotsService.selectSizingPolicy('auto');
		expect(plotsService.selectedSizingPolicy.id).toBe('auto');

		plotsService.selectSizingPolicy('fill');
		expect(plotsService.selectedSizingPolicy.id).toBe('fill');

		plotsService.selectSizingPolicy('landscape');
		expect(plotsService.selectedSizingPolicy.id).toBe('landscape');

		plotsService.selectSizingPolicy('portrait');
		expect(plotsService.selectedSizingPolicy.id).toBe('portrait');

		plotsService.selectSizingPolicy('square');
		expect(plotsService.selectedSizingPolicy.id).toBe('square');

		plotsService.setCustomPlotSize({ width: 100, height: 100 });
		expect(plotsService.selectedSizingPolicy.id).toBe('custom');
		expect(plotsService.sizingPolicies.length).toBe(7);

		plotsService.clearCustomPlotSize();
		expect(plotsService.selectedSizingPolicy.id).toBe('auto');
		expect(plotsService.sizingPolicies.length).toBe(6);
	});

	it('sizing policy: change event', async () => {
		const plotCommProxyStub = new class extends mock<PositronPlotCommProxy>() {
			override onDidClose = () => ({ dispose: () => { } });
			override onDidRenderUpdate = () => ({ dispose: () => { } });
			override onDidShowPlot = () => ({ dispose: () => { } });
			override render = vi.fn();
			override getIntrinsicSize = vi.fn();
			override dispose = vi.fn();
		};

		const plotClientInstance = new PlotClientInstance(plotCommProxyStub, {} as IConfigurationService, new PlotSizingPolicyAuto(), {} as IPositronPlotMetadata);
		ctx.disposables.add(plotClientInstance);

		let sizingPolicyChanged = false;
		const didClosePlot = new Promise<void>((resolve) => {
			const disposable = plotClientInstance.onDidChangeSizingPolicy(() => {
				sizingPolicyChanged = true;
				resolve();
			});
			ctx.disposables.add(disposable);
		});

		plotClientInstance.sizingPolicy = new PlotSizingPolicyFill();

		await raceTimeout(didClosePlot, 100, () => expect.unreachable('onDidChangeSizingPolicy event did not fire'));

		expect(sizingPolicyChanged, 'onDidChangeSizingPolicy event should fire').toBe(true);
	});

	it('selection: select plot', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');

		expect(plotsService.selectedPlotId).toBe('plot2');

		let selectPlotCalled = false;
		const didSelectPlot = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidSelectPlot((e) => {
				selectPlotCalled = true;
				resolve();
			});
			ctx.disposables.add(disposable);
		});
		plotsService.selectPlot('plot1');

		await raceTimeout(didSelectPlot, 100, () => expect.unreachable('onDidSelectPlot event did not fire'));

		expect(selectPlotCalled, 'onDidSelectPlot event should fire').toBe(true);
		expect(plotsService.selectedPlotId).toBe('plot1');
	});

	it('selection: remove selected plot', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');

		let removePlotCalled = false;

		const didRemovePlot = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidRemovePlot((e) => {
				removePlotCalled = true;
				resolve();
			});
			ctx.disposables.add(disposable);
		});

		expect(plotsService.selectedPlotId).toBe('plot1');

		plotsService.removeSelectedPlot();

		await raceTimeout(didRemovePlot, 100, () => expect.unreachable('onDidRemovePlot event did not fire'));

		expect(removePlotCalled, 'onDidRemovePlot event should fire').toBe(true);
		expect(plotsService.positronPlotInstances.length).toBe(0);
		expect(plotsService.selectedPlotId).toBe(undefined);
	});

	it('selection: expect error removing plot when no plot selected', () => {
		expect(() => plotsService.removeSelectedPlot()).toThrow('No plot is selected');
	});

	it('selection: select previous/next plot', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot3');

		expect(plotsService.selectedPlotId).toBe('plot3');

		plotsService.selectPreviousPlot();
		expect(plotsService.selectedPlotId).toBe('plot2');

		plotsService.selectPreviousPlot();
		expect(plotsService.selectedPlotId).toBe('plot1');

		plotsService.selectNextPlot();
		expect(plotsService.selectedPlotId).toBe('plot2');

		plotsService.selectNextPlot();
		expect(plotsService.selectedPlotId).toBe('plot3');
	});

	it('plot client: create client event', async () => {
		const session = await createSession();

		expect(plotsService.positronPlotInstances.length).toBe(0);
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');

		expect(plotsService.selectedPlotId).toBe('plot1');
		expect(plotsService.positronPlotInstances.length).toBe(1);
	});

	it('render queue: operation queueing and processing', async () => {
		const session = await createSession();

		// Create a plot to test with
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		expect(plotsService.positronPlotInstances.length).toBe(1);

		const plotInstance = plotsService.positronPlotInstances[0] as PlotClientInstance;

		// Mock the comm's render and getIntrinsicSize methods to track calls
		let renderCallCount = 0;
		let intrinsicSizeCallCount = 0;

		// Create stubs that return promises
		const renderStub = vi.fn().mockImplementation(async () => {
			renderCallCount++;
			await new Promise(resolve => setTimeout(resolve, 10));
			return { mime_type: 'image/png', data: 'base64data' };
		});

		const intrinsicSizeStub = vi.fn().mockImplementation(async () => {
			intrinsicSizeCallCount++;
			await new Promise(resolve => setTimeout(resolve, 10));
			return { width: 100, height: 100 };
		});

		// Replace the comm methods via the proxy
		// eslint-disable-next-line local/code-no-any-casts -- reaching into private _commProxy to inject stub comms; exposing a test hook in the source class is deferred to follow-up cleanup PR
		const commProxy = (plotInstance as any)._commProxy;
		if (commProxy && commProxy._comm) {
			commProxy._comm.render = renderStub;
			commProxy._comm.getIntrinsicSize = intrinsicSizeStub;
		}

		// Start multiple render operations simultaneously
		const render1Promise = plotInstance.render({ width: 100, height: 100 }, 1.0).catch(() => {
			// Render may be cancelled - that's expected
		});
		const render2Promise = plotInstance.render({ width: 200, height: 200 }, 1.0);

		// Wait for render operations to complete
		await Promise.all([render1Promise, render2Promise]);

		// Verify that operations were queued and processed
		// The second render should cancel the first, so we expect only 1 render call
		expect(renderCallCount, 'Should have called render only once due to cancellation').toBe(1);
	});
});
