/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-var */
var sDialogVisible = false;
var sLastSessionStatus = null;
var sLoggedOut = false;
var sCSRFToken = null;
var dbDeleteInProgress = false;
var dbDeleteComplete = false;
const PWB_OPEN_CONNECTION_KEY = 'pwb-connections';
const PWB_CHANGED_CONNECTION_KEY = 'pwb-changed-connections';
const oldConnections = new Set();
const inProgressDBs = new Set();
const PROBE_INTERVAL_VISIBLE_MS = 5000;
const PROBE_INTERVAL_HIDDEN_MS = 60000;
var sProbeTimer = null;
// rstudio-pro#13201 phase 2: login state shared between Workbench tabs.
// Message schema: { type: 'pwb-login-state', version: 1, loggedIn: <boolean> }.
const PROBE_INTERVAL_LOGGED_OUT_MS = 600000;
const PWB_LOGIN_STATE_CHANNEL = 'pwb-login-state';
var sLoginChannel = null;
var sKnownLoginState = null; // last login state seen from our own probe or the channel
var sPolling = false;
var sProbeEpoch = 0; // bumped when a probe supersedes the ones in flight (their responses may predate what it learns)

// --- Start Positron ---
const productName = 'positron';
// --- End Positron ---

function rs_openLoginTab() {
	window.open(rs_getWorkbenchPrefix() + '/', 'rs_login');
}

