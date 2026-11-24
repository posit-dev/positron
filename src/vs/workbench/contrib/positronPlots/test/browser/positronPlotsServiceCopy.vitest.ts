/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotClient } from '../../../../services/positronPlots/common/positronPlots.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import type { CopyPlotOptions } from '../../browser/modalDialogs/copyPlotModalDialog.js';
import { PositronPlotsService } from '../../browser/positronPlotsService.js';

const { showCopyPlotModalDialog } = vi.hoisted(() => ({ showCopyPlotModalDialog: vi.fn<(options: CopyPlotOptions) => void>() }));
// The dialog itself is covered by copyPlotModalDialog.vitest.tsx; here only its options matter.
vi.mock('../../browser/modalDialogs/copyPlotModalDialog.js', () => ({ showCopyPlotModalDialog }));

describe('PositronPlotsService - copy at custom size', () => {
	const writeImage = vi.fn(async (_data: string) => { });
	const notifyInfo = vi.fn();
	const notifyError = vi.fn();
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IClipboardService, { writeImage })
		.stub(INotificationService, { info: notifyInfo, error: notifyError })
		.build();
	let plotsService: PositronPlotsService;

	beforeEach(() => {
		plotsService = ctx.disposables.add(ctx.instantiationService.createInstance(PositronPlotsService));
	});

	/** Puts a plot in the editor plot map, which is what copyEditorPlotAtCustomSize reads. */
	function addEditorPlot(id: string, plot: IPositronPlotClient) {
		(plotsService as unknown as { _editorPlots: Map<string, IPositronPlotClient> })._editorPlots.set(id, plot);
	}

	function addDynamicPlot(id: string) {
		// Object.create passes the instanceof check without starting a real plot comm.
		addEditorPlot(id, Object.create(PlotClientInstance.prototype));
	}

	function lastOptions(): CopyPlotOptions {
		return showCopyPlotModalDialog.mock.lastCall![0];
	}

	it('keeps the aspect ratio by default and remembers the choice', () => {
		addDynamicPlot('p1');
		plotsService.copyEditorPlotAtCustomSize('p1');
		expect(lastOptions().keepRatio).toBe(true);

		lastOptions().onKeepRatioChange(false);
		plotsService.copyEditorPlotAtCustomSize('p1');
		expect(lastOptions().keepRatio).toBe(false);
	});

	it('copies the drawn image to the clipboard as base64', async () => {
		addDynamicPlot('p1');
		plotsService.copyEditorPlotAtCustomSize('p1');

		await lastOptions().onCopy('data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E');

		expect(writeImage).toHaveBeenCalledWith(`data:image/svg+xml;base64,${btoa('<svg></svg>')}`);
	});

	it('shows a message for a plot that cannot be redrawn', () => {
		addEditorPlot('static', Object.create(StaticPlotClient.prototype));
		plotsService.copyEditorPlotAtCustomSize('static');

		expect(notifyInfo).toHaveBeenCalledOnce();
		expect(showCopyPlotModalDialog).not.toHaveBeenCalled();
	});

	it('shows an error without a plot', () => {
		plotsService.copyViewPlotAtCustomSize();

		expect(notifyError).toHaveBeenCalledOnce();
		expect(showCopyPlotModalDialog).not.toHaveBeenCalled();
	});
});
