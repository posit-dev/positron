/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IElementData } from '../../../../../platform/browserView/common/browserView.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronPreviewService } from '../../browser/positronPreviewSevice.js';
import { IPreviewSurface } from '../../browser/previewSurface.js';
import { PreviewWebview } from '../../browser/previewWebview.js';
import { ViewerAssistantContribution } from '../../electron-browser/viewerAssistant.js';

describe('ViewerAssistantContribution', () => {
	const selectElement = new Emitter<IElementData>();
	const discardElementComment = vi.fn();
	const executeCommand = vi.fn(async () => undefined);
	const confirm = vi.fn(async () => ({ confirmed: false }));

	const ctx = createLightTestContainer()
		.stub(IPositronPreviewService, {
			activePreviewWebview: stubInterface<PreviewWebview>({
				surface: stubInterface<IPreviewSurface>({
					onDidSelectElement: selectElement.event,
					getCurrentUrl: async () => undefined,
					discardElementComment,
				}),
			}),
			onDidChangeActivePreviewWebview: Event.None,
		})
		.stub(IConfigurationService, new TestConfigurationService({ workbench: { browser: { sendElementsToChat: { attachImages: false } } } }))
		.stub(ICommandService, { executeCommand })
		.stub(IDialogService, { confirm })
		.stub(INotificationService, { error: vi.fn() })
		.stub(ILogService, new NullLogService())
		.stub(IStorageService, new InMemoryStorageService())
		.build();

	afterAll(() => selectElement.dispose());

	function element(url: string, comment?: string): IElementData {
		return {
			url,
			outerHTML: '<button id="go">Go</button>',
			computedStyle: 'color: red;',
			bounds: { x: 0, y: 0, width: 10, height: 10 },
			ancestors: [{ tagName: 'BUTTON', id: 'go', classNames: [] }],
			comment,
			elementId: comment === undefined ? undefined : 'c1',
		};
	}

	it('adds a comment on a local page to Posit Assistant, and takes its pin off the page', async () => {
		ctx.disposables.add(ctx.instantiationService.createInstance(ViewerAssistantContribution));

		selectElement.fire(element('http://localhost:8000/', 'Make it bigger'));
		await vi.waitFor(() => expect(discardElementComment).toHaveBeenCalledWith('c1'));

		const [command, options] = executeCommand.mock.calls[0] as unknown as [string, { prompt: string; target: string; behavior: string; files: { uri: string; name: string }[] }];
		const attached = decodeBase64(options.files[0].uri.split(',')[1]).toString();
		expect({ command, prompt: options.prompt, behavior: options.behavior, file: options.files[0].name, attached: attached.split('\n\n').slice(0, 3), confirmed: confirm.mock.calls.length }).toEqual({
			command: 'posit-assistant.newChat',
			prompt: 'button#go: Make it bigger',
			behavior: 'append',
			file: 'button#go.txt',
			attached: ['Attached Element Context from Integrated Browser', 'Element: button#go', 'URL: http://localhost:8000/'],
			confirmed: 0,
		});
	});

	it('warns before adding an element from a page that isn\'t local, and adds nothing if the user cancels', async () => {
		ctx.disposables.add(ctx.instantiationService.createInstance(ViewerAssistantContribution));

		selectElement.fire(element('https://example.com/'));
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());

		expect(executeCommand).not.toHaveBeenCalled();
	});
});
