/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { IPreviewInitData, MainPositronContext, MainThreadPreviewPanelShape } from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import { extHostNamedCustomer } from 'vs/workbench/services/extensions/common/extHostCustomers';

@extHostNamedCustomer(MainPositronContext.MainThreadPreviewPanel)
export class MainThreadPreviewPanel implements MainThreadPreviewPanelShape {
	$createPreviewPanel(extension: WebviewExtensionDescription, handle: string, viewType: string, initData: IPreviewInitData, preserveFocus: boolean): void {
		throw new Error('Method not implemented.');
	}
	$disposePreview(handle: string): void {
		throw new Error('Method not implemented.');
	}
	$reveal(handle: string, preserveFocus: boolean): void {
		throw new Error('Method not implemented.');
	}
	$setTitle(handle: string, value: string): void {
		throw new Error('Method not implemented.');
	}
	dispose(): void {
		throw new Error('Method not implemented.');
	}

}
