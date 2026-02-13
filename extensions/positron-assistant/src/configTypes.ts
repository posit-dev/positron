/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as positron from 'positron';

export interface StoredModelConfig extends Omit<positron.ai.LanguageModelConfig, 'apiKey'> {
	id: string;
}

export interface ModelConfig extends StoredModelConfig {
	apiKey: string;
}
