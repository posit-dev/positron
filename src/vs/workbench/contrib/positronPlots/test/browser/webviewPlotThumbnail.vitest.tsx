/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { WebviewPlotThumbnail } from '../../browser/components/webviewPlotThumbnail.js';
import { WebviewPlotClient } from '../../browser/webviewPlotClient.js';

describe('WebviewPlotThumbnail', () => {
	// Emitter at describe level -- wired into the mock plotClient so .fire()
	// reaches the component's useEffect subscription. See "Common Mistakes"
	// in .claude/rules/vitest-tests.md for why this must NOT be inside it().
	const onDidRenderThumbnail = new Emitter<string>();

	function makePlotClient(overrides: Partial<WebviewPlotClient> = {}): WebviewPlotClient {
		// Partial plot-client mock: the component only reads id, thumbnailUri,
		// and onDidRenderThumbnail. The double-cast is the established test
		// pattern for partial-object mocks of complex service classes.
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		return {
			id: 'plot-1',
			thumbnailUri: undefined,
			onDidRenderThumbnail: onDidRenderThumbnail.event,
			...overrides,
		} as unknown as WebviewPlotClient;
	}
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPlotsService, { getCachedPlotThumbnailURI: () => undefined })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows placeholder when no thumbnail is available', () => {
		rtl.render(
			<WebviewPlotThumbnail plotClient={makePlotClient()} />
		);
		expect(screen.getByTestId('plot-thumbnail-placeholder')).toBeInTheDocument();
		expect(screen.queryByAltText(/^Plot /)).not.toBeInTheDocument();
	});

	it('shows image when plotClient already has a thumbnailUri', () => {
		const plotClient = makePlotClient({ thumbnailUri: 'data:image/png;base64,abc' });
		rtl.render(
			<WebviewPlotThumbnail plotClient={plotClient} />
		);
		const img = screen.getByAltText('Plot plot-1');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', 'data:image/png;base64,abc');
	});

	it('updates to rendered thumbnail when event fires', () => {
		rtl.render(
			<WebviewPlotThumbnail plotClient={makePlotClient()} />
		);

		// Initially shows placeholder.
		expect(screen.getByTestId('plot-thumbnail-placeholder')).toBeInTheDocument();
		expect(screen.queryByAltText(/^Plot /)).not.toBeInTheDocument();

		// Simulate the plot rendering a thumbnail.
		act(() => {
			onDidRenderThumbnail.fire('data:image/png;base64,rendered');
		});

		// Now shows the rendered image.
		const img = screen.getByAltText('Plot plot-1');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', 'data:image/png;base64,rendered');
		expect(screen.queryByTestId('plot-thumbnail-placeholder')).not.toBeInTheDocument();
	});
});
