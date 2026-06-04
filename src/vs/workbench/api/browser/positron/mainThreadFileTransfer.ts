/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IPositronFileTransferService } from '../../../services/positronFileTransfer/common/positronFileTransferService.js';
import { ExtHostFileTransferShape, ExtHostPositronContext, MainPositronContext, MainThreadFileTransferShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadFileTransfer)
export class MainThreadFileTransfer extends Disposable implements MainThreadFileTransferShape {

	private readonly _proxy: ExtHostFileTransferShape;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronFileTransferService private readonly _fileTransferService: IPositronFileTransferService,
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostFileTransfer);

		this._register(this._fileTransferService.onDidUploadFile(resource => {
			this._proxy.$onDidUploadFile(resource);
		}));

		this._register(this._fileTransferService.onDidDownloadFile(resource => {
			this._proxy.$onDidDownloadFile(resource);
		}));
	}
}
