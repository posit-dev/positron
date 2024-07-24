/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { raceTimeout } from 'vs/base/common/async';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { PositronIPyWidgetsService } from 'vs/workbench/contrib/positronIPyWidgets/browser/positronIPyWidgetsService';
import { PositronPlotsService } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsService';
import { PositronWebviewPreloadService } from 'vs/workbench/contrib/positronWebviewPreloads/browser/positronWebviewPreloadsService';
import { IPositronIPyWidgetsService } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { HistoryPolicy } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { IPositronWebviewPreloadService } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestRuntimeSessionService } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

suite('Positron - Plots Service', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let plotsService: PositronPlotsService;
	let runtimeSessionService: TestRuntimeSessionService;

	setup(() => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		runtimeSessionService = disposables.add(instantiationService.createInstance(TestRuntimeSessionService));
		instantiationService.stub(IRuntimeSessionService, runtimeSessionService);
		instantiationService.stub(IPositronWebviewPreloadService, disposables.add(instantiationService.createInstance(PositronWebviewPreloadService)));
		instantiationService.stub(IPositronIPyWidgetsService, disposables.add(instantiationService.createInstance(PositronIPyWidgetsService)));

		plotsService = disposables.add(instantiationService.createInstance(PositronPlotsService));
	});

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

		const didChangeHisotryPolicy = new Promise<void>((resolve) => {
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

		await raceTimeout(didChangeHisotryPolicy, 100, () => assert.fail('onDidChangeHistoryPolicy event did not fire'));
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

		// event occurs when changing to 'fill'
		plotsService.selectSizingPolicy('fill');

		await raceTimeout(didChangeSizingPolicy, 100, () => assert.fail('onDidChangeSizingPolicy event did not fire'));
		assert.strictEqual(sizingPolicyChanged, 1, 'onDidChangeSizingPolicy event should fire once for changing to "fill"');
	});

	test('selection: select plot', async () => {
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
		let removePlotCalled = false;

		plotsService.selectPlot('plot1');

		const didRemovePlot = new Promise<void>((resolve) => {
			const disposable = plotsService.onDidRemovePlot((e) => {
				removePlotCalled = true;
				resolve();
			});
			disposables.add(disposable);
		});

		plotsService.selectPlot('plot1');
		assert.strictEqual(plotsService.selectedPlotId, 'plot1');

		plotsService.removeSelectedPlot();

		await raceTimeout(didRemovePlot, 100, () => assert.fail('onDidRemovePlot event did not fire'));

		assert.ok(removePlotCalled, 'onDidRemovePlot event should fire');
	});

	test('selection: expect error removing plot when no plot selected', () => {
		assert.throws(() => plotsService.removeSelectedPlot());
	});
});
