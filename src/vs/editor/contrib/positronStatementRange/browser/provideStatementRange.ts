/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageFeatureRegistry } from '../../../common/languageFeatureRegistry.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import * as languages from '../../../common/languages.js';
import { onUnexpectedExternalError } from '../../../../base/common/errors.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { assertType } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { IPosition, Position } from '../../../common/core/position.js';
import { ITextModel } from '../../../common/model.js';
import { IModelService } from '../../../common/services/model.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';


async function provideStatementRange(
	registry: LanguageFeatureRegistry<languages.StatementRangeProvider>,
	model: ITextModel,
	position: Position,
	token: CancellationToken
): Promise<languages.IStatementRange | undefined> {

	const providers = registry.ordered(model);

	for (const provider of providers) {
		try {
			const result = await provider.provideStatementRange(model, position, token);
			if (result) {
				return result;
			}
		} catch (err) {
			onUnexpectedExternalError(err);
		}
	}
	return undefined;
}

CommandsRegistry.registerCommand('_executeStatementRangeProvider', async (accessor, ...args: [URI, IPosition]) => {
	const [uri, position] = args;
	assertType(URI.isUri(uri));
	assertType(Position.isIPosition(position));

	const model = accessor.get(IModelService).getModel(uri);
	if (!model) {
		return undefined;
	}
	const languageFeaturesService = accessor.get(ILanguageFeaturesService);
	return await provideStatementRange(
		languageFeaturesService.statementRangeProvider,
		model,
		Position.lift(position),
		CancellationToken.None
	);
});
