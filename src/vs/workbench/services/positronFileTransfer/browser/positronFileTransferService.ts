/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronFileTransferService } from '../common/positronFileTransferService.js';

export class PositronFileTransferService extends Disposable implements IPositronFileTransferService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidUploadFile = this._register(new Emitter<URI>());
	readonly onDidUploadFile: Event<URI> = this._onDidUploadFile.event;

	private readonly _onDidDownloadFile = this._register(new Emitter<URI>());
	readonly onDidDownloadFile: Event<URI> = this._onDidDownloadFile.event;

	notifyFileUploaded(resource: URI): void {
		this._onDidUploadFile.fire(resource);
	}

	notifyFileDownloaded(resource: URI): void {
		this._onDidDownloadFile.fire(resource);
	}
}

registerSingleton(IPositronFileTransferService, PositronFileTransferService, InstantiationType.Delayed);
