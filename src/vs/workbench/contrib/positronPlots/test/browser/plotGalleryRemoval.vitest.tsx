/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronPlots } from '../../browser/positronPlots.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';

describe('Plot gallery removal', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

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

	async function createPlots(): Promise<IPositronPlotsService> {
		const plotsService = ctx.reactServices.positronPlotsService;
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot2');
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot3');
		return plotsService;
	}

	it('removing one plot from the gallery leaves the other plots in the gallery', async () => {
		const plotsService = await createPlots();
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
});
