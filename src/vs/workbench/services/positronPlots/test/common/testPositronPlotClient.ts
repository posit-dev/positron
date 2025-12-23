/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../../base/common/uuid.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IPositronPlotClient, ZoomLevel } from '../../common/positronPlots.js';
import { IPositronPlotMetadata } from '../../../languageRuntime/common/languageRuntimePlotClient.js';

/**
 * TestPositronPlotClient class.
 *
 * This is an implementation of the IPositronPlotClient for use in tests.
 */
export class TestPositronPlotClient extends Disposable implements IPositronPlotClient {
	/**
	 * Creates a new instance of the TestPositronPlotClient class.
	 * @param metadata The metadata for the plot client. If not provided, minimal default metadata will be created.
	 */
	constructor(
		public readonly metadata: IPositronPlotMetadata = {
			id: generateUuid(),
			session_id: 'test-session',
			created: Date.now(),
			code: 'test code',
			zoom_level: ZoomLevel.Fit,
		}
	) {
		super();
	}

	/**
	 * Gets the ID of the plot client.
	 */
	get id(): string {
		return this.metadata.id;
	}
}
