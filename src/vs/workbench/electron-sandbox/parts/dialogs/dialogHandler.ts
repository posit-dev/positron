/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { fromNow } from 'vs/base/common/date';
import { isLinuxSnap } from 'vs/base/common/platform';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { AbstractDialogHandler, IConfirmation, IConfirmationResult, IPrompt, IAsyncPromptResult } from 'vs/platform/dialogs/common/dialogs';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/common/native';
import { IProductService } from 'vs/platform/product/common/productService';
import { process } from 'vs/base/parts/sandbox/electron-sandbox/globals';

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
			checkboxChecked: prompt.checkbox?.checked
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
			checkboxChecked: confirmation.checkbox?.checked
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
				"{0}\nElectron: {1}\nElectronBuildId: {2}\nChromium: {3}\nNode.js: {4}\nV8: {5}\nOS: {6}",
				productDetail,
				process.versions['electron'],
				process.versions['microsoft-build'],
				process.versions['chrome'],
				process.versions['node'],
				process.versions['v8'],
				`${osProps.type} ${osProps.arch} ${osProps.release}${isLinuxSnap ? ' snap' : ''}`
			);
			// --- End Positron ---
		};

		const detail = detailString(true);
		const detailToCopy = detailString(false);

		const { response } = await this.nativeHostService.showMessageBox({
			type: 'info',
			message: this.productService.nameLong,
			detail: `\n${detail}`,
			buttons: [
				localize({ key: 'copy', comment: ['&& denotes a mnemonic'] }, "&&Copy"),
				localize('okButton', "OK")
			]
		});

		if (response === 0) {
			this.clipboardService.writeText(detailToCopy);
		}
	}
}
