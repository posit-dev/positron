/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IElementData } from '../../../../platform/browserView/common/browserView.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { createElementContextValue } from '../../browserView/electron-browser/features/browserEditorChatFeatures.js';
import { attachToPositAssistant, NewChatFile } from '../../positronAssistant/browser/positAssistantChat.js';
import { IPositronPreviewService } from '../browser/positronPreviewSevice.js';
import { POSITRON_PREVIEW_ACTION_CATEGORY, POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT, POSITRON_VIEWER_IS_INTEGRATED_BROWSER, VIEWER_BROWSER_COMMANDS } from '../browser/positronPreviewActions.js';
import { IPreviewSurface } from '../browser/previewSurface.js';

/** Whether to attach a screenshot of an element, as upstream's integrated browser does. */
const ATTACH_ELEMENT_IMAGES_SETTING = 'workbench.browser.sendElementsToChat.attachImages';

/** Remembers that the user doesn't want to be warned about untrusted pages again. */
const DONT_WARN_KEY = 'positronViewer.assistantContentWarning.dontAsk';

const category = { value: POSITRON_PREVIEW_ACTION_CATEGORY, original: 'Viewer' };

function textFile(name: string, text: string): NewChatFile {
	return { uri: `data:text/plain;base64,${encodeBase64(VSBuffer.fromString(text))}`, name };
}

function pngFile(name: string, png: VSBuffer): NewChatFile {
	return { uri: `data:image/png;base64,${encodeBase64(png)}`, name };
}

