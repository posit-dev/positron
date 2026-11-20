/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/positronBrowserChat.css';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IChatRequestVariableEntry } from '../../chat/common/attachments/chatVariableEntries.js';
import { attachToPositAssistant, NewChatFile } from '../../positronAssistant/browser/positAssistantChat.js';

export const IPositronBrowserChatTarget = createDecorator<IPositronBrowserChatTarget>('positronBrowserChatTarget');

/**
 * Where the integrated browser's chat actions (add an element, a comment, a
 * screenshot, console logs) send what they gather: Posit Assistant.
 */
export interface IPositronBrowserChatTarget {
	readonly _serviceBrand: undefined;

	/**
	 * Adds the browser's chat entries to Posit Assistant's input. The caller
	 * has already warned about content from untrusted pages.
	 *
	 * @param comment The user's comment on the element in the entries.
	 * @returns Whether the entries went to Posit Assistant rather than the
	 *   built-in chat: always, as Posit Assistant reports its own failures.
	 */
	attachEntries(entries: readonly IChatRequestVariableEntry[], comment?: string): Promise<boolean>;
}

/** A file name from an entry's name, such as `button#go` or `Browser Screenshot`. */
function fileName(name: string, extension: string): string {
	return `${name.replace(/[\\/:*?"<>|]/g, '_')}.${extension}`;
}

function imageFile(name: string, data: Uint8Array, mimeType: string | undefined): NewChatFile {
	const type = mimeType ?? 'image/png';
	return { uri: `data:${type};base64,${encodeBase64(VSBuffer.wrap(data))}`, name: fileName(name, type === 'image/jpeg' ? 'jpg' : 'png') };
}

/** Turns the browser's chat entries into files Posit Assistant takes. */
export function entriesToFiles(entries: readonly IChatRequestVariableEntry[]): NewChatFile[] {
	const files: NewChatFile[] = [];
	for (const entry of entries) {
		if (entry.kind === 'image' && entry.value instanceof Uint8Array) {
			files.push(imageFile(entry.name, entry.value, entry.mimeType));
		} else if (entry.kind === 'element') {
			files.push({ uri: `data:text/plain;base64,${encodeBase64(VSBuffer.fromString(entry.value))}`, name: fileName(entry.name, 'txt') });
			if (entry.imageData instanceof Uint8Array) {
				files.push(imageFile(entry.name, entry.imageData, entry.imageMimeType));
			}
		}
	}
	return files;
}

class PositronBrowserChatTarget implements IPositronBrowserChatTarget {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async attachEntries(entries: readonly IChatRequestVariableEntry[], comment?: string): Promise<boolean> {
		await attachToPositAssistant(this._commandService, this._notificationService, this._logService, {
			text: comment !== undefined && entries[0] ? `${entries[0].name}: ${comment}` : undefined,
			files: entriesToFiles(entries),
			fallbackPrompt: localize('positron.browser.assistant.prompt', "Here is content from the integrated browser."),
		});
		return true;
	}
}

registerSingleton(IPositronBrowserChatTarget, PositronBrowserChatTarget, InstantiationType.Delayed);
