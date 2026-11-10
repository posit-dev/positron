/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronPlots } from '../../browser/positronPlots.js';
import { isZoomablePlotClient, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';

// happy-dom has no canvas, so the real dynamic action bar renders nothing. Render
// each left action's component directly instead.
vi.mock(import('../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js'), async importOriginal => ({
	...await importOriginal(),
	PositronDynamicActionBar: (props: { leftActions?: { component: React.ReactNode }[] }) => (
		<div>{props.leftActions?.map((action, index) => <span key={index}>{action.component}</span>)}</div>
	),
}));

describe('Plot zoom state', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

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

	/**
	 * Sets the zoom level of a plot, as choosing a level in the Zoom dropdown does.
	 */
	function setPlotZoom(plotId: string, zoomLevel: ZoomLevel) {
		const plot = ctx.reactServices.positronPlotsService.positronPlotInstances.find(p => p.id === plotId);
		if (!isZoomablePlotClient(plot)) {
			throw new Error(`Plot ${plotId} is not zoomable`);
		}
		act(() => {
			plot.zoomLevel = zoomLevel;
		});
	}

	it('shows the new zoom level when a plot selected before the pane mounted is zoomed', async () => {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		expect(ctx.reactServices.positronPlotsService.selectedPlotId).toBe('plot1');

		// Mount the pane after the plot was already selected.
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);
		expect(screen.getByRole('button', { name: /Fit/ })).toBeInTheDocument();

		setPlotZoom('plot1', ZoomLevel.TwoHundred);

		expect(screen.getByRole('button', { name: /200%/ })).toBeInTheDocument();
	});
});
