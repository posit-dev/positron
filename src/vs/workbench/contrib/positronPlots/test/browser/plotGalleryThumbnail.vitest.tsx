/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PlotGalleryThumbnail } from '../../browser/components/plotGalleryThumbnail.js';
import { StaticPlotThumbnail } from '../../browser/components/staticPlotThumbnail.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';

describe('PlotGalleryThumbnail', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderThumbnail(id: string, name?: string) {
		const plotClient = stubInterface<StaticPlotClient>({ id, uri: 'data:image/png;base64,', metadata: { id, created: 0, code: '', session_id: 'session', name } });
		rtl.render(
			<PlotGalleryThumbnail focusNextPlotThumbnail={() => { }} focusPreviousPlotThumbnail={() => { }} plotClient={plotClient} selected={false}>
				<StaticPlotThumbnail plotClient={plotClient} />
			</PlotGalleryThumbnail>
		);
	}

	it('names a named plot thumbnail once', () => {
		renderThumbnail('plot1', 'plot 1');

		// The name option matches the whole accessible name, so "plot 1 plot 1" would not match.
		expect(screen.getByRole('button', { name: 'plot 1' })).toBeInTheDocument();
	});

	it('names an unnamed plot thumbnail from the image', () => {
		renderThumbnail('plot1');

		expect(screen.getByRole('button', { name: 'Plot plot1' })).toBeInTheDocument();
	});
});
