/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { checkBootstrapExtensionVersion, compareSemver, IGalleryVersion, satisfiesPositronEngine, selectLatestVersion } from '../../common/positronBootstrapExtensionVersions.js';

// Fixtures are trimmed from PPM gallery extensionquery responses recorded on
// 2026-11-04: real versions, platforms, engine ranges, and property keys.

const ENGINE = 'Microsoft.VisualStudio.Code.Engine';
const PRE_RELEASE = 'Microsoft.VisualStudio.Code.PreRelease';
const POSITRON_ENGINE = 'Positron.Engine';
const ENGINES = { vscode: '1.138.0', positron: '2026.11.0' };

const ALL_PYREFLY_PLATFORMS = ['alpine-arm64', 'alpine-x64', 'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-armhf', 'linux-x64', 'win32-arm64', 'win32-x64'];
const PYREFLY_1_3_2_PLATFORMS = ALL_PYREFLY_PLATFORMS.filter(p => p !== 'win32-x64');
const DEBUGPY_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-armhf', 'linux-x64', 'win32-arm64', 'win32-x64'];

function platformBuilds(version: string, platforms: string[], engine: string, preRelease = false): IGalleryVersion[] {
	return platforms.map(targetPlatform => ({
		version,
		targetPlatform,
		properties: [
			{ key: ENGINE, value: engine },
			...(preRelease ? [{ key: PRE_RELEASE, value: 'true' }] : [])
		]
	}));
}

const pyrefly = {
	'1.3.1': platformBuilds('1.3.1', ALL_PYREFLY_PLATFORMS, '^1.103.0'),
	'1.3.2': platformBuilds('1.3.2', PYREFLY_1_3_2_PLATFORMS, '^1.103.0'),
	'1.3.9001': platformBuilds('1.3.9001', ALL_PYREFLY_PLATFORMS, '^1.103.0', true),
	'1.4.0': platformBuilds('1.4.0', ALL_PYREFLY_PLATFORMS, '^1.103.0')
};

const pullRequestGithub: IGalleryVersion[] = [
	{ version: '0.168.0', targetPlatform: 'universal', properties: [{ key: ENGINE, value: '^1.141.0' }] },
	{ version: '0.166.1', targetPlatform: 'universal', properties: [{ key: ENGINE, value: '^1.137.0' }] }
];

const quarto: IGalleryVersion[] = [
	{ version: '1.139.0', targetPlatform: 'universal', properties: [{ key: ENGINE, value: '^1.101.0' }, { key: POSITRON_ENGINE, value: '^2026.04.1' }] },
	{ version: '1.138.0', targetPlatform: 'universal', properties: [{ key: ENGINE, value: '^1.75.0' }, { key: POSITRON_ENGINE, value: '^2026.04.1' }] }
];
// Hypothetical future quarto releases; the gallery had none past 1.139.0.
const quartoNeedingNewerPositron: IGalleryVersion = { version: '1.140.0', targetPlatform: 'universal', properties: [{ key: ENGINE, value: '^1.101.0' }, { key: POSITRON_ENGINE, value: '^2026.12.0' }] };
const quartoWithBadPositronRange: IGalleryVersion = { version: '1.140.1', targetPlatform: 'universal', properties: [{ key: ENGINE, value: '^1.101.0' }, { key: POSITRON_ENGINE, value: '2026.12' }] };

