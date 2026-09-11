/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { IPositronDocsService } from '../../../../../services/positronDocs/browser/positronDocsService.js';
import { EditorGroupWatermark } from '../../editorGroupWatermark.js';

const DOCS_BASE_URL = 'https://positron.posit.co/docs';
const TIPS_ENABLED = 'workbench.tips.enabled';
const SHOW_RELEASE_NOTES_COMMAND = 'update.showCurrentReleaseNotes';

describe('EditorGroupWatermark', () => {
	const open = vi.fn(async (_resource: URI | string) => true);
	const executeCommand = vi.fn(async (_id: string) => undefined);

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IOpenerService, stubInterface<IOpenerService>({ open }))
		.stub(ICommandService, stubInterface<ICommandService>({
			executeCommand: executeCommand as ICommandService['executeCommand'],
		}))
		.stub(IPositronDocsService, stubInterface<IPositronDocsService>({
			baseUrl: DOCS_BASE_URL,
			getUrl: (path?: string) => path ? `${DOCS_BASE_URL}/${path}` : DOCS_BASE_URL,
		}))
		.build();

	function renderWatermark(tipsEnabled: boolean) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration(TIPS_ENABLED, tipsEnabled);

		const container = document.createElement('div');
		ctx.disposables.add(ctx.instantiationService.createInstance(EditorGroupWatermark, container));

		const setTipsEnabled = (enabled: boolean) => {
			configurationService.setUserConfiguration(TIPS_ENABLED, enabled);
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: () => true }));
		};

		// The watermark is a plain DOM class that renders into a detached container,
		// so there is no document-scoped `screen` for Testing Library to query.
		// eslint-disable-next-line no-restricted-syntax -- see comment above
		const actionButtons = () => Array.from(container.querySelectorAll<HTMLElement>('.watermark-action'));

		const buttonLabels = () => actionButtons().map(button => button.textContent);

		const clickButton = (label: string) => {
			const button = actionButtons().find(candidate => candidate.textContent === label);
			if (!button) {
				throw new Error(`No watermark action button labelled "${label}"`);
			}
			button.click();
		};

		return { setTipsEnabled, buttonLabels, clickButton };
	}

	describe('action buttons', () => {
		it('renders the buttons when tips are enabled', () => {
			const { buttonLabels } = renderWatermark(true);

			expect(buttonLabels()).toEqual(['View Documentation', 'Release Notes']);
		});

		it('renders no buttons when tips are disabled', () => {
			const { buttonLabels } = renderWatermark(false);

			expect(buttonLabels()).toEqual([]);
		});

		it('renders each button once after tips are turned off and back on', () => {
			const { setTipsEnabled, buttonLabels } = renderWatermark(true);

			setTipsEnabled(false);
			setTipsEnabled(true);

			expect(buttonLabels()).toEqual(['View Documentation', 'Release Notes']);
		});
	});

	describe('View Documentation', () => {
		it('opens the documentation site', async () => {
			const { clickButton } = renderWatermark(true);

			clickButton('View Documentation');

			await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
			expect(open.mock.calls[0][0].toString()).toBe(DOCS_BASE_URL);
		});
	});

	describe('Release Notes', () => {
		it('runs the release notes command', async () => {
			const { clickButton } = renderWatermark(true);

			clickButton('Release Notes');

			await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledWith(SHOW_RELEASE_NOTES_COMMAND));
			expect(open).not.toHaveBeenCalled();
		});

		it('opens the hosted release notes page when the command fails', async () => {
			// The command is missing on builds without a releaseNotesUrl, and throws
			// when the notes for this version cannot be fetched.
			executeCommand.mockRejectedValueOnce(new Error('no release notes available'));
			const { clickButton } = renderWatermark(true);

			clickButton('Release Notes');

			await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
			expect(open.mock.calls[0][0].toString()).toBe(`${DOCS_BASE_URL}/release-notes.html`);
		});
	});
});
