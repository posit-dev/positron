/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable header/header */
/* eslint-disable no-var */
var sCheckInProgress = false;
var sDialogVisible = false;
var sLastSessionStatus = null;
var sLoggedOut = false;
var sCSRFToken = null;
const previousDatabaseContents = {};

function rs_openLoginTab() {
	window.open('/', 'rs_login');
}

function rs_navigateToWorkbench() {
	window.location.assign('/');
}

function rs_showLoggedOutDialog() {
	sLoggedOut = true;
	rs_showSessionDialog('Posit Workbench Login Required', 'Login expired or signed out from another window.<br>Select "Login" for a new login tab. Return here to resume session.', 'Login', rs_openLoginTab);
}

function rs_showSessionExitDialog(sessionStatus) {
	rs_showSessionDialog('Posit Workbench Session Exited', 'Session status: ' + sessionStatus, 'Return to Posit Workbench', rs_navigateToWorkbench);
}

function rs_hideSessionDialog() {
	if (!sDialogVisible) {
		return;
	}

	var dialogElem = document.getElementById('rs_session_dialog');
	if (dialogElem !== null) {
		dialogElem.parentNode.removeChild(dialogElem);
	}
	sDialogVisible = false;
}

function rs_showSessionDialog(hdr, msg, actionName, actionFunc) {
	if (sDialogVisible) {
		return;
	}

	var div = document.createElement('div');
	div.setAttribute('id', 'rs_session_dialog');
	div.style.cssText = 'position:fixed;width:100%;height:100%;left:0;top:0;z-index:3000;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;font-family:Lato, sans-serif;';
	div.innerHTML = `<div style='width: 75%; height: 20%; background: rgba(257,258,259,1.0); color: #000; border: 5px solid #ffffff; text-align: center;  padding-top: 2.5%'>
		<style type='text/css'>.rs-button { cursor: pointer; border-radius: 4px; border: 0; background-color: #4c83b6; color: #f7f8f9; font-size: 135%; padding-left: 10px; padding-right: 10px; height: 30px; verticle-align: middle; }</style>
		<p style='color:#4c83b6; font-size: 180%;'>${hdr}</p><p style='font-size: 130%; font-weight: regular'>${msg}</p>
		<button id='rs_action_button' class='rs-button'>${actionName}</button>&nbsp;
		<button id='rs_dismiss_button' class='rs-button'>Dismiss</button>;
	</div>`;
	document.body.appendChild(div);
	var actionButton = document.getElementById('rs_action_button');
	actionButton.addEventListener('click', actionFunc);
	var dismissButton = document.getElementById('rs_dismiss_button');
	dismissButton.addEventListener('click', rs_hideSessionDialog);
	sDialogVisible = true;
}

function rs_checkConnectionRequest() {
	var xhr = new XMLHttpRequest();

	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) {
			sCheckInProgress = false;
			if (xhr.status === 200) {
				var res = JSON.parse(xhr.responseText);
				if (res.result) {
					if (sLastSessionStatus !== res.status || sLoggedOut) {
						sLoggedOut = false;
						rs_hideSessionDialog();
						if (res.status !== 'Running') {
							rs_showSessionExitDialog(res.status);
							checkIndexedDB(sCSRFToken);
						}
						sLastSessionStatus = res.status;
					}
				}
				else {
					if (sLastSessionStatus !== 'Quit' || sLoggedOut) {
						rs_hideSessionDialog();
						// No job was found for the session so displaying quit
						rs_showSessionExitDialog('Quit');
						checkIndexedDB(sCSRFToken, true);
					}
					sLoggedOut = false;
					sLastSessionStatus = 'Quit';
				}
			}
			else if (xhr.status === 401) {
				rs_showLoggedOutDialog();
				clearVSCodeDb();
			}
			else {
				console.log(`Connection check status not ok: ${xhr.status}: ${xhr.statusText}:\n${xhr.responseText}`);
			}
		}
	};

	var url = '/job_launcher_rpc/session_status';

	sCheckInProgress = true;
	xhr.open('POST', url, true);
	xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
	xhr.setRequestHeader('X-RS-CSRF-Token', sCSRFToken);
	var path = window.location.pathname;
	var sessionId = path.substring(path.length - 9);
	sessionId = sessionId.substring(0, sessionId.length - 1);

	var jsonBody = JSON.stringify({ 'method': 'session_status', 'params': [sessionId] });
	xhr.send(jsonBody);
}

