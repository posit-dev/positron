/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { raceTimeout } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IPositronPlotMetadata, PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { HistoryPolicy, IPositronPlotClient, IPositronPlotsService, PlotOpenTarget, PlotsDisplayLocation, POSITRON_PLOTS_VIEW_ID } from '../../../../services/positronPlots/common/positronPlots.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ACTIVE_GROUP, AUX_WINDOW_GROUP, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronPlotCommProxy } from '../../../../services/languageRuntime/common/positronPlotCommProxy.js';
import { IntrinsicSize, PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { PlotSizingPolicyAuto } from '../../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyFill } from '../../../../services/positronPlots/common/sizingPolicyFill.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

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
		const plotCommProxyStub = stubInterface<PositronPlotCommProxy>({
			onDidClose: () => ({ dispose: () => { } }),
			onDidRenderUpdate: () => ({ dispose: () => { } }),
			onDidShowPlot: () => ({ dispose: () => { } }),
			onDidSetIntrinsicSize: () => ({ dispose: () => { } }),
			render: vi.fn(),
			getIntrinsicSize: vi.fn(),
			dispose: vi.fn(),
		});

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

	it('sizing policy: prefers the intrinsic size when the backend reports one', async () => {
		const session = await createSession();
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');

		const plotInstance = plotsService.positronPlotInstances[0] as PlotClientInstance;

		// The plot starts out using the default auto sizing policy.
		expect(plotInstance.sizingPolicy.id).toBe('auto');

		// Make the backend report a Quarto intrinsic size (e.g. from fig-width/fig-height).
		// eslint-disable-next-line local/code-no-any-casts -- private field access for stub injection in test only
		const comm = (plotInstance as any)._commProxy._comm;
		comm.getIntrinsicSize = vi.fn().mockResolvedValue({
			width: 10, height: 3, unit: PlotUnit.Inches, source: 'Quarto',
		} satisfies IntrinsicSize);

		// Querying the intrinsic size should upgrade the plot to the intrinsic policy.
		await plotInstance.getIntrinsicSize();

		expect(plotInstance.sizingPolicy.id).toBe('intrinsic');
	});

	it('sizing policy: keeps the auto policy when the backend reports no intrinsic size', async () => {
		const session = await createSession();
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');

		const plotInstance = plotsService.positronPlotInstances[0] as PlotClientInstance;
		expect(plotInstance.sizingPolicy.id).toBe('auto');

		// The backend reports no intrinsic size (e.g. a plain R plot without figure options).
		// eslint-disable-next-line local/code-no-any-casts -- private field access for stub injection in test only
		const comm = (plotInstance as any)._commProxy._comm;
		comm.getIntrinsicSize = vi.fn().mockResolvedValue(undefined);

		await plotInstance.getIntrinsicSize();

		expect(plotInstance.sizingPolicy.id).toBe('auto');
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

	it('removal: removing a single plot leaves the other plots intact', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot3');

		expect(plotsService.positronPlotInstances.length).toBe(3);

		// Removing one plot should remove only that plot, not its neighbor.
		plotsService.removePlot('plot1');

		expect(plotsService.positronPlotInstances.map(p => p.id)).toEqual(['plot2', 'plot3']);
	});

	it('selection: expect error removing plot when no plot selected', () => {
		expect(() => plotsService.removeSelectedPlot()).toThrow('No plot is selected');
	});

	describe('default open target', () => {
		const NEW_KEY = 'positronPlots.defaultOpenTarget';
		const LEGACY_KEY = 'positronPlots.defaultEditorAction';

		let storageService: IStorageService;

		beforeEach(() => {
			storageService = ctx.instantiationService.invokeFunction(accessor => accessor.get(IStorageService));
			// Reset both storage keys so each scenario starts from a known state.
			storageService.remove(NEW_KEY, StorageScope.WORKSPACE);
			storageService.remove(LEGACY_KEY, StorageScope.WORKSPACE);
		});

		it('migrates legacy editor-group values when the new key is unset', () => {
			const cases: Array<[number, PlotOpenTarget]> = [
				[ACTIVE_GROUP, PlotOpenTarget.EditorTab],
				[AUX_WINDOW_GROUP, PlotOpenTarget.EditorNewWindow],
				[SIDE_GROUP, PlotOpenTarget.EditorTabToSide],
			];
			for (const [legacyGroup, expected] of cases) {
				storageService.remove(NEW_KEY, StorageScope.WORKSPACE);
				storageService.store(LEGACY_KEY, legacyGroup, StorageScope.WORKSPACE, StorageTarget.MACHINE);
				expect(plotsService.getDefaultOpenTarget()).toBe(expected);
			}
		});

		it('prefers the new key over the legacy key when both are present', () => {
			storageService.store(LEGACY_KEY, AUX_WINDOW_GROUP, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			plotsService.setDefaultOpenTarget(PlotOpenTarget.Gallery);
			expect(plotsService.getDefaultOpenTarget()).toBe(PlotOpenTarget.Gallery);
		});

		it('derives getPreferredEditorGroup from the remembered target', () => {
			const cases: Array<[PlotOpenTarget, number]> = [
				[PlotOpenTarget.EditorNewWindow, AUX_WINDOW_GROUP],
				[PlotOpenTarget.EditorTab, ACTIVE_GROUP],
				[PlotOpenTarget.EditorTabToSide, SIDE_GROUP],
				[PlotOpenTarget.Gallery, ACTIVE_GROUP],
				[PlotOpenTarget.Popout, ACTIVE_GROUP],
			];
			for (const [target, expectedGroup] of cases) {
				plotsService.setDefaultOpenTarget(target);
				expect(plotsService.getPreferredEditorGroup()).toBe(expectedGroup);
			}
		});
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

		// Replace the live comm's methods to drive the render-concurrency test.
		// Reaching into the private _commProxy/_comm fields keeps the test hook out of
		// production source; exposing them via @internal getters would still surface in
		// IDE autocomplete since stripInternal isn't enabled.
		// eslint-disable-next-line local/code-no-any-casts -- private field access for stub injection in test only
		const comm = (plotInstance as any)._commProxy._comm;
		comm.render = renderStub;
		comm.getIntrinsicSize = intrinsicSizeStub;

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

	// Guard-only coverage for the plot output action buttons (issue #12497). The real
	// clipboard write and auxiliary-window creation are exercised by the plots e2e suite;
	// here we only pin the branching that decides whether those side effects run at all.
	describe('plot actions: copy and open in new window', () => {
		it('open in new window: throws when no plot is selected', () => {
			expect(() => plotsService.openPlotInNewWindow()).toThrow('no plot selected');
		});

		it('copy view plot: rejects when no plot is selected', async () => {
			await expect(plotsService.copyViewPlotToClipboard()).rejects.toThrow('Plot not found');
		});

		it('copy editor plot: rejects when the plot id is unknown', async () => {
			await expect(plotsService.copyEditorPlotToClipboard('missing')).rejects.toThrow('Plot not found');
		});
	});

	// Notebook consoles surface their static image outputs in the Plots pane,
	// but passively -- the plot appears without the pane being raised. Plain
	// notebooks (no attached console) stay out of the pane entirely.
	describe('notebook console plots', () => {
		const SHOW_NOTEBOOK_CONSOLES_KEY = 'console.showNotebookConsoles';

		// A static image output message, of the shape a runtime emits for a plot.
		function staticImageMessage(id: string) {
			return { id, kind: RuntimeOutputKind.StaticImage, data: { 'image/png': 'dGVzdA==' } };
		}

		async function startNotebookSession() {
			return startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri: URI.parse('untitled:notebook.ipynb'),
			});
		}

		it('notebook console: surfaces static plots passively (does not raise the pane)', async () => {
			// A notebook session gets a console when notebook consoles are enabled.
			const configurationService = ctx.instantiationService.get(IConfigurationService) as TestConfigurationService;
			await configurationService.setUserConfiguration(SHOW_NOTEBOOK_CONSOLES_KEY, true);
			const openViewSpy = vi.spyOn(ctx.instantiationService.get(IViewsService), 'openView');

			const session = await startNotebookSession();
			session.receiveOutputMessage(staticImageMessage('notebook-plot-1'));

			// The plot shows up in the Plots pane, but the pane is never raised.
			expect(plotsService.positronPlotInstances.map(p => p.id)).toEqual(['notebook-plot-1']);
			expect(openViewSpy).not.toHaveBeenCalledWith(POSITRON_PLOTS_VIEW_ID, false);
		});

		it('plain notebook (no console): keeps plots out of the pane', async () => {
			// notebook consoles disabled (the default), so this notebook has no console.
			const session = await startNotebookSession();
			session.receiveOutputMessage(staticImageMessage('notebook-plot-1'));

			expect(plotsService.positronPlotInstances.length).toBe(0);
		});

		it('console: surfaces static plots and raises the pane', async () => {
			const openViewSpy = vi.spyOn(ctx.instantiationService.get(IViewsService), 'openView');

			// startTestLanguageRuntimeSession defaults to a console session.
			const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
			session.receiveOutputMessage(staticImageMessage('console-plot-1'));

			expect(plotsService.positronPlotInstances.map(p => p.id)).toEqual(['console-plot-1']);
			expect(openViewSpy).toHaveBeenCalledWith(POSITRON_PLOTS_VIEW_ID, false);
		});
	});
});
