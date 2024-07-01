/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageFeatureRegistry } from 'vs/editor/common/languageFeatureRegistry';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import * as languages from 'vs/editor/common/languages';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { assertType } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { CancellationToken } from 'vs/base/common/cancellation';


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
