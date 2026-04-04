/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseRVersionsFile } from '../provider-rversions';

describe('r-versions file parsing', () => {

	it('parses a single entry with Path only', () => {
		const content = 'Path: /opt/R/4.3.0';
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe(undefined);
	});

	it('parses a single entry with Path and Label', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Label: R 4.3.0 (Production)',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0 (Production)');
	});

	it('parses multiple entries separated by blank lines', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Label: R 4.3.0',
			'',
			'Path: /opt/R/4.4.0',
			'Label: R 4.4.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(2);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0');
		expect(entries[1].path).toBe('/opt/R/4.4.0');
		expect(entries[1].label).toBe('R 4.4.0');
	});

	it('parses all supported fields', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Label: R 4.3.0 (Production)',
			'Script: /opt/scripts/setup-r.sh',
			'Repo: /etc/rstudio/repos.conf',
			'Library: /opt/R/4.3.0/site-library:/shared/r-libs',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0 (Production)');
		expect(entries[0].script).toBe('/opt/scripts/setup-r.sh');
		expect(entries[0].repo).toBe('/etc/rstudio/repos.conf');
		expect(entries[0].library).toBe('/opt/R/4.3.0/site-library:/shared/r-libs');
	});

	it('parses entry with Module instead of Path', () => {
		const content = [
			'Module: r/4.3.0',
			'Label: R 4.3.0 (Module)',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].module).toBe('r/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0 (Module)');
		expect(entries[0].path).toBe(undefined);
	});

	it('handles case-insensitive field names', () => {
		const content = [
			'path: /opt/R/4.3.0',
			'LABEL: R 4.3.0',
			'Path: /opt/R/4.4.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		// Keys are case-insensitive; if same key appears twice, last value wins
		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.4.0');
		expect(entries[0].label).toBe('R 4.3.0');
	});

	it('skips entries without Path or Module', () => {
		const content = [
			'Label: Orphaned Label',
			'Script: /some/script.sh',
			'',
			'Path: /opt/R/4.3.0',
			'Label: Valid Entry',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('Valid Entry');
	});

	it('handles empty content', () => {
		const entries = parseRVersionsFile('');
		expect(entries.length).toBe(0);
	});

	it('handles whitespace-only content', () => {
		const entries = parseRVersionsFile('   \n\n   \n');
		expect(entries.length).toBe(0);
	});

	it('handles multiple blank lines between entries', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'',
			'',
			'Path: /opt/R/4.4.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(2);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[1].path).toBe('/opt/R/4.4.0');
	});

	it('trims whitespace from keys and values', () => {
		const content = [
			'  Path  :   /opt/R/4.3.0',
			'  Label:R 4.3.0  ',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0');
	});

	it('handles values containing colons', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'Library: /path/one:/path/two:/path/three',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].library).toBe('/path/one:/path/two:/path/three');
	});

	it('ignores unknown field names', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'UnknownField: some value',
			'Label: R 4.3.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0');
	});

	it('ignores lines without colons', () => {
		const content = [
			'Path: /opt/R/4.3.0',
			'This line has no colon',
			'Label: R 4.3.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0');
	});

	it('ignores comment lines starting with #', () => {
		const content = [
			'# This is a comment',
			'Path: /opt/R/4.3.0',
			'# Another comment',
			'Label: R 4.3.0',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(1);
		expect(entries[0].path).toBe('/opt/R/4.3.0');
		expect(entries[0].label).toBe('R 4.3.0');
	});

	it('parses file based on Posit Workbench r-versions template', () => {
		// Based on rstudio-pro/src/cpp/server/extras/conf/r-versions
		const content = [
			'# This file contains entries that specify which versions of R are available for sessions to use.',
			'#',
			'# Each entry consists of four fields: Path, Label, Module, and Script, each separated',
			'# by a new line.',
			'#',
			'# Each entry MUST be separated by ONE blank line (2 new line characters).',
			'#',
			'# Path is the location of the R installation. It is a required field.',
			'#',
			'# Label is a user-friendly version moniker for the particular R version. It is optional.',
			'#',
			'# Module is an environment module (see https://en.wikipedia.org/wiki/Environment_Modules_(software))',
			'# to load when the particular version of R is loaded. It is optional.',
			'#',
			'# Script is the location of an executable script to run before the session is started.',
			'#',
			'# Examples are below.',
			'#',
			'Path: /opt/R/R-2.15.3',
			'Label: My special R Version',
			'Module: testmodule',
			'Script: ~/rload.sh',
			'',
			'Path: /opt/R/R-2.15.3-alternate',
			'Label: My special R Version Alternate',
			'Script: /opt/R/R-2.15.3-alternate/preload.sh',
		].join('\n');
		const entries = parseRVersionsFile(content);

		expect(entries.length).toBe(2);

		expect(entries[0].path).toBe('/opt/R/R-2.15.3');
		expect(entries[0].label).toBe('My special R Version');
		expect(entries[0].module).toBe('testmodule');
		expect(entries[0].script).toBe('~/rload.sh');

		expect(entries[1].path).toBe('/opt/R/R-2.15.3-alternate');
		expect(entries[1].label).toBe('My special R Version Alternate');
		expect(entries[1].script).toBe('/opt/R/R-2.15.3-alternate/preload.sh');
		expect(entries[1].module).toBe(undefined);
	});
});
