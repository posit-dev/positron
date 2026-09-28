/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, SessionStartReason } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ConsoleInstanceInfoModalPopup } from '../../browser/components/consoleInstanceInfoButton.js';

describe('ConsoleInstanceInfoModalPopup', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderer = stubInterface<PositronModalReactRenderer>({
		onKeyDown: Event.None,
		onMouseDown: Event.None,
		onResize: Event.None,
		setBoundsProvider: vi.fn(),
		dispose: vi.fn(),
	});

	function renderPopup(detail: string, id?: SessionStartReason) {
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'python-1',
			metadata: {
				sessionId: 'python-1',
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: detail,
				startReasonId: id,
			},
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				runtimeDisplayPath: '/usr/bin/python3',
				runtimeSource: 'System',
			}),
			dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'Python 3.12' }),
			getRuntimeState: () => RuntimeState.Idle,
			onDidChangeRuntimeState: Event.None,
			listOutputChannels: async () => [],
		});

		rtl.render(
			<ConsoleInstanceInfoModalPopup
				anchorElement={document.createElement('div')}
				renderer={renderer}
				session={session}
			/>
		);
	}

	it('shows the start reason label when the session has one', () => {
		renderPopup('User selected runtime', SessionStartReason.UserSelectedRuntime);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: You selected this interpreter');
	});

	it('omits the start reason line when the start reason is empty', () => {
		renderPopup('');

		expect(screen.queryByTestId('session-start-reason')).not.toBeInTheDocument();
	});
});
