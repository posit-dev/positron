/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { fromNow } from '../../../../base/common/date.js';
import { isLinuxSnap } from '../../../../base/common/platform.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { AbstractDialogHandler, IConfirmation, IConfirmationResult, IPrompt, IAsyncPromptResult } from '../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { process } from '../../../../base/parts/sandbox/electron-sandbox/globals.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';

export class NativeDialogHandler extends AbstractDialogHandler {

	constructor(
		@ILogService private readonly logService: ILogService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IProductService private readonly productService: IProductService,
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super();
	}

	async prompt<T>(prompt: IPrompt<T>): Promise<IAsyncPromptResult<T>> {
		this.logService.trace('DialogService#prompt', prompt.message);

		const buttons = this.getPromptButtons(prompt);

		const { response, checkboxChecked } = await this.nativeHostService.showMessageBox({
			type: this.getDialogType(prompt.type),
			title: prompt.title,
			message: prompt.message,
			detail: prompt.detail,
			buttons,
			cancelId: prompt.cancelButton ? buttons.length - 1 : -1 /* Disabled */,
			checkboxLabel: prompt.checkbox?.label,
			checkboxChecked: prompt.checkbox?.checked,
			targetWindowId: getActiveWindow().vscodeWindowId
		});

		return this.getPromptResult(prompt, response, checkboxChecked);
	}

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.logService.trace('DialogService#confirm', confirmation.message);

		const buttons = this.getConfirmationButtons(confirmation);

		const { response, checkboxChecked } = await this.nativeHostService.showMessageBox({
			type: this.getDialogType(confirmation.type) ?? 'question',
			title: confirmation.title,
			message: confirmation.message,
			detail: confirmation.detail,
			buttons,
			cancelId: buttons.length - 1,
			checkboxLabel: confirmation.checkbox?.label,
			checkboxChecked: confirmation.checkbox?.checked,
			targetWindowId: getActiveWindow().vscodeWindowId
		});

		return { confirmed: response === 0, checkboxChecked };
	}

	input(): never {
		throw new Error('Unsupported'); // we have no native API for password dialogs in Electron
	}

	async about(): Promise<void> {
		// --- Start Positron ---
		let version = this.productService.positronVersion;
		// --- End Positron ---
		if (this.productService.target) {
			version = `${version} (${this.productService.target} setup)`;
		} else if (this.productService.darwinUniversalAssetId) {
			version = `${version} (Universal)`;
		}

		const osProps = await this.nativeHostService.getOSProperties();

		const detailString = (useAgo: boolean): string => {
			// --- Start Positron ---
			// Note: This is heavily modified from the original Code - OSS
			// version because there is a limit of 10 placeholders in localization strings,
			// and we need 12 of them.
			const productDetail = localize({ key: 'productDetail', comment: ['Product version details; Code - OSS needs no translation'] },
				"{0} Version: {1} build {2}\nCode - OSS Version: {3}\nCommit: {4}\nDate: {5}",
				this.productService.nameLong,
				version,
				this.productService.positronBuildNumber,
				this.productService.version || 'Unknown',
				this.productService.commit || 'Unknown',
				this.productService.date ? `${this.productService.date}${useAgo ? ' (' + fromNow(new Date(this.productService.date), true) + ')' : ''}` : 'Unknown',
			);
			return localize({ key: 'aboutDetail', comment: ['Electron, Chromium, Node.js and V8 are product names that need no translation'] },
				"{0}\nElectron: {1}\nChromium: {2}\nNode.js: {3}\nV8: {4}\nOS: {5}",
				productDetail,
				process.versions['electron'],
				process.versions['chrome'],
				process.versions['node'],
				process.versions['v8'],
				`${osProps.type} ${osProps.arch} ${osProps.release}${isLinuxSnap ? ' snap' : ''}`
			);
			// --- End Positron ---
		};
		// --- Start Positron ---
		const aboutProductHeader = localize({ key: 'aboutProductHeader', comment: ['Header for the about dialog'] },
			"{0} by {1}",
			this.productService.nameLong,
			this.productService.companyName
		);
		// --- End Positron ---

		const detail = detailString(true);
		const detailToCopy = detailString(false);

		const { response } = await this.nativeHostService.showMessageBox({
			type: 'info',
			// --- Start Positron ---
			message: aboutProductHeader,
			// --- End Positron ---
			detail: `\n${detail}`,
			buttons: [
				localize({ key: 'copy', comment: ['&& denotes a mnemonic'] }, "&&Copy"),
				localize('okButton', "OK")
			],
			targetWindowId: getActiveWindow().vscodeWindowId
		});

		if (response === 0) {
			this.clipboardService.writeText(detailToCopy);
		}
	}
}
