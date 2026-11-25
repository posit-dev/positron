/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatRequestVariableEntry } from '../../../chat/common/attachments/chatVariableEntries.js';
import { entriesToFiles } from '../../electron-browser/positronBrowserChatTarget.js';

describe('entriesToFiles', () => {
	it('turns the integrated browser\'s chat entries into files for Posit Assistant', () => {
		const entries = [
			{ id: 'e', name: 'button#go', kind: 'element', value: 'hi', imageData: new Uint8Array([1]), imageMimeType: 'image/jpeg' },
			{ id: 'c', name: 'Console Logs', kind: 'element', value: '[log] ok' },
			{ id: 's', name: 'Browser Screenshot', kind: 'image', value: new Uint8Array([2]), mimeType: 'image/png' },
		] as IChatRequestVariableEntry[];

		expect(entriesToFiles(entries)).toEqual([
			{ uri: 'data:text/plain;base64,aGk=', name: 'button#go.txt' },
			{ uri: 'data:image/jpeg;base64,AQ==', name: 'button#go.jpg' },
			{ uri: 'data:text/plain;base64,W2xvZ10gb2s=', name: 'Console Logs.txt' },
			{ uri: 'data:image/png;base64,Ag==', name: 'Browser Screenshot.png' },
		]);
	});
});
