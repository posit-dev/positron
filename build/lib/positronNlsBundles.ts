/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import { stripComments, type Language } from './i18n.ts';

/**
 * Generates per-locale `nls.messages.js` bundles for the web/server workbench
 * (reh-web). The server points browsers at
 * `${nlsCoreBaseUrl}${commit}/${version}/${locale}/nls.messages.js`
 * (see src/vs/server/node/webClientServer.ts), and this module produces the
 * files that URL template expects, laid out as `<locale>/nls.messages.js` so
 * publishing is a plain recursive copy under `<commit>/<version>/`.
 *
 * This intentionally does NOT reuse `processCoreBundleFormat` from i18n.ts:
 * that emitter pushes `undefined` for untranslated keys, which is only safe
 * for the monaco editor build (compiled with `preserveEnglish: true`). The
 * product build compiles with `preserveEnglish: false`, rewriting
 * `localize('key', "English")` into `localize(<index>, null)` - the English
 * fallback is stripped from the shipped code. A `null` bundle entry then makes
 * `src/vs/nls.ts` THROW (`!!! NLS MISSING !!!`) instead of degrading to
 * English. Every Positron-specific string (Console, Variables, Data Explorer,
 * ...) has no vscode-loc translation, so an unmerged bundle would crash the
 * workbench during construction in every non-English locale.
 *
 * The fix is to merge in the English defaults from `nls.messages.json`,
 * exactly as the desktop language-pack path does in
 * src/vs/base/node/nls.ts (`moduleTranslations?.[key] || defaults[index]`).
 */

/**
 * The parsed shape of `out-build/nls.keys.json`: module IDs with their NLS
 * keys, in the exact order the compile pass assigned message indices.
 */
export type NLSKeysFormat = Array<[string /* module ID */, string[] /* keys */]>;

/**
 * The `contents` payload of a vscode-loc `main.i18n.json` translation file.
 */
export interface I18nTranslations {
	[moduleId: string]: {
		[nlsKey: string]: string;
	};
}

export interface INlsBundleResult {
	/** The merged, positional message array for the locale. */
	readonly messages: string[];
	/** How many indices received a translation (rest fell back to English). */
	readonly translatedCount: number;
}

/**
 * Flattens `nls.keys.json` module key lists into the shared index space and
 * resolves each index to its translation, falling back to the English default
 * for untranslated keys (never `undefined`/`null` - see module doc).
 *
 * Throws when the flattened key count does not match the default message
 * count: the two files are emitted from one compile pass and share one index
 * space, so a mismatch means the inputs are not from the same build and every
 * string after the divergence would silently shift.
 */
export function mergeTranslationsWithDefaults(nlsKeys: NLSKeysFormat, nlsDefaultMessages: string[], translations: I18nTranslations): INlsBundleResult {
	const flattenedKeyCount = nlsKeys.reduce((count, [, moduleKeys]) => count + moduleKeys.length, 0);
	if (flattenedKeyCount !== nlsDefaultMessages.length) {
		throw new Error(`NLS index misalignment: nls.keys.json flattens to ${flattenedKeyCount} keys but nls.messages.json has ${nlsDefaultMessages.length} messages. The two files must come from the same compile pass.`);
	}

	const messages: string[] = [];
	let translatedCount = 0;
	let nlsIndex = 0;
	for (const [moduleId, moduleKeys] of nlsKeys) {
		const moduleTranslations = translations[moduleId];
		for (const nlsKey of moduleKeys) {
			// `||` (not `??`) mirrors the desktop merge in
			// src/vs/base/node/nls.ts: an empty translated string also falls
			// back to the English default.
			const translation = moduleTranslations?.[nlsKey];
			if (translation) {
				translatedCount++;
			}
			messages.push(translation || nlsDefaultMessages[nlsIndex]);
			nlsIndex++;
		}
	}

	return { messages, translatedCount };
}

/**
 * Renders the bundle file content, setting both globals the workbench boot
 * code expects (same shape `processCoreBundleFormat` emits).
 */
export function renderNlsBundle(fileHeader: string, messages: string[], languageId: string): string {
	return `${fileHeader}
globalThis._VSCODE_NLS_MESSAGES=${JSON.stringify(messages)};
globalThis._VSCODE_NLS_LANGUAGE=${JSON.stringify(languageId)};`;
}

export interface IGenerateNlsBundlesOptions {
	/** Directory containing `nls.keys.json` and `nls.messages.json` (i.e. `out-build`). */
	readonly nlsMetadataPath: string;
	/** The `i18n` directory of a `microsoft/vscode-loc` checkout. */
	readonly vscodeLocI18nPath: string;
	/** Output directory; one `<locale>/nls.messages.js` is written per language. */
	readonly outputPath: string;
	readonly languages: readonly Language[];
	/** Header prepended to each emitted file. */
	readonly fileHeader: string;
}

function log(message: string, ...rest: unknown[]): void {
	fancyLog(ansiColors.green('[nls-bundles]'), message, ...rest);
}

/**
 * Reads the NLS metadata and the vscode-loc translations and writes one
 * merged `nls.messages.js` per language.
 *
 * A missing vscode-loc checkout or language pack is a HARD error: with the
 * English merge in place, tolerating it would silently emit perfectly valid
 * all-English bundles - indistinguishable from success in CI, failing only as
 * a user-visible bug.
 */
export function generateNlsBundles(options: IGenerateNlsBundlesOptions): void {
	if (!fs.existsSync(options.vscodeLocI18nPath)) {
		throw new Error(`No vscode-loc checkout found at ${path.dirname(options.vscodeLocI18nPath)}. Check out https://github.com/microsoft/vscode-loc as a sibling of the repository root to generate NLS bundles.`);
	}

	const nlsKeysFile = path.join(options.nlsMetadataPath, 'nls.keys.json');
	if (!fs.existsSync(nlsKeysFile)) {
		throw new Error(`No NLS metadata found at ${nlsKeysFile}. Run a build compile first (e.g. the vscode-reh-web-* task), which emits nls.keys.json and nls.messages.json.`);
	}

	const nlsKeys: NLSKeysFormat = JSON.parse(fs.readFileSync(nlsKeysFile, 'utf8'));
	const nlsDefaultMessages: string[] = JSON.parse(fs.readFileSync(path.join(options.nlsMetadataPath, 'nls.messages.json'), 'utf8'));

	for (const language of options.languages) {
		const languageFolderName = language.translationId || language.id;
		const i18nFile = path.join(options.vscodeLocI18nPath, `vscode-language-pack-${languageFolderName}`, 'translations', 'main.i18n.json');
		if (!fs.existsSync(i18nFile)) {
			throw new Error(`No translations found for language '${language.id}' at ${i18nFile}.`);
		}

		const { contents }: { contents: I18nTranslations } = JSON.parse(stripComments(fs.readFileSync(i18nFile, 'utf8')));
		const { messages, translatedCount } = mergeTranslationsWithDefaults(nlsKeys, nlsDefaultMessages, contents);

		const outputFile = path.join(options.outputPath, language.id, 'nls.messages.js');
		fs.mkdirSync(path.dirname(outputFile), { recursive: true });
		fs.writeFileSync(outputFile, renderNlsBundle(options.fileHeader, messages, language.id));
		log(`${language.id}: ${translatedCount}/${messages.length} strings translated, rest fall back to English (${path.relative(process.cwd(), outputFile)})`);
	}
}