const debugpy: IGalleryVersion[] = [
	...platformBuilds('2024.11.0-dev', ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'], '^1.92.0'),
	...platformBuilds('2024.10.0', DEBUGPY_PLATFORMS, '^1.92.0')
];

describe('checkBootstrapExtensionVersion', () => {

	it('holds a version that is missing a build for a shipped platform', () => {
		const versions = [...pyrefly['1.3.1'], ...pyrefly['1.3.2'], ...pyrefly['1.3.9001']];
		expect(checkBootstrapExtensionVersion('meta.pyrefly', '1.3.1', versions, ENGINES)).toEqual({
			result: { id: 'meta.pyrefly', pinned: '1.3.1', latest: '1.3.2', decision: 'hold', reason: 'no win32-x64 build' },
			warnings: []
		});
	});

	it('falls back to the newest complete version and reports the one it skipped', () => {
		const versions = [...pyrefly['1.3.1'], ...pyrefly['1.3.2'], ...pyrefly['1.3.9001']];
		expect(checkBootstrapExtensionVersion('meta.pyrefly', '1.3.0', versions, ENGINES)).toEqual({
			result: { id: 'meta.pyrefly', pinned: '1.3.0', latest: '1.3.1', decision: 'bump' },
			warnings: ['meta.pyrefly 1.3.2: no win32-x64 build, skipped']
		});
	});

	it('bumps to a complete newer version even when an older one has a platform gap', () => {
		const versions = [...pyrefly['1.3.1'], ...pyrefly['1.3.2'], ...pyrefly['1.3.9001'], ...pyrefly['1.4.0']];
		expect(checkBootstrapExtensionVersion('meta.pyrefly', '1.3.1', versions, ENGINES)).toEqual({
			result: { id: 'meta.pyrefly', pinned: '1.3.1', latest: '1.4.0', decision: 'bump' },
			warnings: []
		});
	});

	it('stays current when the newer version needs an engine Positron does not have', () => {
		expect(checkBootstrapExtensionVersion('GitHub.vscode-pull-request-github', '0.166.1', pullRequestGithub, ENGINES)).toEqual({
			result: { id: 'GitHub.vscode-pull-request-github', pinned: '0.166.1', latest: '0.166.1', decision: 'current' },
			warnings: []
		});
	});

	it('bumps once the engine satisfies the newer version', () => {
		expect(checkBootstrapExtensionVersion('GitHub.vscode-pull-request-github', '0.166.1', pullRequestGithub, { ...ENGINES, vscode: '1.141.0' })).toEqual({
			result: { id: 'GitHub.vscode-pull-request-github', pinned: '0.166.1', latest: '0.168.0', decision: 'bump' },
			warnings: []
		});
	});

	it('bumps a universal extension without checking platforms', () => {
		expect(checkBootstrapExtensionVersion('quarto.quarto', '1.138.0', quarto, ENGINES)).toEqual({
			result: { id: 'quarto.quarto', pinned: '1.138.0', latest: '1.139.0', decision: 'bump' },
			warnings: []
		});
	});

	it('never bumps to a pre-release and warns when nothing else is published', () => {
		expect(checkBootstrapExtensionVersion('meta.pyrefly', '1.3.1', pyrefly['1.3.9001'], ENGINES)).toEqual({
			result: { id: 'meta.pyrefly', pinned: '1.3.1', latest: '1.3.1', decision: 'current' },
			warnings: ['meta.pyrefly: no stable version on the gallery is compatible with VS Code engine 1.138.0 and Positron 2026.11.0']
		});
	});

	it('skips a version with a prerelease suffix that carries no pre-release flag', () => {
		expect(checkBootstrapExtensionVersion('ms-python.debugpy', '2024.10.0', debugpy, ENGINES)).toEqual({
			result: { id: 'ms-python.debugpy', pinned: '2024.10.0', latest: '2024.10.0', decision: 'current' },
			warnings: []
		});
	});

	it('warns about an engine range it cannot parse and skips that version', () => {
		const versions = [...pyrefly['1.3.1'], ...platformBuilds('1.3.3', ALL_PYREFLY_PLATFORMS, 'not a range')];
		expect(checkBootstrapExtensionVersion('meta.pyrefly', '1.3.1', versions, ENGINES)).toEqual({
			result: { id: 'meta.pyrefly', pinned: '1.3.1', latest: '1.3.1', decision: 'current' },
			warnings: ['meta.pyrefly 1.3.3: VS Code engine range "not a range" is not valid, skipped']
		});
	});

	it('skips a version that needs a newer Positron than the one checking', () => {
		expect(checkBootstrapExtensionVersion('quarto.quarto', '1.138.0', [...quarto, quartoNeedingNewerPositron], ENGINES)).toEqual({
			result: { id: 'quarto.quarto', pinned: '1.138.0', latest: '1.139.0', decision: 'bump' },
			warnings: []
		});
	});

	it('warns about a Positron engine range it cannot parse and skips that version', () => {
		expect(checkBootstrapExtensionVersion('quarto.quarto', '1.138.0', [...quarto, quartoWithBadPositronRange], ENGINES)).toEqual({
			result: { id: 'quarto.quarto', pinned: '1.138.0', latest: '1.139.0', decision: 'bump' },
			warnings: ['quarto.quarto 1.140.1: Positron engine range "2026.12" is not valid, skipped']
		});
	});
});

describe('satisfiesPositronEngine', () => {

	it('matches the engines.positron rules of positronExtensionValidator', () => {
		const cases: [string, string, boolean | undefined][] = [
			['2026.11.0', '*', true],
			['2026.11.0', '^2026.04.1', true],
			['2026.11.0', '>=2026.11.0', true],
			['2026.11.0', '^2026.12.0', false],
			['2026.11.0', '^2027.01.0', false],
			['2026.11.0', '2026.11.0', true],
			['2026.11.0', '2026.11.x', true],
			['2026.11.0', '2026.10.0', false],
			['2026.11.0', '2026.12', undefined],
			['2026.11.0', '>=1.90.0-insider', true],
			['dev', '^2026.04.1', undefined]
		];
		expect(cases.map(([version, range, expected]) => [version, range, satisfiesPositronEngine(version, range), expected]))
			.toEqual(cases.map(([version, range, expected]) => [version, range, expected, expected]));
	});
});

describe('compareSemver', () => {

	it('orders by SemVer precedence, ignoring build metadata', () => {
		const versions = ['1.2', '2024.11.0-dev', '1.2.0', '2024.11.0', '1.10.0', '1.2.0-beta.2', '3+linux', '1.2.0-beta.10'];
		expect(versions.slice().sort(compareSemver)).toEqual([
			'1.2.0-beta.2', '1.2.0-beta.10', '1.2', '1.2.0', '1.10.0', '3+linux', '2024.11.0-dev', '2024.11.0'
		]);
		expect(selectLatestVersion(versions.map(version => ({ version })))).toEqual({ version: '2024.11.0' });
		expect(compareSemver('1.2', '1.2.0')).toBe(0);
		expect(compareSemver('1.2.0-beta.2', '1.2.0-beta.10')).toBeLessThan(0);
		expect(compareSemver('2024.11.0-dev', '2024.11.0')).toBeLessThan(0);
		expect(compareSemver('3+linux', '2.9.9')).toBeGreaterThan(0);
	});
});
