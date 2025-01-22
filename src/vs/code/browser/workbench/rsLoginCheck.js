/* eslint-disable header/header */

/* eslint-disable no-var */
var sCheckInProgress = false;
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
	var prefixEnd = path.indexOf("/s/");
	if (prefixEnd > 0) {
		return path.substring(0, prefixEnd);
	}
	return "";
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
							checkIndexedDB();
						}
						sLastSessionStatus = res.status;
					}
				}
				else {
					if (sLastSessionStatus !== 'Quit' || sLoggedOut) {
						rs_hideSessionDialog();
						// No job was found for the session so displaying quit
						rs_showSessionExitDialog('Quit');
						checkIndexedDB();
					}
					sLoggedOut = false;
					sLastSessionStatus = 'Quit';
				}
			}
			else if (xhr.status === 401) {
				rs_showLoggedOutDialog();
				clearStateDbs();
			}
			else {
				console.log(`Connection check status not ok: ${xhr.status}: ${xhr.statusText}:\n${xhr.responseText}`);
			}
		}
	};

	var url = '/job_launcher_rpc/session_status';
	var path = window.location.pathname;
	// look for prefix, e.g. /rstudio inserted by a proxy server
	var prefixEnd = path.indexOf("/s/");
	if (prefixEnd > 0) {
		var prefix = prefixEnd == 0 ? "" : path.substring(0, prefixEnd);
		path = path.substring(prefixEnd);
		url = prefix + url;
	}
	else if (prefixEnd === -1) {
		console.error(`Unrecognized workbench ${productName} session path: ${path}`);
	}

	sCheckInProgress = true;
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

function rs_initTimer() {
	// call setTimeout recursively because setInterval has the potential
	// to stack up calls if the function takes longer than the interval
	(function loop() {
		rs_checkConnectionRequest();
		setTimeout(() => {
			loop();
		}, 5000);
	})();
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
