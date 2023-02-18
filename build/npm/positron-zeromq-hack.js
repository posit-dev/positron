/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const fs = require('fs');

// The Jupyter package file.
const jupyterPackageFile = 'extensions/jupyter-adapter/package.json';

// Slam the zeromq dependency of the jupyter-adapter extension.
function slamZeromq() {
	console.log(`---------------> SLAMMING ${jupyterPackageFile} zeromq version to beta.16`)
	fs.writeFileSync(jupyterPackageFile, fs.readFileSync(jupyterPackageFile, 'utf8').replace(/"zeromq": "6.0.0-beta.6"/g, '"zeromq": "6.0.0-beta.16"'));
}

// Unslam the zeromq dependency of the jupyter-adapter extension.
function unslamZeromq() {
	console.log(`---------------> SLAMMING ${jupyterPackageFile} zeromq version back to beta.6`)
	fs.writeFileSync(jupyterPackageFile, fs.readFileSync(jupyterPackageFile, 'utf8').replace(/"zeromq": "6.0.0-beta.16"/g, '"zeromq": "6.0.0-beta.6"'));
	cp.execSync('git checkout yarn.lock', { cwd: 'extensions/jupyter-adapter' });
}

exports.slamZeromq = slamZeromq;
exports.unslamZeromq = unslamZeromq;
