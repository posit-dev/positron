/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, decodeBase64, encodeBase64 } from 'vs/base/common/buffer';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const INotebookDocumentService = createDecorator<INotebookDocumentService>('notebookDocumentService');

export interface INotebookDocument {
	readonly uri: URI;
	getCellIndex(cellUri: URI): number | undefined;
}

const _lengths = ['W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f'];
const _padRegexp = new RegExp(`^[${_lengths.join('')}]+`);
const _radix = 7;
export function parse(cell: URI): { notebook: URI; handle: number } | undefined {
	if (cell.scheme !== Schemas.vscodeNotebookCell) {
		return undefined;
	}

	const idx = cell.fragment.indexOf('s');
	if (idx < 0) {
		return undefined;
	}

	const handle = parseInt(cell.fragment.substring(0, idx).replace(_padRegexp, ''), _radix);
	const _scheme = decodeBase64(cell.fragment.substring(idx + 1)).toString();

	if (isNaN(handle)) {
		return undefined;
	}
	return {
		handle,
		notebook: cell.with({ scheme: _scheme, fragment: null })
	};
}

export function generate(notebook: URI, handle: number): URI {

	const s = handle.toString(_radix);
	const p = s.length < _lengths.length ? _lengths[s.length - 1] : 'z';

	const fragment = `${p}${s}s${encodeBase64(VSBuffer.fromString(notebook.scheme), true, true)}`;
	return notebook.with({ scheme: Schemas.vscodeNotebookCell, fragment });
}

export interface INotebookDocumentService {
	readonly _serviceBrand: undefined;

	getNotebook(uri: URI): INotebookDocument | undefined;
	addNotebookDocument(document: INotebookDocument): void;
	removeNotebookDocument(document: INotebookDocument): void;
}

export class NotebookDocumentWorkbenchService implements INotebookDocumentService {
	declare readonly _serviceBrand: undefined;

	private readonly _documents = new ResourceMap<INotebookDocument>();

	getNotebook(uri: URI): INotebookDocument | undefined {
		if (uri.scheme === Schemas.vscodeNotebookCell) {
			const cellUri = parse(uri);
			if (cellUri) {
				const document = this._documents.get(cellUri.notebook);
				if (document) {
					return document;
				}
			}
		}

		return this._documents.get(uri);
	}

	addNotebookDocument(document: INotebookDocument) {
		this._documents.set(document.uri, document);
	}

	removeNotebookDocument(document: INotebookDocument) {
		this._documents.delete(document.uri);
	}

}

registerSingleton(INotebookDocumentService, NotebookDocumentWorkbenchService, InstantiationType.Delayed);
