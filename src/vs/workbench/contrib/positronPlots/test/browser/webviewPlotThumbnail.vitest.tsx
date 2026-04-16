/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import React from 'react';
import { act } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { WebviewPlotThumbnail } from '../../browser/components/webviewPlotThumbnail.js';
import { WebviewPlotClient } from '../../browser/webviewPlotClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Emitter at describe level -- wired into the mock plotClient so .fire()
// reaches the component's useEffect subscription. See "Common Mistakes"
// in .claude/rules/vitest.md for why this must NOT be inside it().
const onDidRenderThumbnail = new Emitter<string>();

function makePlotClient(overrides: Partial<WebviewPlotClient> = {}): WebviewPlotClient {
	return {
		id: 'plot-1',
		thumbnailUri: undefined,
		onDidRenderThumbnail: onDidRenderThumbnail.event,
		...overrides,
	} as unknown as WebviewPlotClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebviewPlotThumbnail', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPlotsService, { getCachedPlotThumbnailURI: () => undefined })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows placeholder when no thumbnail is available', () => {
		const { container } = rtl.render(
			<WebviewPlotThumbnail plotClient={makePlotClient()} />
		);
		expect(container.querySelector('.plot-thumbnail-placeholder')).not.toBeNull();
		expect(container.querySelector('img')).toBeNull();
	});

	it('shows image when plotClient already has a thumbnailUri', () => {
		const plotClient = makePlotClient({ thumbnailUri: 'data:image/png;base64,abc' });
		const { container } = rtl.render(
			<WebviewPlotThumbnail plotClient={plotClient} />
		);
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		expect(img!.src).toBe('data:image/png;base64,abc');
	});

	it('updates to rendered thumbnail when event fires', () => {
		const { container } = rtl.render(
			<WebviewPlotThumbnail plotClient={makePlotClient()} />
		);

		// Initially shows placeholder.
		expect(container.querySelector('.plot-thumbnail-placeholder')).not.toBeNull();

		// Simulate the plot rendering a thumbnail.
		act(() => {
			onDidRenderThumbnail.fire('data:image/png;base64,rendered');
		});

		// Now shows the rendered image.
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		expect(img!.src).toBe('data:image/png;base64,rendered');
		expect(container.querySelector('.plot-thumbnail-placeholder')).toBeNull();
	});
});
