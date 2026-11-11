/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { AI_LIB_SERVER_PACKAGES, getAiLibServerModules, toServerModulePath } from '../ai-lib-dependencies.ts';

const REPO_ROOT = path.dirname(path.dirname(path.dirname(import.meta.dirname)));

/** The closure is read off the real install, so skip when it isn't there. */
const installed = AI_LIB_SERVER_PACKAGES.every(
	name => fs.existsSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json')));

suite('ai-lib-dependencies', () => {

	suite('toServerModulePath', () => {

		test('maps installed modules, ai-lib checkouts, and nested versions', () => {
			assert.deepStrictEqual([
				'node_modules/ai',
				'node_modules/@aws-sdk/client-bedrock',
				'ai-lib/packages/ai-config',
				'ai-lib/packages/ai-config/node_modules/zod',
			].map(dir => toServerModulePath(dir, 'ai-config')), [
				'node_modules/ai',
				'node_modules/@aws-sdk/client-bedrock',
				'node_modules/ai-config',
				'node_modules/ai-config/node_modules/zod',
			]);
		});

		// An `npm install` inside ai-lib hoists to a location the server layout has
		// no counterpart for, so it travels nested under the package that needs it
		// rather than at the top level, where the server's own copy would win.
		// Nesting below the hoist point is preserved: flattening `a/node_modules/b`
		// to `b` would collide with a sibling `b` of another version.
		test('nests a dependency hoisted above the packages under its owner', () => {
			assert.deepStrictEqual([
				toServerModulePath('ai-lib/node_modules/zod', 'ai-config'),
				toServerModulePath('ai-lib/node_modules/zod', 'ai-provider-bridge'),
				toServerModulePath('ai-lib/node_modules/@github/copilot-sdk', 'ai-provider-bridge'),
				toServerModulePath('ai-lib/node_modules/a/node_modules/b', 'ai-config'),
				toServerModulePath('ai-lib/packages/node_modules/zod', 'ai-config'),
			], [
				'node_modules/ai-config/node_modules/zod',
				'node_modules/ai-provider-bridge/node_modules/zod',
				'node_modules/ai-provider-bridge/node_modules/@github/copilot-sdk',
				'node_modules/ai-config/node_modules/a/node_modules/b',
				'node_modules/ai-config/node_modules/zod',
			]);
		});

		// The nested copy and the copy it was nested against stay distinct, so the
		// destination-keyed closure cannot drop one of them.
		test('keeps two versions of the same dependency apart', () => {
			const destinations = [
				'ai-lib/node_modules/b',
				'ai-lib/node_modules/a/node_modules/b',
			].map(dir => toServerModulePath(dir, 'ai-config'));
			assert.deepStrictEqual(new Set(destinations).size, destinations.length);
		});

		test('rejects a location that is neither', () => {
			assert.throws(
				() => toServerModulePath('remote/node_modules/ws', 'ai-config'),
				/Unexpected ai-lib dependency location/);
		});
	});

	suite('getAiLibServerModules', () => {

		test('includes the packages the server imports', { skip: !installed }, () => {
			const modules = getAiLibServerModules();
			assert.deepStrictEqual(
				AI_LIB_SERVER_PACKAGES.filter(name =>
					modules.some(m => m.source === `ai-lib/packages/${name}` && m.destination === `node_modules/${name}`)),
				AI_LIB_SERVER_PACKAGES);
		});

		test('includes the deps that resolve outside the packages', { skip: !installed }, () => {
			const modules = getAiLibServerModules(['ai-config']);
			// proper-lockfile resolves from the root node_modules, and the closure
			// follows it into its own nested node_modules (signal-exit 3).
			assert.deepStrictEqual([
				modules.some(m => m.source === 'node_modules/proper-lockfile' && m.destination === 'node_modules/proper-lockfile'),
				modules.some(m => m.destination.startsWith('node_modules/proper-lockfile/node_modules/')),
			], [true, true]);
		});

		test('does not walk dev dependencies', { skip: !installed }, () => {
			assert.deepStrictEqual(
				getAiLibServerModules().filter(m => /\/(typescript|vitest|vite|esbuild|husky|tsx)$/.test(m.source)),
				[]);
		});

		test('every destination is under node_modules and unique', { skip: !installed }, () => {
			const destinations = getAiLibServerModules().map(m => m.destination);
			assert.deepStrictEqual({
				outside: destinations.filter(d => !d.startsWith('node_modules/')),
				duplicates: destinations.length - new Set(destinations).size,
			}, { outside: [], duplicates: 0 });
		});

		test('reports an unresolvable package instead of skipping it', () => {
			assert.throws(
				() => getAiLibServerModules(['ai-lib-package-that-does-not-exist']),
				/Cannot resolve ai-lib dependency/);
		});
	});
});
