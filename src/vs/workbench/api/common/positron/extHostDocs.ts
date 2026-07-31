/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IExtHostDocs = createDecorator<IExtHostDocs>('IExtHostDocs');

export interface IExtHostDocs {
	readonly _serviceBrand: undefined;

	/**
	 * Resolve the locally cached docs bundle, or undefined when there are none
	 * and the caller should use the web.
	 */
	getLocalDocs(): Promise<positron.docs.LocalDocs | undefined>;
}

/**
 * Web-worker extension host variant.
 *
 * Returns undefined rather than throwing NotSupportedError, because undefined
 * is already the documented "no local docs, use the web" contract - throwing
 * would force every caller to wrap the call in a try/catch to get the same
 * behaviour. There is nothing to download to: the worker host has no
 * filesystem, and base/node/zip.ts is node-layer only.
 */
export class WorkerExtHostDocs implements IExtHostDocs {
	readonly _serviceBrand: undefined;

	async getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> {
		return undefined;
	}
}
