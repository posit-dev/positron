/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = cp.execSync('git rev-parse --show-toplevel').toString().trim();
const driverPath = path.join(root, 'src/vs/workbench/services/driver/common/driver.ts');

let contents = fs.readFileSync(driverPath, 'utf8');
// @ts-ignore
contents = /\/\/\*START([\s\S]*)\/\/\*END/mi.exec(contents)[1].trim();
contents = contents.replace(/\bTPromise\b/g, 'Promise');

contents = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

${contents}
`;

const srcPath = path.join(path.dirname(__dirname));
const outPath = path.join(__dirname, '..', '..', 'out');
const infraPath = path.join(outPath, 'infra');

if (!fs.existsSync(outPath)) {
	fs.mkdirSync(outPath);
}

if (!fs.existsSync(infraPath)) {
	fs.mkdirSync(infraPath);
}
fs.writeFileSync(path.join(srcPath, 'driver.d.ts'), contents);
fs.writeFileSync(path.join(infraPath, 'driver.d.ts'), contents);