async function clearVSCodeDb() {
	try {
		const databases = await indexedDB.databases();
		for (const db of databases) {
			if (db.name && db.name.startsWith('vscode-web')) {
				indexedDB.deleteDatabase(db.name);
			}
		}
	} catch (error) {
		console.error('Error accessing IndexedDB: ', error);
	}
}

function rs_initTimer() {
	setInterval(rs_checkConnectionRequest, 5000);
	setInterval(checkIndexedDB, 300000, sCSRFToken);
	checkIndexedDB(sCSRFToken);
}

function rs_loginCheckInit() {
	var xhr = new XMLHttpRequest();
	var path = window.location.pathname;
	var url = '/';

	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) {
			if (xhr.status === 200) {
				var txt = xhr.responseText;
				var pattern = '<meta name="rs-csrf-token" content=';
				var ix = txt.indexOf(pattern);
				if (ix === -1) {
					console.log('Pattern not found for csrf token');
				} else {
					var startIx = ix + pattern.length + 1;
					var endIx = txt.indexOf('"', startIx);
					if (endIx === -1) {
						console.log('End of pattern not found for csrf token in: ' + pattern + ' at: ' + startIx);
					} else {
						sCSRFToken = txt.substring(startIx, endIx);
						rs_initTimer();
					}
				}
			}
			else {
				console.log('Error response from workspaces request for csrf token: ' + xhr.status + ': ' + xhr.responseText);
			}
		}
	};
	xhr.open('GET', url, true);
	xhr.send();
}

async function checkIndexedDB(csrfToken, clearDB = false) {
	if (localStorage.getItem('clear-vscode-db-on-logout') !== 'true') {
		return;
	}
	try {
		const databases = (await indexedDB.databases()).filter(db => db.name && db.name.startsWith('vscode-web'));
		for (const db of databases) {
			if (!db.name) { continue; }
			const previousContents = previousDatabaseContents[db.name] || '';
			const contents = JSON.stringify(await getDatabaseContents(db.name));
			// we could be more specific with this check since the key order is not guaranteed
			if (previousContents !== contents) {

				const xhr = new XMLHttpRequest();
				xhr.open('POST', '/storage/vscode_session_state', true);
				xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
				xhr.setRequestHeader('X-RS-CSRF-Token', csrfToken);
				xhr.onreadystatechange = function () {
					if (xhr.readyState === 4) {
						if (xhr.status === 200) {
							previousDatabaseContents[db.name] = contents;
						}
					}
				};
				xhr.send(JSON.stringify({ 'method': 'vscode_session_state', 'params': [db.name, contents] }));
			}
		}
	} catch (error) {
		console.error('Error accessing IndexedDB: ', error);
	} finally {
		if (clearDB) {
			clearVSCodeDb();
		}
	}
}

async function getDatabaseContents(dbName) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName);
		request.onsuccess = () => {
			const db = request.result;
			const transaction = db.transaction(db.objectStoreNames, 'readonly');
			const dbMap = new Map();

			let completedStores = 0;
			for (const storeName of db.objectStoreNames) {
				const objectStore = transaction.objectStore(storeName);
				const cursor = objectStore.openCursor();
				if (!cursor) { // This means the store is empty
					continue;
				}

				// Iterate over the rows of the store
				const rows = new Map();
				cursor.onsuccess = () => {
					if (cursor.result) {
						rows.set(cursor.result.key.toString(), JSON.stringify(cursor.result.value));
						cursor.result.continue();
					} else {
						completedStores++;
						if (rows.size !== 0) {
							dbMap.set(storeName, JSON.stringify(Object.fromEntries(rows)));
						}
						// only resolve after iterating through all stores
						if (completedStores === db.objectStoreNames.length) {
							resolve(Object.fromEntries(dbMap));
						}
					}
				};
				cursor.onerror = () => {
					console.error(`IndexedDB cursor error for store ${storeName}: ${cursor.error} `);
					completedStores++;
					if (rows.size !== 0) {
						dbMap.set(storeName, JSON.stringify(Object.fromEntries(rows)));
					}
					if (completedStores === db.objectStoreNames.length) {
						resolve(Object.fromEntries(dbMap));
					}
				};
			}
			transaction.onerror = () => {
				console.error(`IndexedDB transaction error for store ${storeName}: ${transaction.error} `);
				resolve(Object.fromEntries(rows));
				db.close();
			};
			transaction.oncomplete = () => {
				db.close();
			};
		};

		request.onerror = (event) => {
			reject(event);
		};
	});
}

rs_loginCheckInit();
