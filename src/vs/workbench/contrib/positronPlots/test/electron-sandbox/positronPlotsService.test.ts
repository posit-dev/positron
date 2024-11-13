/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { raceTimeout } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService as positronWorkbenchInstantiationService } from 'vs/workbench/test/browser/positronWorkbenchTestServices';
import { IPositronPlotMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { HistoryPolicy, IPositronPlotClient, IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { startTestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';

suite('Positron - Plots Service', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let plotsService: IPositronPlotsService;

	setup(() => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		const accessor = instantiationService.createInstance(PositronTestServiceAccessor);
		plotsService = accessor.positronPlotsService;
	});

	async function createSession() {
		const session = await startTestLanguageRuntimeSession(instantiationService, disposables);

		const out: {
			session: TestLanguageRuntimeSession;
			plotClient: IPositronPlotClient | undefined;
		} = {
			session, plotClient: undefined,
		};

		disposables.add(session.onDidCreateClientInstance(client => out.plotClient = {
			id: client.client.getClientId(),
			metadata: {} as IPositronPlotMetadata,
		} as IPositronPlotClient));

		return out;
	}

	test('history policy: change history policy', () => {
		plotsService.selectHistoryPolicy(HistoryPolicy.AlwaysVisible);
		assert.strictEqual(plotsService.historyPolicy, HistoryPolicy.AlwaysVisible);

		plotsService.selectHistoryPolicy(HistoryPolicy.Automatic);
		assert.strictEqual(plotsService.historyPolicy, HistoryPolicy.Automatic);

		plotsService.selectHistoryPolicy(HistoryPolicy.NeverVisible);
		assert.strictEqual(plotsService.historyPolicy, HistoryPolicy.NeverVisible);
	});

	test('history policy: change event', async () => {
		let historyPolicyChanged = 0;

		const didChangeHistoryPolicy = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidChangeHistoryPolicy((e) => {
				historyPolicyChanged++;
				resolve();
			});
			disposables.add(disposable);
		});

		// no event since 'Automatic' is the default
		plotsService.selectHistoryPolicy(HistoryPolicy.Automatic);

		// event occurs when changing to 'AlwaysVisible'
		plotsService.selectHistoryPolicy(HistoryPolicy.AlwaysVisible);

		await raceTimeout(didChangeHistoryPolicy, 100, () => assert.fail('onDidChangeHistoryPolicy event did not fire'));
		assert.strictEqual(historyPolicyChanged, 1, 'onDidChangeHistoryPolicy event should fire once');
	});

	test('sizing policy: check options and change size', () => {
		assert.throws(() => plotsService.selectSizingPolicy('non-existant sizing policy'));

		assert.strictEqual(plotsService.sizingPolicies.length, 6);

		plotsService.selectSizingPolicy('auto');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'auto');

		plotsService.selectSizingPolicy('fill');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'fill');

		plotsService.selectSizingPolicy('landscape');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'landscape');

		plotsService.selectSizingPolicy('portrait');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'portrait');

		plotsService.selectSizingPolicy('square');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'square');

		plotsService.setCustomPlotSize({ width: 100, height: 100 });
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'custom');
		assert.strictEqual(plotsService.sizingPolicies.length, 7);

		plotsService.clearCustomPlotSize();
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'auto');
		assert.strictEqual(plotsService.sizingPolicies.length, 6);
	});

	test('sizing policy: change event', async () => {
		let sizingPolicyChanged = 0;

		const didChangeSizingPolicy = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidChangeSizingPolicy((e) => {
				sizingPolicyChanged++;
				resolve();
			});
			disposables.add(disposable);
		});

		// no event since 'auto' is the default
		plotsService.selectSizingPolicy('auto');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'auto');

		// event occurs when changing to 'fill'
		plotsService.selectSizingPolicy('fill');
		assert.strictEqual(plotsService.selectedSizingPolicy.id, 'fill');

		await raceTimeout(didChangeSizingPolicy, 100, () => assert.fail('onDidChangeSizingPolicy event did not fire'));
		assert.strictEqual(sizingPolicyChanged, 1, 'onDidChangeSizingPolicy event should fire once for changing to "fill"');
	});

	test('selection: select plot', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');

		assert.strictEqual(plotsService.selectedPlotId, 'plot2');

		let selectPlotCalled = false;
		const didSelectPlot = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidSelectPlot((e) => {
				selectPlotCalled = true;
				resolve();
			});
			disposables.add(disposable);
		});
		plotsService.selectPlot('plot1');

		await raceTimeout(didSelectPlot, 100, () => assert.fail('onDidSelectPlot event did not fire'));

		assert.ok(selectPlotCalled, 'onDidSelectPlot event should fire');
		assert.strictEqual(plotsService.selectedPlotId, 'plot1');
	});

	test('selection: remove selected plot', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');

		let removePlotCalled = false;

		const didRemovePlot = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidRemovePlot((e) => {
				removePlotCalled = true;
				resolve();
			});
			disposables.add(disposable);
		});

		assert.strictEqual(plotsService.selectedPlotId, 'plot1');

		plotsService.removeSelectedPlot();

		await raceTimeout(didRemovePlot, 100, () => assert.fail('onDidRemovePlot event did not fire'));

		assert.ok(removePlotCalled, 'onDidRemovePlot event should fire');
		assert.strictEqual(plotsService.positronPlotInstances.length, 0);
		assert.strictEqual(plotsService.selectedPlotId, undefined);
	});

	test('selection: expect error removing plot when no plot selected', () => {
		assert.throws(() => plotsService.removeSelectedPlot(), { message: 'No plot is selected' });
	});

	test('selection: select previous/next plot', async () => {
		const session = await createSession();

		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot3');

		assert.strictEqual(plotsService.selectedPlotId, 'plot3');

		plotsService.selectPreviousPlot();
		assert.strictEqual(plotsService.selectedPlotId, 'plot2');

		plotsService.selectPreviousPlot();
		assert.strictEqual(plotsService.selectedPlotId, 'plot1');

		plotsService.selectNextPlot();
		assert.strictEqual(plotsService.selectedPlotId, 'plot2');

		plotsService.selectNextPlot();
		assert.strictEqual(plotsService.selectedPlotId, 'plot3');
	});

	test('plot client: create client event', async () => {
		const session = await createSession();

		assert.strictEqual(plotsService.positronPlotInstances.length, 0);
		session.session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');

		assert.strictEqual(plotsService.selectedPlotId, 'plot1');
		assert.strictEqual(plotsService.positronPlotInstances.length, 1);
	});
});
