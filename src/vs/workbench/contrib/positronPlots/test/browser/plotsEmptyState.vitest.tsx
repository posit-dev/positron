/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IPositronDocsService } from '../../../../services/positronDocs/browser/positronDocsService.js';
import { RuntimeClientType } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronPlots } from '../../browser/positronPlots.js';

describe('Plots empty state', () => {
	const open = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IOpenerService, { open })
		.stub(IPositronDocsService, { getUrl: (path?: string) => `https://docs.example/${path}` })
		.build();
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

	const hint = () => screen.queryByText('Plots created in your session appear here.');

	it('says what the pane is for and links to its documentation when there are no plots', async () => {
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);
		expect(hint()).toBeInTheDocument();
		await userEvent.setup().click(screen.getByRole('button', { name: 'View documentation for the Plots pane' }));
		expect(open.mock.calls.map(call => String(call[0]))).toEqual(['https://docs.example/plots-pane.html']);
	});

	it('gives way to the plot once there is one', async () => {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		session.createClient(RuntimeClientType.Plot, {}, {}, 'plot1');
		rtl.render(<PositronPlots reactComponentContainer={reactComponentContainer} />);
		expect(hint()).not.toBeInTheDocument();
	});
});
