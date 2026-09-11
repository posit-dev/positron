/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateNlsBundles, mergeTranslationsWithDefaults, renderNlsBundle, type NLSKeysFormat } from '../positronNlsBundles.ts';

suite('Positron NLS bundles', () => {

	// Mirrors the real shape: an upstream module with vscode-loc coverage and
	// a Positron-only module that no language pack knows about.
	const nlsKeys: NLSKeysFormat = [
		['vs/workbench/upstream/module', ['keyA', 'keyB']],
		['vs/workbench/contrib/positronConsole/module', ['keyC']]
	];
	const nlsDefaultMessages = ['English A', 'English B', 'Positron C'];

	suite('mergeTranslationsWithDefaults', () => {

		test('translated keys resolve by index, untranslated keys fall back to English', () => {
			const { messages, translatedCount } = mergeTranslationsWithDefaults(nlsKeys, nlsDefaultMessages, {
				'vs/workbench/upstream/module': { keyA: '翻訳 A' }
			});

			// Positional: index 0 is the translation, indices 1 and 2 are the
			// English defaults (keyB untranslated, Positron module unknown to
			// the language pack). Nothing may be undefined/null - the product
			// build strips English fallbacks from the shipped code, so a
			// non-string entry makes src/vs/nls.ts throw at runtime.
			assert.deepStrictEqual(messages, ['翻訳 A', 'English B', 'Positron C']);
			assert.strictEqual(translatedCount, 1);
		});

		test('empty bundle input is all-English (never undefined/null)', () => {
			const { messages, translatedCount } = mergeTranslationsWithDefaults(nlsKeys, nlsDefaultMessages, {});

			assert.deepStrictEqual(messages, nlsDefaultMessages);
			assert.strictEqual(translatedCount, 0);
		});

		test('empty-string translations fall back to English (parity with src/vs/base/node/nls.ts)', () => {
			const { messages } = mergeTranslationsWithDefaults(nlsKeys, nlsDefaultMessages, {
				'vs/workbench/upstream/module': { keyA: '' }
			});

			assert.strictEqual(messages[0], 'English A');
		});

		test('throws when key count and message count disagree (index misalignment)', () => {
			// nls.keys.json and nls.messages.json share one index space from a
			// single compile pass. A silent off-by-one here corrupts every
			// string after the divergence, so it must be a hard error.
			assert.throws(() => mergeTranslationsWithDefaults(nlsKeys, ['English A', 'English B'], {}), /misalignment/);
			assert.throws(() => mergeTranslationsWithDefaults(nlsKeys, [...nlsDefaultMessages, 'Extra'], {}), /misalignment/);
		});
	});

	suite('renderNlsBundle', () => {

		test('sets both NLS globals', () => {
			const content = renderNlsBundle('/* header */', ['a', 'b'], 'ja');

			assert.strictEqual(content, '/* header */\nglobalThis._VSCODE_NLS_MESSAGES=["a","b"];\nglobalThis._VSCODE_NLS_LANGUAGE="ja";');
		});
	});

	suite('generateNlsBundles', () => {

		function makeFixture(): { root: string; metadataPath: string; locI18nPath: string; outputPath: string } {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-nls-bundles-test-'));
			const metadataPath = path.join(root, 'out-build');
			const locI18nPath = path.join(root, 'vscode-loc', 'i18n');
			const outputPath = path.join(root, 'out-build-nls');

			fs.mkdirSync(metadataPath, { recursive: true });
			fs.writeFileSync(path.join(metadataPath, 'nls.keys.json'), JSON.stringify(nlsKeys));
			fs.writeFileSync(path.join(metadataPath, 'nls.messages.json'), JSON.stringify(nlsDefaultMessages));

			return { root, metadataPath, locI18nPath, outputPath };
		}

		function writeLanguagePack(locI18nPath: string, folderName: string, contents: Record<string, Record<string, string>>): void {
			const translationsDir = path.join(locI18nPath, `vscode-language-pack-${folderName}`, 'translations');
			fs.mkdirSync(translationsDir, { recursive: true });
			fs.writeFileSync(path.join(translationsDir, 'main.i18n.json'), JSON.stringify({ version: '1.0.0', contents }));
		}

		function readBundle(outputPath: string, languageId: string): { messages: string[]; language: string } {
			const content = fs.readFileSync(path.join(outputPath, languageId, 'nls.messages.js'), 'utf8');
			const match = /_VSCODE_NLS_MESSAGES=(?<messages>\[.*\]);\nglobalThis\._VSCODE_NLS_LANGUAGE=(?<language>"[^"]+");$/s.exec(content);
			assert.ok(match?.groups, `bundle for ${languageId} does not set both NLS globals:\n${content}`);
			return { messages: JSON.parse(match.groups.messages), language: JSON.parse(match.groups.language) };
		}

		test('writes one merged <locale>/nls.messages.js per language, mapping translationId folders', (t) => {
			const { root, metadataPath, locI18nPath, outputPath } = makeFixture();
			t.after(() => fs.rmSync(root, { recursive: true, force: true }));

			writeLanguagePack(locI18nPath, 'ja', { 'vs/workbench/upstream/module': { keyA: '翻訳 A', keyB: '翻訳 B' } });
			// zh-cn resolves through translationId zh-hans to a differently
			// named vscode-loc folder - the lookup the Latin-script locales
			// never exercise.
			writeLanguagePack(locI18nPath, 'zh-hans', { 'vs/workbench/upstream/module': { keyA: '翻译 A' } });

			generateNlsBundles({
				nlsMetadataPath: metadataPath,
				vscodeLocI18nPath: locI18nPath,
				outputPath,
				languages: [
					{ id: 'ja', folderName: 'jpn' },
					{ id: 'zh-cn', folderName: 'chs', translationId: 'zh-hans' }
				],
				fileHeader: '/* header */'
			});

			const ja = readBundle(outputPath, 'ja');
			const zhCn = readBundle(outputPath, 'zh-cn');

			// Index alignment across the pipeline: both bundles have exactly
			// as many entries as nls.keys.json flattens to, and a given index
			// resolves to the same key's string in every locale (translation
			// where one exists, English default where not).
			assert.deepStrictEqual(
				{ ja, zhCn },
				{
					ja: { messages: ['翻訳 A', '翻訳 B', 'Positron C'], language: 'ja' },
					zhCn: { messages: ['翻译 A', 'English B', 'Positron C'], language: 'zh-cn' }
				}
			);
		});

		test('missing vscode-loc checkout is a hard error, not a warning', (t) => {
			const { root, metadataPath, locI18nPath, outputPath } = makeFixture();
			t.after(() => fs.rmSync(root, { recursive: true, force: true }));

			// With the English merge in place, tolerating a missing checkout
			// would silently emit valid all-English bundles - looking like
			// success in CI and failing only as a user-visible bug.
			assert.throws(() => generateNlsBundles({
				nlsMetadataPath: metadataPath,
				vscodeLocI18nPath: locI18nPath,
				outputPath,
				languages: [{ id: 'ja', folderName: 'jpn' }],
				fileHeader: ''
			}), /vscode-loc/);
		});

		test('missing language pack for a requested locale is a hard error', (t) => {
			const { root, metadataPath, locI18nPath, outputPath } = makeFixture();
			t.after(() => fs.rmSync(root, { recursive: true, force: true }));

			writeLanguagePack(locI18nPath, 'ja', {});

			assert.throws(() => generateNlsBundles({
				nlsMetadataPath: metadataPath,
				vscodeLocI18nPath: locI18nPath,
				outputPath,
				languages: [{ id: 'ja', folderName: 'jpn' }, { id: 'ko', folderName: 'kor' }],
				fileHeader: ''
			}), /No translations found for language 'ko'/);
		});

		test('missing NLS metadata is a hard error pointing at the build step', (t) => {
			const { root, locI18nPath, outputPath } = makeFixture();
			t.after(() => fs.rmSync(root, { recursive: true, force: true }));

			writeLanguagePack(locI18nPath, 'ja', {});

			assert.throws(() => generateNlsBundles({
				nlsMetadataPath: path.join(root, 'does-not-exist'),
				vscodeLocI18nPath: locI18nPath,
				outputPath,
				languages: [{ id: 'ja', folderName: 'jpn' }],
				fileHeader: ''
			}), /nls\.keys\.json/);
		});
	});
});
