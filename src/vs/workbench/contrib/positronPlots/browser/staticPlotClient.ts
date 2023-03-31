/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Creates a static plot client from a language runtime message.
 */
export class StaticPlotClient {
	public readonly id;
	public readonly mimeType;
	public readonly data;

	constructor(message: ILanguageRuntimeMessageOutput) {
		this.id = message.id;

		// Find the image MIME type. This is guaranteed to exist since we only create this object if
		// there is an image, but check anyway to be safe.
		const imageKey = Object.keys(message.data).find(key => key.startsWith('image/'));
		if (!imageKey) {
			throw new Error(`No image/ MIME type found in message data. ` +
				`Found MIME types: ${Object.keys(message.data).join(', ')}`);
		}
		this.mimeType = imageKey!;
		this.data = message.data[imageKey!];
	}

	get uri() {
		return `data:${this.mimeType};base64,${this.data}`;
	}
}