function rs_navigateToWorkbench() {
	window.location.assign(rs_getWorkbenchPrefix() + '/');
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
		<button id='rs_action_button' class='rs-button'>${actionName}</button>
	</div>`;
	document.body.appendChild(div);
	var actionButton = document.getElementById('rs_action_button');
	actionButton.addEventListener('click', actionFunc);
	sDialogVisible = true;
}

function rs_getWorkbenchPrefix() {
	var path = window.location.pathname;
	// look for prefix, e.g. /rstudio inserted by a proxy server
	var prefixEnd = path.indexOf('/s/');
	if (prefixEnd > 0) {
		return path.substring(0, prefixEnd);
	}
	return '';
}

// Statuses after which the session never accepts connections again ('Quit' = job not found).
function rs_isSessionExited(status) {
	return ['Failed', 'Finished', 'Killed', 'Canceled', 'Quit'].indexOf(status) !== -1;
}

// Tell the workbench whether the session has exited. pwbSessionExitListener.ts stops the
// remote reconnection loop once it has, so this tab stops opening WebSockets that Workbench
// answers with 502 (rstudio-pro#13201). Only a boolean is published so the workbench stays
// independent of Workbench's job statuses. The global covers a listener that registers
// after the event has already fired.
function rs_publishSessionExited(exited) {
	window.pwbSessionExited = exited;
	window.dispatchEvent(new CustomEvent('pwb-session-exited', { detail: { exited: exited } }));
}

// Tell the workbench (pwbReconnectionGate.ts) whether the user is logged in. While logged out
// the reconnect loop waits 10 min between attempts instead of opening WebSockets the Workbench
// proxy will refuse (rstudio-pro#13201).
function rs_publishLoginState(loggedIn) {
	window.pwbLoggedIn = loggedIn;
	window.dispatchEvent(new CustomEvent('pwb-login-state', { detail: { loggedIn: loggedIn } }));
}

// Our own probe saw `loggedIn`: tell the workbench, and tell the other tabs if it is news.
function rs_reportProbeLoginState(loggedIn) {
	rs_publishLoginState(loggedIn);
	if (loggedIn === sKnownLoginState) {
		return;
	}
	sKnownLoginState = loggedIn;
	if (sLoginChannel) {
		sLoginChannel.postMessage({ type: 'pwb-login-state', version: 1, loggedIn: loggedIn });
	}
}

function rs_handleLoggedOut() {
	var wasLoggedOut = sLoggedOut;
	rs_showLoggedOutDialog();
	clearStateDbs();
	rs_publishLoginState(false);
	if (!wasLoggedOut) {
		rs_scheduleProbe(); // switch to the logged-out cadence
	}
}

// Join the Workbench-wide login-state channel (the homepage posts on it too). Without
// BroadcastChannel this tab keeps polling on its own as before.
function rs_openLoginStateChannel() {
	if (typeof BroadcastChannel !== 'function') {
		return;
	}
	sLoginChannel = new BroadcastChannel(PWB_LOGIN_STATE_CHANNEL);
	sLoginChannel.onmessage = function (e) {
		var data = e.data;
		if (!data || data.type !== 'pwb-login-state' || typeof data.loggedIn !== 'boolean') {
			return;
		}
		if (data.loggedIn === sKnownLoginState) {
			return; // nothing new
		}
		sKnownLoginState = data.loggedIn;
		if (!data.loggedIn && !sLoggedOut) {
			// Another tab got a 401; it applies to this tab too.
			rs_handleLoggedOut();
		} else if (data.loggedIn && sLoggedOut) {
			// Logged back in elsewhere. Probe first, so an exited session is reported
			// (and stops reconnecting) before the login cuts the reconnect wait short.
			// Probes already in flight predate the login and may report 401: drop them.
			rs_probeNow(true);
		}
	};
}

function rs_checkConnectionRequest() {
	var xhr = new XMLHttpRequest();
	var epoch = sProbeEpoch;

	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) {
			if (epoch !== sProbeEpoch) {
				return; // a newer probe superseded this one; its response may predate the latest state
			}
			if (xhr.status === 200) {
				var wasLoggedOut = sLoggedOut;
				var res = JSON.parse(xhr.responseText);
				if (res.result) {
					if (sLastSessionStatus !== res.status || sLoggedOut) {
						sLoggedOut = false;
						rs_hideSessionDialog();
						if (res.status !== 'Running') {
							rs_showSessionExitDialog(res.status);
							checkIndexedDB();
						}
						sLastSessionStatus = res.status;
						rs_publishSessionExited(rs_isSessionExited(res.status));
					}
				}
				else {
					if (sLastSessionStatus !== 'Quit' || sLoggedOut) {
						rs_hideSessionDialog();
						// No job was found for the session so displaying quit
						rs_showSessionExitDialog('Quit');
						checkIndexedDB();
						rs_publishSessionExited(true);
					}
					sLoggedOut = false;
					sLastSessionStatus = 'Quit';
				}
				// After rs_publishSessionExited above: an exited session must stop
				// reconnecting before the login cuts the reconnect wait short.
				rs_reportProbeLoginState(true);
				if (wasLoggedOut) {
					rs_scheduleProbe(); // back to the normal cadence
				}
			}
			else if (xhr.status === 401) {
				rs_handleLoggedOut();
				rs_reportProbeLoginState(false);
			}
			else {
				console.log(`Connection check status not ok: ${xhr.status}: ${xhr.statusText}:\n${xhr.responseText}`);
			}
		}
	};

	var url = '/job_launcher_rpc/session_status';
	var path = window.location.pathname;
	// look for prefix, e.g. /rstudio inserted by a proxy server
	var prefixEnd = path.indexOf('/s/');
	if (prefixEnd > 0) {
		var prefix = prefixEnd === 0 ? '' : path.substring(0, prefixEnd);
		path = path.substring(prefixEnd);
		url = prefix + url;
	}
	else if (prefixEnd === -1) {
		console.error(`Unrecognized workbench ${productName} session path: ${path}`);
	}

	xhr.open('POST', url, true);
	xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
	xhr.setRequestHeader('X-RS-CSRF-Token', sCSRFToken);
	var sessionId = path.substring(path.length - 9);
	sessionId = sessionId.substring(0, sessionId.length - 1);

	var jsonBody = JSON.stringify({ 'method': 'session_status', 'params': [sessionId] });
	xhr.send(jsonBody);
}

async function clearIndexedDB(name) {
	return new Promise((resolve, reject) => {
		// We don't know if we've actually lost data here because databases remain on the in progress list
		// after their state has been saved and while rserver is processing it
		if (inProgressDBs.has(name)) {
			console.warn(`Clearing a database that is currently being saved: ${name}. This may result in state loss.`);
		}

		const request = indexedDB.open(name);
		request.onsuccess = function () {
			const db = request.result;
			if (!db.objectStoreNames) {
				resolve();
				return;
			}
			const objectStoreNames = db.objectStoreNames;
			for (let i = 0; i < objectStoreNames.length; i++) {
				const objectStoreName = objectStoreNames[i];
				const objectStore = db.transaction([objectStoreName], 'readwrite').objectStore(objectStoreName);
				objectStore.clear();
			}
			resolve();
		};
		request.onerror = function (event) {
			console.error('Error clearing IndexedDB: ', event);
			reject();
		};
	});
}

async function clearStateDbs() {
	if (dbDeleteInProgress || dbDeleteComplete) { return; }
	dbDeleteInProgress = true;
	try {
		await checkIndexedDB();

		const openConnections = getConnections(PWB_OPEN_CONNECTION_KEY);
		const allDBs = new Set([...openConnections, ...oldConnections]);

		const databases = (await indexedDB.databases()).filter(db => db.name && allDBs.has(db.name));
		const promises = [];
		for (const db of databases) {
			promises.push(clearIndexedDB(db.name));
		}
		await Promise.allSettled(promises);
		dbDeleteComplete = true;
	} catch (error) {
		console.error('Error accessing IndexedDB: ', error);
	}
	dbDeleteInProgress = false;
}

function rs_nextProbeDelay() {
	if (sLoggedOut && sLoginChannel) {
		// Another tab or the homepage announces the next login; this keep-alive only
		// covers a login made on a page that never posts (e.g. an RStudio session).
		return PROBE_INTERVAL_LOGGED_OUT_MS;
	}
	// Nobody is watching a hidden tab, so probe it less often.
	return document.hidden ? PROBE_INTERVAL_HIDDEN_MS : PROBE_INTERVAL_VISIBLE_MS;
}

// (Re)start the wait before the next probe. setTimeout rather than setInterval, so slow
// probes can't stack up.
function rs_scheduleProbe() {
	if (!sPolling) {
		return;
	}
	clearTimeout(sProbeTimer);
	// Arrow wrapper: the timer must never pass an argument that rs_probeNow reads as `supersedeInFlight`.
	sProbeTimer = setTimeout(() => rs_probeNow(), rs_nextProbeDelay());
}

// `supersedeInFlight`: drop the responses of probes already in flight. They were sent earlier,
// so their answers (e.g. a 401 from before a login) must not overwrite what this probe learns.
// Only for event-driven probes: the timer must not supersede, or a slow probe would never
// get its response applied.
function rs_probeNow(supersedeInFlight) {
	if (supersedeInFlight) {
		sProbeEpoch++;
	}
	rs_checkConnectionRequest();
	rs_scheduleProbe();
}

function rs_initTimer() {
	sPolling = true;
	rs_probeNow();
	// Don't make a returning user wait out a pending hidden-tab or logged-out delay.
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			rs_probeNow(true);
		}
	});
	window.addEventListener('focus', () => {
		if (sLoggedOut) {
			rs_probeNow(true);
		}
	});
}

async function rs_initAsyncTimer() {
	(async function loop() {
		if (sLastSessionStatus !== 'Quit' && !sLoggedOut && !dbDeleteInProgress) {
			await checkIndexedDB();
		}
		setTimeout(() => {
			loop();
		}, 300000);
	})();
}

function rs_loginCheckInit() {
	var xhr = new XMLHttpRequest();
	var path = window.location.pathname;
	var url = rs_getWorkbenchPrefix() + '/';

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
						rs_openLoginStateChannel();
						rs_initTimer();
						rs_initAsyncTimer();
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

function getConnections(key) {
	const connectionString = sessionStorage.getItem(key);
	if (connectionString) {
		return new Set(JSON.parse(connectionString));
	}
	return new Set();
}

function pwbRemoveFromSessionSet(dbName, key) {
	const connectionSet = getConnections(key);
	if (connectionSet.delete(dbName)) {
		sessionStorage.setItem(key, JSON.stringify(Array.from(connectionSet)));
	}
}

function sendSessionState(dbName, content) {
	const xhr = new XMLHttpRequest();
	xhr.open('POST', rs_getWorkbenchPrefix() + '/storage/session_state', true);
	xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
	xhr.setRequestHeader('X-RS-CSRF-Token', sCSRFToken);
	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) {
			if (xhr.status === 200) {
				inProgressDBs.delete(dbName);
				if (!getConnections(PWB_OPEN_CONNECTION_KEY).has(dbName) && !getConnections(PWB_CHANGED_CONNECTION_KEY).has(dbName)) {
					oldConnections.add(dbName);
				}
			}
		}
	};
	xhr.onerror = function (error) {
		console.error('Error saving state content to server: ', error.getMessage());
	};
	xhr.send(JSON.stringify({ 'method': 'session_state', 'params': [productName, dbName, JSON.stringify(content)] }));
}

async function checkIndexedDB() {
	if (localStorage.getItem(`clear-${productName}-db-on-logout`) !== 'true') {
		return;
	}
	try {
		const changedConnections = getConnections(PWB_CHANGED_CONNECTION_KEY);
		const databases = (await indexedDB.databases()).filter(db => db.name && changedConnections.has(db.name));
		for (const db of databases) {

			// don't await here, we want to check all DBs in parallel
			// and any failures will be picked up next time around
			getDatabaseContents(db.name).then((content) => {
				if (content && dbDeleteComplete) {
					dbDeleteComplete = false;
				}
				// as soon as we have the DB content, remove it from the changed list to minimize the risk of code server adding it
				// back to the change list before we've saved these changes
				pwbRemoveFromSessionSet(db.name, PWB_CHANGED_CONNECTION_KEY);
				inProgressDBs.add(db.name);
				sendSessionState(db.name, content);
			});
		}
	} catch (error) {
		console.error('Error accessing IndexedDB: ', error);
	}
}

function getDatabaseContents(dbName) {
	const request = indexedDB.open(dbName);
	return new Promise((resolve, reject) => {
		request.onsuccess = () => {
			const db = request.result;
			if (!db.objectStoreNames || db.objectStoreNames.length === 0) {
				resolve([0, {}]);
				return;
			}
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
				db.close();
				reject(`IndexedDB transaction error for database ${db.name}: ${transaction.error} `);
			};
			transaction.oncomplete = () => {
				db.close();
			};
		};

		request.onblocked = (event) => {
			reject(event);
		};

		request.onerror = (event) => {
			reject(event);
			const db = request.result;
			db.close();
		};
	});
}


rs_loginCheckInit();
