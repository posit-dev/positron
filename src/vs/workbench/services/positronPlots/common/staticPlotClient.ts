/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Creates a static plot client from a language runtime message.
 */
export class StaticPlotClient extends Disposable {
	public readonly id;
	public readonly mimeType;
	public readonly data;

	constructor(message: ILanguageRuntimeMessageOutput,
		public readonly code?: string) {
		super();
		this.id = message.id;

		// Find the image MIME type. This is guaranteed to exist since we only create this object if
		// there is an image, but check anyway to be safe.
		const imageKey = Object.keys(message.data).find(key => key.startsWith('image/'));
		if (!imageKey) {
			throw new Error(`No image/ MIME type found in message data. ` +
				`Found MIME types: ${Object.keys(message.data).join(', ')}`);
		}

		// Save the MIME type and data for the image.
		this.mimeType = imageKey;
		this.data = message.data[imageKey];
	}

	get uri() {
		return `data:${this.mimeType};base64,${this.data}`;
	}
}
