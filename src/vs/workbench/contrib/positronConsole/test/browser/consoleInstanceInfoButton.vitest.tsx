/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IConfigurationService, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, SessionStartReasonId } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ConsoleInstanceInfoModalPopup } from '../../browser/components/consoleInstanceInfoButton.js';

describe('ConsoleInstanceInfoModalPopup', () => {
	const openUserSettings = vi.fn(async () => undefined);
	const openRemoteSettings = vi.fn(async () => undefined);
	const openWorkspaceSettings = vi.fn(async () => undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPreferencesService, { openUserSettings, openRemoteSettings, openWorkspaceSettings })
		.stub(IExtensionService, {
			extensions: [
				stubInterface<IExtensionDescription>({
					identifier: new ExtensionIdentifier('positron.positron-python'),
					displayName: 'Python',
				}),
				stubInterface<IExtensionDescription>({
					identifier: new ExtensionIdentifier('posit.shiny'),
					displayName: 'Shiny',
				}),
			],
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

	function renderPopup(detail: string, id?: SessionStartReasonId, extensionId = 'positron.positron-python', notebookUri?: URI, requestingExtensionId?: string) {
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'python-1',
			metadata: {
				sessionId: 'python-1',
				sessionMode: notebookUri ? LanguageRuntimeSessionMode.Notebook : LanguageRuntimeSessionMode.Console,
				notebookUri,
				createdTimestamp: 0,
				startReason: detail,
				startReasonId: id,
				requestingExtensionId,
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
		renderPopup('User selected runtime', SessionStartReasonId.UserSelectedRuntime);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: You selected this interpreter');
	});

	it('names the extension that provides the session\'s interpreter', () => {
		renderPopup('', SessionStartReasonId.ExtensionRecommendedRuntime);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The Python extension recommended this interpreter for this workspace');
	});

	it('names the session\'s language', () => {
		renderPopup('', SessionStartReasonId.LanguageFileOpened);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: A file written in Python was opened');
	});

	it('falls back to the extension ID when the extension is not registered', () => {
		renderPopup('', SessionStartReasonId.ExtensionRecommendedRuntime, 'example.missing');

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The example.missing extension recommended this interpreter for this workspace');
	});

	it('names the extension that asked for the session', () => {
		renderPopup('', SessionStartReasonId.ExtensionApiStart, undefined, undefined, 'posit.shiny');

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The Shiny extension started this interpreter');
	});

	it('falls back to the requesting extension ID when the extension is not registered', () => {
		renderPopup('', SessionStartReasonId.ExtensionApiStart, undefined, undefined, 'example.missing');

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The example.missing extension started this interpreter');
	});

	it('names the session\'s notebook', () => {
		renderPopup('', SessionStartReasonId.NotebookEditorOpened, undefined, URI.file('/work/analysis.ipynb'));

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: analysis.ipynb was opened');
	});

	async function clickStartupBehaviorLink(value: IConfigurationValue<string>, id = SessionStartReasonId.StartupBehaviorAlways) {
		const inspect = vi.spyOn(ctx.get(IConfigurationService), 'inspect').mockReturnValue(value);
		const user = userEvent.setup();
		renderPopup('', id);

		await user.click(screen.getByRole('link', { name: 'You can change the startup behavior in settings' }));

		expect(inspect).toHaveBeenCalledWith('interpreters.startupBehavior', { overrideIdentifier: 'python' });
		expect(renderer.dispose).toHaveBeenCalled();
		return {
			user: openUserSettings.mock.calls,
			remote: openRemoteSettings.mock.calls,
			workspace: openWorkspaceSettings.mock.calls,
		};
	}

	it('opens the language-specific Startup Behavior setting for its start reason', async () => {
		expect(await clickStartupBehaviorLink({ value: 'auto' })).toEqual({
			user: [[{ query: '@lang:python interpreters.startupBehavior', revealSetting: { key: '[python]' } }]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the Startup Behavior setting for all languages for its start reason', async () => {
		expect(await clickStartupBehaviorLink({ value: 'auto' }, SessionStartReasonId.StartupBehaviorAlwaysAllLanguages)).toEqual({
			user: [[{ query: 'interpreters.startupBehavior', revealSetting: { key: 'interpreters.startupBehavior' } }]],
			remote: [],
			workspace: [],
		});
	});

	it('links to the Startup Behavior setting right after the start reason', () => {
		renderPopup('', SessionStartReasonId.StartupBehaviorAlways);

		const reasonLine = screen.getByTestId('session-start-reason');
		expect(reasonLine).toHaveTextContent(/^Start Reason: Startup Behavior is set to "Always" for Python\. You can change the startup behavior in settings$/);
		expect(within(reasonLine).getByRole('link', { name: 'You can change the startup behavior in settings' })).toBeInTheDocument();
	});

	it('omits the Startup Behavior setting link for other start reasons', () => {
		renderPopup('', SessionStartReasonId.UserSelectedRuntime);

		expect(screen.queryByRole('link', { name: 'You can change the startup behavior in settings' })).not.toBeInTheDocument();
	});

	it('omits the start reason line when the session has no start reason ID', () => {
		// Sessions persisted before start reason IDs existed only have a description.
		renderPopup('Affiliated Python runtime for workspace');

		expect(screen.queryByTestId('session-start-reason')).not.toBeInTheDocument();
	});
});
