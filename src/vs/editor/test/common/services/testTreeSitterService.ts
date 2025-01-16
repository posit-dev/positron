/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Parser } from '@vscode/tree-sitter-wasm';
import { Event } from '../../../../base/common/event.js';
import { ITextModel } from '../../../common/model.js';
import { ITreeSitterParserService, ITreeSitterParseResult, ITextModelTreeSitter } from '../../../common/services/treeSitterParserService.js';
import { Range } from '../../../common/core/range.js';

export class TestTreeSitterParserService implements ITreeSitterParserService {
	getTextModelTreeSitter(textModel: ITextModel): ITextModelTreeSitter | undefined {
		throw new Error('Method not implemented.');
	}
	getTree(content: string, languageId: string): Promise<Parser.Tree | undefined> {
		throw new Error('Method not implemented.');
	}
	onDidUpdateTree: Event<{ textModel: ITextModel; ranges: Range[] }> = Event.None;
	onDidAddLanguage: Event<{ id: string; language: Parser.Language }> = Event.None;
	_serviceBrand: undefined;
	getOrInitLanguage(languageId: string): Parser.Language | undefined {
		throw new Error('Method not implemented.');
	}
	waitForLanguage(languageId: string): Promise<Parser.Language | undefined> {
		throw new Error('Method not implemented.');
	}
	getParseResult(textModel: ITextModel): ITreeSitterParseResult | undefined {
		throw new Error('Method not implemented.');
	}

}
