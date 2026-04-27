/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createTestContainer } from '../../../../../../test/browser/positronTestContainer.js';
import {
	ITranslationProvider,
	SUPPORTED_LANGUAGES,
	isKnownLanguageCode,
	getLanguageLabel,
} from '../../../../browser/contrib/translate/translationLanguages.js';
import { splitMarkdown, extractTranslatable, applyTranslated, reassemble } from '../../../../browser/contrib/translate/markdownProtection.js';
import { detectLanguageFromFilename, stripLanguageSuffixes } from '../../../../browser/contrib/translate/positronNotebookTranslate.contribution.js';

class MockTranslationProvider implements ITranslationProvider {
	calls: { text: string; sourceLanguage: string; targetLanguage: string }[] = [];

	async translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
		this.calls.push({ text, sourceLanguage, targetLanguage });
		return `[${sourceLanguage}->${targetLanguage}] ${text}`;
	}
}

suite('notebookTranslate', () => {
	createTestContainer().build();

	suite('translation provider', () => {
		test('supported languages includes English', () => {
			assert.ok(SUPPORTED_LANGUAGES.some(l => l.code === 'en'));
		});

		test('supported languages list has multiple entries', () => {
			assert.ok(SUPPORTED_LANGUAGES.length >= 2);
		});

		test('mock provider receives source and target language', async () => {
			const mock = new MockTranslationProvider();

			await mock.translate('hello', 'en', 'pt');
			assert.strictEqual(mock.calls.length, 1);
			assert.strictEqual(mock.calls[0].sourceLanguage, 'en');
			assert.strictEqual(mock.calls[0].targetLanguage, 'pt');
		});

		test('each supported language has matching id and code', () => {
			for (const lang of SUPPORTED_LANGUAGES) {
				assert.strictEqual(lang.id, lang.code);
				assert.ok(lang.label.length > 0);
			}
		});
	});

	suite('isKnownLanguageCode', () => {
		test('recognizes supported language codes', () => {
			for (const lang of SUPPORTED_LANGUAGES) {
				assert.strictEqual(isKnownLanguageCode(lang.code), true, `${lang.code} should be recognized`);
			}
		});

		test('rejects unknown codes', () => {
			assert.strictEqual(isKnownLanguageCode('zz'), false);
			assert.strictEqual(isKnownLanguageCode(''), false);
			assert.strictEqual(isKnownLanguageCode('english'), false);
		});

		test('is case-sensitive', () => {
			assert.strictEqual(isKnownLanguageCode('EN'), false);
			assert.strictEqual(isKnownLanguageCode('Pt'), false);
		});
	});

	suite('detectLanguageFromFilename', () => {
		test('detects language code at end of filename', () => {
			assert.strictEqual(detectLanguageFromFilename('notebook-pt'), 'pt');
			assert.strictEqual(detectLanguageFromFilename('my-analysis-es'), 'es');
		});

		test('returns undefined for no language suffix', () => {
			assert.strictEqual(detectLanguageFromFilename('notebook'), undefined);
			assert.strictEqual(detectLanguageFromFilename('my-analysis'), undefined);
		});

		test('returns undefined for unknown suffix', () => {
			assert.strictEqual(detectLanguageFromFilename('notebook-zz'), undefined);
		});

		test('handles names with multiple dashes', () => {
			assert.strictEqual(detectLanguageFromFilename('my-cool-notebook-fr'), 'fr');
		});

		test('returns undefined for empty string', () => {
			assert.strictEqual(detectLanguageFromFilename(''), undefined);
		});

		test('does not detect language code at start', () => {
			assert.strictEqual(detectLanguageFromFilename('en-notebook'), undefined);
		});

		test('detects last suffix only', () => {
			assert.strictEqual(detectLanguageFromFilename('notebook-en-pt'), 'pt');
		});
	});

	suite('stripLanguageSuffixes', () => {
		test('strips single language suffix', () => {
			assert.strictEqual(stripLanguageSuffixes('notebook-pt'), 'notebook');
		});

		test('strips accumulated language suffixes', () => {
			assert.strictEqual(stripLanguageSuffixes('notebook-pt-es'), 'notebook');
			assert.strictEqual(stripLanguageSuffixes('notebook-en-pt-es-fr'), 'notebook');
		});

		test('preserves names without language suffix', () => {
			assert.strictEqual(stripLanguageSuffixes('notebook'), 'notebook');
			assert.strictEqual(stripLanguageSuffixes('my-analysis'), 'my-analysis');
		});

		test('preserves non-language dashed parts', () => {
			assert.strictEqual(stripLanguageSuffixes('my-cool-notebook-fr'), 'my-cool-notebook');
		});

		test('does not strip the entire name', () => {
			assert.strictEqual(stripLanguageSuffixes('en'), 'en');
			assert.strictEqual(stripLanguageSuffixes('pt'), 'pt');
		});

		test('stops stripping at non-language part', () => {
			assert.strictEqual(stripLanguageSuffixes('my-analysis-data-pt'), 'my-analysis-data');
		});
	});

	suite('end-to-end translation pipeline', () => {
		test('translates prose, preserves inline code', async () => {
			const mock = new MockTranslationProvider();

			const md = 'Use `console.log()` to debug.';
			const segments = splitMarkdown(md);
			const { text, indices } = extractTranslatable(segments);
			const translated = await mock.translate(text, 'en', 'es');
			const result = reassemble(applyTranslated(segments, translated, indices));

			assert.ok(result.includes('`console.log()`'));
			assert.ok(result.includes('[en->es]'));
		});

		test('translates prose, preserves inline math', async () => {
			const mock = new MockTranslationProvider();

			const md = 'The formula $E = mc^2$ is important.';
			const segments = splitMarkdown(md);
			const { text, indices } = extractTranslatable(segments);
			const translated = await mock.translate(text, 'en', 'pt');
			const result = reassemble(applyTranslated(segments, translated, indices));

			assert.ok(result.includes('$E = mc^2$'));
		});

		test('translates prose, preserves headings', async () => {
			const mock = new MockTranslationProvider();

			const md = '### My heading';
			const segments = splitMarkdown(md);
			const { text, indices } = extractTranslatable(segments);
			const translated = await mock.translate(text, 'en', 'pt');
			const result = reassemble(applyTranslated(segments, translated, indices));

			assert.ok(result.startsWith('### '));
		});

		test('translates prose, preserves list markers', async () => {
			const mock = new MockTranslationProvider();

			const md = '- item one\n- item two';
			const segments = splitMarkdown(md);
			const { text, indices } = extractTranslatable(segments);
			const translated = await mock.translate(text, 'en', 'de');
			const result = reassemble(applyTranslated(segments, translated, indices));

			const lines = result.split('\n');
			assert.ok(lines[0].startsWith('- '));
			assert.ok(lines[1].startsWith('- '));
		});

		test('code cells are not affected by splitMarkdown', () => {
			const code = 'import pandas as pd\ndf = pd.read_csv("data.csv")\ndf.head()';
			const segments = splitMarkdown(code);
			const result = reassemble(segments);
			assert.strictEqual(result, code);
		});

		test('applyTranslated handles fewer translated segments gracefully', () => {
			const segments = splitMarkdown('Hello world\nGoodbye world');
			const { indices } = extractTranslatable(segments);
			const result = applyTranslated(segments, 'Hola mundo', indices);
			const output = reassemble(result);
			assert.ok(output.includes('Hola mundo'));
		});

		test('applyTranslated handles extra translated segments gracefully', () => {
			const segments = splitMarkdown('Hello');
			const { indices } = extractTranslatable(segments);
			const result = applyTranslated(segments, 'Hola\nExtra line', indices);
			const output = reassemble(result);
			assert.ok(output.includes('Hola'));
		});
	});

	suite('getLanguageLabel', () => {
		test('returns label for known language codes', () => {
			assert.strictEqual(getLanguageLabel('en'), 'English');
			assert.strictEqual(getLanguageLabel('pt'), 'Portuguese');
			assert.strictEqual(getLanguageLabel('es'), 'Spanish');
		});

		test('returns code itself for unknown language codes', () => {
			assert.strictEqual(getLanguageLabel('zz'), 'zz');
			assert.strictEqual(getLanguageLabel(''), '');
		});
	});
});
