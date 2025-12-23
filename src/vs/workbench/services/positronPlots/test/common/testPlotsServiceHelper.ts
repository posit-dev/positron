/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestPositronPlotsService } from './testPositronPlotsService.js';
import { TestPositronPlotClient } from './testPositronPlotClient.js';
import { HistoryPolicy, ZoomLevel } from '../../common/positronPlots.js';

/**
 * Example of how to use the TestPositronPlotsService in tests.
 */
export function createTestPlotsServiceWithPlots(): TestPositronPlotsService {
	// Create a new test plots service
	const plotsService = new TestPositronPlotsService();

	// Add a couple of test plot clients
	const plotClient1 = new TestPositronPlotClient({
		id: 'test-plot-1',
		session_id: 'test-session',
		created: Date.now(),
		execution_id: '',
		code: 'plot(1:10)',
		zoom_level: ZoomLevel.Fit,
	});

	const plotClient2 = new TestPositronPlotClient({
		id: 'test-plot-2',
		session_id: 'test-session',
		created: Date.now() + 1000, // Created later
		execution_id: '',
		code: 'hist(rnorm(100))',
		zoom_level: ZoomLevel.Fit,
	});

	// Add the plot clients to the service
	plotsService.addPlotClient(plotClient1);
	plotsService.addPlotClient(plotClient2, true); // Select this one

	// Set up the history policy
	plotsService.selectHistoryPolicy(HistoryPolicy.Automatic);

	return plotsService;
}