/** A short name for an element, from its tag, ID and classes, such as `button#go.primary`. */
function elementName(data: IElementData): string {
	const element = data.ancestors?.at(-1);
	if (!element) {
		return 'element';
	}
	return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classNames?.length ? `.${element.classNames.join('.')}` : ''}`;
}

/**
 * Warns that a page may hold instructions meant for the assistant, unless
 * it's local or the user turned the warning off.
 *
 * @returns Whether to go ahead.
 */
async function confirmContentRisk(storageService: IStorageService, dialogService: IDialogService, url: string | undefined): Promise<boolean> {
	if (storageService.getBoolean(DONT_WARN_KEY, StorageScope.PROFILE)) {
		return true;
	}
	try {
		const { hostname } = new URL(url ?? '');
		if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
			return true;
		}
	} catch {
		// Not a URL: warn.
	}
	const result = await dialogService.confirm({
		type: 'warning',
		message: localize('positron.viewer.assistantContentWarning.message', "Use caution when adding content from untrusted pages."),
		detail: localize('positron.viewer.assistantContentWarning.detail', "Pages may contain hidden instructions that can influence the assistant. Check what's added before sending it."),
		primaryButton: localize('positron.viewer.assistantContentWarning.ok', "&&OK"),
		checkbox: { label: localize('positron.viewer.assistantContentWarning.dontShowAgain', "Don't show again"), checked: false },
	});
	if (result.confirmed && result.checkboxChecked) {
		storageService.store(DONT_WARN_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
	}
	return result.confirmed;
}

/** What adding content to Posit Assistant needs. */
interface ISendServices {
	readonly commandService: ICommandService;
	readonly notificationService: INotificationService;
	readonly logService: ILogService;
	readonly storageService: IStorageService;
	readonly dialogService: IDialogService;
}

function sendServices(accessor: ServicesAccessor): ISendServices {
	return {
		commandService: accessor.get(ICommandService),
		notificationService: accessor.get(INotificationService),
		logService: accessor.get(ILogService),
		storageService: accessor.get(IStorageService),
		dialogService: accessor.get(IDialogService),
	};
}

/** Adds content from the Viewer to Posit Assistant, after the warning for untrusted pages. */
async function send(services: ISendServices, url: string | undefined, attachment: { text?: string; files: NewChatFile[]; fallbackPrompt: string }): Promise<void> {
	if (await confirmContentRisk(services.storageService, services.dialogService, url)) {
		await attachToPositAssistant(services.commandService, services.notificationService, services.logService, attachment);
	}
}

/** The surface of the content the Viewer shows, if it's the integrated browser. */
function activeBrowser(accessor: ServicesAccessor): IPreviewSurface | undefined {
	const surface = accessor.get(IPositronPreviewService).activePreviewWebview?.surface;
	return surface?.kind === 'browser' ? surface : undefined;
}

/**
 * Sends the elements the user picks or comments on in the Viewer to Posit
 * Assistant.
 */
export class ViewerAssistantContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronViewerAssistant';

	private readonly _selection = this._register(new MutableDisposable());
	private readonly _services: ISendServices;

	constructor(
		@IPositronPreviewService previewService: IPositronPreviewService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ICommandService commandService: ICommandService,
		@INotificationService notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService storageService: IStorageService,
		@IDialogService dialogService: IDialogService,
	) {
		super();
		this._services = { commandService, notificationService, logService: _logService, storageService, dialogService };
		const listen = () => {
			const surface = previewService.activePreviewWebview?.surface;
			this._selection.value = surface?.onDidSelectElement(data => {
				this.sendElement(surface, data).catch(error => this._logService.error('[Viewer] Failed to add an element to Posit Assistant', error));
			});
		};
		listen();
		this._register(previewService.onDidChangeActivePreviewWebview(listen));
	}

	private async sendElement(surface: IPreviewSurface, data: IElementData): Promise<void> {
		const name = elementName(data);
		const files = [textFile(`${name}.txt`, createElementContextValue(data, name))];
		if (this._configurationService.getValue<boolean>(ATTACH_ELEMENT_IMAGES_SETTING)) {
			const image = await surface.captureScreenshot({ rect: data.bounds }).catch(() => undefined);
			if (image) {
				files.push(pngFile(`${name}.png`, image.data));
			}
		}
		const text = data.comment !== undefined ? `${name}: ${data.comment}` : undefined;
		await send(this._services, data.url ?? await surface.getCurrentUrl(), {
			text,
			files,
			fallbackPrompt: localize('positron.viewer.assistant.elementPrompt', "Here is an element from the page in the Viewer."),
		});
		// The comment is in the chat now, so take its pin off the page.
		if (data.comment !== undefined && data.elementId) {
			surface.discardElementComment(data.elementId);
		}
	}
}

export class AddViewerElementAction extends Action2 {
	constructor() {
		super({
			id: VIEWER_BROWSER_COMMANDS.addElement,
			title: localize2('positronViewerAddElement', "Add Element to Posit Assistant"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeBrowser(accessor)?.toggleElementSelection('select');
	}
}

export class CommentOnViewerElementAction extends Action2 {
	constructor() {
		super({
			id: VIEWER_BROWSER_COMMANDS.commentOnElement,
			title: localize2('positronViewerCommentOnElement', "Comment on Elements for Posit Assistant"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeBrowser(accessor)?.toggleElementSelection('comment');
	}
}

export class AddViewerScreenshotAction extends Action2 {
	constructor() {
		super({
			id: VIEWER_BROWSER_COMMANDS.addScreenshot,
			title: localize2('positronViewerAddScreenshot', "Add Screenshot to Posit Assistant"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const surface = activeBrowser(accessor);
		if (!surface) {
			return;
		}
		const services = sendServices(accessor);
		const capture = await surface.captureScreenshot();
		await send(services, await surface.getCurrentUrl(), {
			files: [pngFile('viewer-screenshot.png', capture.data)],
			fallbackPrompt: localize('positron.viewer.assistant.screenshotPrompt', "Here is a screenshot of the page in the Viewer."),
		});
	}
}

export class AddViewerConsoleLogsAction extends Action2 {
	constructor() {
		super({
			id: VIEWER_BROWSER_COMMANDS.addConsoleLogs,
			title: localize2('positronViewerAddConsoleLogs', "Add Console Logs to Posit Assistant"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const surface = activeBrowser(accessor);
		if (!surface) {
			return;
		}
		const services = sendServices(accessor);
		const logs = await surface.getConsoleLogs();
		await send(services, await surface.getCurrentUrl(), {
			files: [textFile('console.txt', logs || localize('positron.viewer.assistant.noLogs', "(The page has logged nothing.)"))],
			fallbackPrompt: localize('positron.viewer.assistant.consolePrompt', "Here are the console logs of the page in the Viewer."),
		});
	}
}

export class ToggleViewerDevToolsAction extends Action2 {
	constructor() {
		super({
			id: VIEWER_BROWSER_COMMANDS.toggleDevTools,
			title: localize2('positronViewerToggleDevTools', "Toggle Developer Tools"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_IS_INTEGRATED_BROWSER,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await activeBrowser(accessor)?.toggleDevTools();
	}
}
