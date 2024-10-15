// /*---------------------------------------------------------------------------------------------
//  *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
//  *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
//  *--------------------------------------------------------------------------------------------*/

// import { Page } from '@playwright/test';
// import path = require('path');
// import fs = require('fs');
// import { ElectronApplication, _electron as electron } from 'playwright-core';

// interface StartAppResponse {
// 	electronApp: ElectronApplication;
// 	appWindow: Page;
// 	appInfo: ElectronAppInfo;
// }

// type Architecture = 'x64' | 'x32' | 'arm64';
// export interface ElectronAppInfo {
// 	/** Path to the app's executable file */
// 	executable: string;
// 	/** Path to the app's main (JS) file */
// 	main: string;
// 	/** Name of the app */
// 	name: string;
// 	/** Resources directory */
// 	resourcesDir: string;
// 	/** True if the app is using asar */
// 	asar: boolean;
// 	/** OS platform */
// 	platform: 'darwin' | 'win32' | 'linux';
// 	arch: Architecture;
// }
// export async function startApp(): Promise<StartAppResponse> {
// 	...
// }
// export async function findLatestBuild() {
// 	...
// }

// /**
//  * Given a directory containing an Electron app build,
//  * return the path to the app's executable and the path to the app's main file.
//  */
// export function parseElectronApp(buildDir: string): ElectronAppInfo {
// 	// log.info(`Parsing Electron app in ${buildDir}`);
// 	console.log(`Parsing Electron app in ${buildDir}`);
// 	let platform: string | undefined;
// 	if (buildDir.endsWith('.app')) {
// 		buildDir = path.dirname(buildDir);
// 		platform = 'darwin';
// 	}
// 	if (buildDir.endsWith('.exe')) {
// 		buildDir = path.dirname(buildDir);
// 		platform = 'win32';
// 	}

// 	const baseName = path.basename(buildDir).toLowerCase();
// 	if (!platform) {
// 		// parse the directory name to figure out the platform
// 		if (baseName.includes('win')) {
// 			platform = 'win32';
// 		}
// 		if (baseName.includes('linux') || baseName.includes('ubuntu') || baseName.includes('debian')) {
// 			platform = 'linux';
// 		}
// 		if (baseName.includes('darwin') || baseName.includes('mac') || baseName.includes('osx')) {
// 			platform = 'darwin';
// 		}
// 	}

// 	if (!platform) {
// 		throw new Error(`Platform not found in directory name: ${baseName}`);
// 	}

// 	let arch: Architecture;
// 	if (baseName.includes('x32') || baseName.includes('i386')) {
// 		arch = 'x32';
// 	}
// 	if (baseName.includes('x64')) {
// 		arch = 'x64';
// 	}
// 	if (baseName.includes('arm64')) {
// 		arch = 'arm64';
// 	}

// 	let executable: string;
// 	let main: string;
// 	let name: string;
// 	let asar: boolean;
// 	let resourcesDir: string;

// 	if (platform === 'darwin') {
// 		// MacOS Structure
// 		// <buildDir>/
// 		//   <appName>.app/
// 		//     Contents/
// 		//       MacOS/
// 		//        <appName> (executable)
// 		//       Info.plist
// 		//       PkgInfo
// 		//       Resources/
// 		//         electron.icns
// 		//         file.icns
// 		//         app.asar (asar bundle) - or -
// 		//         app
// 		//           package.json
// 		//           (your app structure)

// 		const list = fs.readdirSync(buildDir);
// 		const appBundle = list.find(fileName => {
// 			return fileName.endsWith('.app');
// 		});
// 		// @ts-ignore
// 		const appDir = path.join(buildDir, appBundle, 'Contents', 'MacOS');
// 		const appName = fs.readdirSync(appDir)[0];
// 		executable = path.join(appDir, appName);

// 		// @ts-ignore
// 		resourcesDir = path.join(buildDir, appBundle, 'Contents', 'Resources');
// 		const resourcesList = fs.readdirSync(resourcesDir);
// 		asar = resourcesList.includes('app.asar');

// 		let packageJson: { main: string; name: string };
// 		if (asar) {
// 			const asarPath = path.join(resourcesDir, 'app.asar');
// 			packageJson = JSON.parse(ASAR.extractFile(asarPath, 'package.json').toString('utf8'));
// 			main = path.join(asarPath, packageJson.main);
// 		} else {
// 			packageJson = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'app', 'package.json'), 'utf8'));
// 			main = path.join(resourcesDir, 'app', packageJson.main);
// 		}
// 		name = packageJson.name;
// 	} else if (platform === 'win32') {
// 		// Windows Structure
// 		// <buildDir>/
// 		//   <appName>.exe (executable)
// 		//   resources/
// 		//     app.asar (asar bundle) - or -
// 		//     app
// 		//       package.json
// 		//       (your app structure)

// 		const list = fs.readdirSync(buildDir);
// 		const exe = list.find(fileName => {
// 			return fileName.endsWith('.exe');
// 		});
// 		// @ts-ignore
// 		executable = path.join(buildDir, exe);

// 		resourcesDir = path.join(buildDir, 'resources');
// 		const resourcesList = fs.readdirSync(resourcesDir);
// 		asar = resourcesList.includes('app.asar');

// 		let packageJson: { main: string; name: string };

// 		if (asar) {
// 			const asarPath = path.join(resourcesDir, 'app.asar');
// 			packageJson = JSON.parse(ASAR.extractFile(asarPath, 'package.json').toString('utf8'));
// 			main = path.join(asarPath, packageJson.main);
// 		} else {
// 			packageJson = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'app', 'package.json'), 'utf8'));
// 			main = path.join(resourcesDir, 'app', packageJson.main);
// 		}
// 		name = packageJson.name;
// 	} else {
// 		/**  @todo add support for linux */
// 		throw new Error(`Platform not supported: ${platform}`);
// 	}
// 	return {
// 		executable,
// 		main,
// 		asar,
// 		name,
// 		platform,
// 		resourcesDir,
// 		// @ts-ignore
// 		arch,
// 	};
// }
