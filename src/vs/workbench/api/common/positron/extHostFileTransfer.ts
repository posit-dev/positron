/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { ExtHostFileTransferShape } from './extHost.positron.protocol.js';

export class ExtHostFileTransfer extends Disposable implements ExtHostFileTransferShape {

	private readonly _onDidUploadFile = this._register(new Emitter<vscode.Uri>());
	readonly onDidUploadFile: Event<vscode.Uri> = this._onDidUploadFile.event;

	private readonly _onDidDownloadFile = this._register(new Emitter<vscode.Uri>());
	readonly onDidDownloadFile: Event<vscode.Uri> = this._onDidDownloadFile.event;

	$onDidUploadFile(resource: UriComponents): void {
		this._onDidUploadFile.fire(URI.revive(resource));
	}

	$onDidDownloadFile(resource: UriComponents): void {
		this._onDidDownloadFile.fire(URI.revive(resource));
	}
}
