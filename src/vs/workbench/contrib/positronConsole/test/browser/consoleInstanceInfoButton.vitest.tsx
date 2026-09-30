/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
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

	function renderPopup(detail: string, id?: SessionStartReasonId, extensionId = 'positron.positron-python', notebookUri?: URI) {
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
		renderPopup('User selected runtime', SessionStartReasonId.UserSelectedRuntime);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: You selected this interpreter');
	});

	it('names the extension that provides the session\'s interpreter', () => {
		renderPopup('', SessionStartReasonId.ExtensionRecommendedRuntime);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The Python extension recommended starting Python 3.12.4 for this workspace');
	});

	it('names the session\'s language', () => {
		renderPopup('', SessionStartReasonId.LanguageFileOpened);

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: This interpreter was started after a file written in Python was opened');
	});

	it('falls back to the extension ID when the extension is not registered', () => {
		renderPopup('', SessionStartReasonId.ExtensionRecommendedRuntime, 'example.missing');

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The example.missing extension recommended starting Python 3.12.4 for this workspace');
	});

	it('names the session\'s notebook', () => {
		renderPopup('', SessionStartReasonId.NotebookEditorOpened, undefined, URI.file('/work/analysis.ipynb'));

		expect(screen.getByTestId('session-start-reason')).toHaveTextContent('Start Reason: The analysis.ipynb notebook was opened');
	});

	async function clickStartupBehaviorLink(value: IConfigurationValue<string>, id = SessionStartReasonId.StartupBehaviorAlways) {
		const inspect = vi.spyOn(ctx.get(IConfigurationService), 'inspect').mockReturnValue(value);
		const user = userEvent.setup();
		renderPopup('', id);

		await user.click(screen.getByRole('button', { name: 'Open Startup Behavior Setting' }));

		expect(inspect).toHaveBeenCalledWith('interpreters.startupBehavior', { overrideIdentifier: 'python' });
		expect(renderer.dispose).toHaveBeenCalled();
		return {
			user: openUserSettings.mock.calls,
			remote: openRemoteSettings.mock.calls,
			workspace: openWorkspaceSettings.mock.calls,
		};
	}

	const languageOptions = { query: '@lang:python interpreters.startupBehavior', revealSetting: { key: '[python]' } };
	const allLanguagesOptions = { query: 'interpreters.startupBehavior', revealSetting: { key: 'interpreters.startupBehavior' } };

	it('opens the User settings tab when the value comes from user settings', async () => {
		expect(await clickStartupBehaviorLink({ userLocal: { override: 'always' }, value: 'always' })).toEqual({
			user: [[languageOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the Remote settings tab when the value comes from remote user settings', async () => {
		expect(await clickStartupBehaviorLink({ userRemote: { override: 'always' }, value: 'always' })).toEqual({
			user: [],
			remote: [[languageOptions]],
			workspace: [],
		});
	});

	it('opens the Workspace settings tab when the value comes from workspace settings', async () => {
		expect(await clickStartupBehaviorLink({ workspace: { override: 'always' }, value: 'always' })).toEqual({
			user: [],
			remote: [],
			workspace: [[languageOptions]],
		});
	});

	it('opens the tab with the language-specific value over a tab with a value for all languages', async () => {
		// A language-specific user value wins over a workspace value for all languages.
		expect(await clickStartupBehaviorLink({ workspace: { value: 'auto' }, userLocal: { override: 'always' }, value: 'always' })).toEqual({
			user: [[languageOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the Workspace settings tab over the User settings tab when both set a language-specific value', async () => {
		expect(await clickStartupBehaviorLink({ workspace: { override: 'always' }, userLocal: { override: 'manual' }, value: 'always' })).toEqual({
			user: [],
			remote: [],
			workspace: [[languageOptions]],
		});
	});

	it('opens the Remote settings tab over the User settings tab when both set a language-specific value', async () => {
		expect(await clickStartupBehaviorLink({ userRemote: { override: 'always' }, userLocal: { override: 'manual' }, value: 'always' })).toEqual({
			user: [],
			remote: [[languageOptions]],
			workspace: [],
		});
	});

	it('opens the User settings tab for the start reason\'s setting when no tab sets a value', async () => {
		// Such as when the setting changed after the session started.
		expect(await clickStartupBehaviorLink({ value: 'auto' }, SessionStartReasonId.StartupBehaviorAlwaysAllLanguages)).toEqual({
			user: [[allLanguagesOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the setting for all languages when the value is set for all languages', async () => {
		expect(await clickStartupBehaviorLink({ userLocal: { value: 'always' }, value: 'always' }, SessionStartReasonId.StartupBehaviorAlwaysAllLanguages)).toEqual({
			user: [[allLanguagesOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('omits the Startup Behavior setting link for other start reasons', () => {
		renderPopup('', SessionStartReasonId.UserSelectedRuntime);

		expect(screen.queryByRole('button', { name: 'Open Startup Behavior Setting' })).not.toBeInTheDocument();
	});

	it('omits the start reason line when the session has no start reason ID', () => {
		// Sessions persisted before start reason IDs existed only have a description.
		renderPopup('Affiliated Python runtime for workspace');

		expect(screen.queryByTestId('session-start-reason')).not.toBeInTheDocument();
	});
});
