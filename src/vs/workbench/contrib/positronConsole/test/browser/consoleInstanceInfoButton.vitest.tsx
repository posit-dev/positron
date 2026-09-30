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
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, SessionStartReason } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ConsoleInstanceInfoModalPopup } from '../../browser/components/consoleInstanceInfoButton.js';

describe('ConsoleInstanceInfoModalPopup', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IExtensionService, {
			extensions: [stubInterface<IExtensionDescription>({
				identifier: new ExtensionIdentifier('positron.positron-python'),
				displayName: 'Python',
			})],
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderer = stubInterface<PositronModalReactRenderer>({
		onKeyDown: Event.None,
		onMouseDown: Event.None,
		onResize: Event.None,
		setBoundsProvider: vi.fn(),
		dispose: vi.fn(),
	});

	function renderPopup(detail: string, id?: SessionStartReason, extensionId = 'positron.positron-python', notebookUri?: URI) {
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'python-1',
			metadata: {
				sessionId: 'python-1',
				sessionMode: notebookUri ? LanguageRuntimeSessionMode.Notebook : LanguageRuntimeSessionMode.Console,
				notebookUri,
				createdTimestamp: 0,
				startReason: detail,
				startReasonId: id,
			},
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				runtimeDisplayPath: '/usr/bin/python3',
				runtimeSource: 'System',
				languageName: 'Python',
				languageId: 'python',
				runtimeName: 'Python 3.12.4',
				extensionId: new ExtensionIdentifier(extensionId),
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

	it('names the extension that provides the session\'s interpreter', () => {
		renderPopup('', SessionStartReason.ExtensionRecommendedRuntime);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The Python extension recommended starting the interpreter for this workspace');
	});

	it('names the session\'s language', () => {
		renderPopup('', SessionStartReason.LanguageFileOpened);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: This interpreter was started after a file written in Python was opened');
	});

	it('falls back to the extension ID when the extension is not registered', () => {
		renderPopup('', SessionStartReason.ExtensionRecommendedRuntime, 'example.missing');

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The example.missing extension recommended starting the interpreter for this workspace');
	});

	it('names the session\'s notebook', () => {
		renderPopup('', SessionStartReason.NotebookEditorOpened, undefined, URI.file('/work/analysis.ipynb'));

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The analysis.ipynb notebook was opened');
	});

	it('omits the start reason line when the start reason is empty', () => {
		renderPopup('');

		expect(screen.queryByTestId('session-start-reason')).not.toBeInTheDocument();
	});
});
