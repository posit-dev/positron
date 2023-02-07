/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

const child_process = require('child_process');
const fs = require('fs');
const process = require('process');

function executeCommandOrDie(command, options) {

	console.log(`$ ${command}`);
	const result = child_process.spawnSync(command, [], {
		encoding: 'utf-8',
		stdio: 'inherit',
		shell: true,
		...(options || {}),
	});

	if (result.error || result.status !== 0) {
		console.error(`Error executing ${command} [exit status ${result.status}]`);
		process.exit(1);
	}

}

function githubUrlWithPat(url) {

	const pat = process.env['POSITRON_GITHUB_PAT'] || '';
	if (pat.length) {
		url = url.replace('https://', `https://${pat}@`);
	}

	return url;

}

function updateBuiltinExtension(name, url) {

	// If the positron-python folder already exists, try to update it.
	if (fs.existsSync(name)) {
		executeCommandOrDie(`git -C ${name} pull`);
		return;
	}

	// Otherwise, clone the repository.
	url = githubUrlWithPat(url);
	executeCommandOrDie(`git clone ${url} positron-python`);

}

process.chdir('extensions');
updateBuiltinExtension('positron-python', 'https://github.com/posit-dev/positron-python.git');
process.chdir('..');
