# Test ledger

Branch: midleman/python-interpreters-install-uv-from-the-create-v - Commit: 9e0cbdf306

## Environment
- Positron 2026.10.0 build 0, dev build of 9e0cbdf306 (Code - OSS 1.134.0), on Ubuntu 24.04.4 LTS (Linux x86_64).
- Kernels: Kallichore 0.1.71.
- Python 3.12.3 (system) and Python 3.14.6 picked by uv for the new venvs, with requests 2.32.3 from `requirements.txt`.
- Each scenario runs in its own Positron instance launched for this run with `HOME` pointed at an empty folder and `/root/.local/bin` and `/root/.venv/bin` dropped from `PATH`, so uv reads as not installed. The official uv installer writes uv into that empty home. Seed profile holds only the harness dialog settings.

## Logs
- logs/40783-renderer.log | Renderer process, the instance for the requirements.txt install | 7 errors, all startup noise (extension manifest and Copilot menu warnings, GitHub sign-in)
- logs/40783-exthost.log | Extension host, same instance | 1 error, GitHubLoginFailed
- logs/40783-code.log | Main process, same instance | no errors
- logs/40783-console.log | Browser console, same instance | 10 errors, the same startup noise
- logs/40783-python-language-pack.log | Python extension output, same instance | no errors
- logs/40783-python-35664781-console.log | Python 3.12.3 (System) console | no errors
- logs/40783-python-0ef3812d-console.log | Python 3.14.6 (uv: ws-req) console | no errors
- logs/40783-python-kernel.log | Python kernel | 2 errors, asyncio client_connected_cb at kernel start
- logs/37799-renderer.log | Renderer process, the instance for decline, failure and retry | 7 errors, startup noise
- logs/37799-exthost.log | Extension host, same instance | 1 error, GitHubLoginFailed
- logs/37799-code.log | Main process, same instance | no errors
- logs/37799-console.log | Browser console, same instance | 11 errors, startup noise
- logs/37799-python-language-pack.log | Python extension output, same instance | 1 error, the expected `Failed to install uv` from the failing curl
- logs/37799-python-d7dd90aa-console.log | Python 3.12.3 (System) console | no errors
- logs/37799-python-a2664fb9-console.log | Python 3.14.6 (uv: ws-req2) console | no errors
- logs/37799-python-kernel.log | Python kernel | 2 errors, asyncio client_connected_cb at kernel start
- logs/46133-renderer.log | Renderer process, the instance with the setting off | 7 errors, startup noise
- logs/46133-exthost.log | Extension host, same instance | 1 error, GitHubLoginFailed
- logs/46133-code.log | Main process, same instance | no errors
- logs/46133-console.log | Browser console, same instance | 11 errors, startup noise
- logs/46133-python-language-pack.log | Python extension output, same instance | no errors
- logs/46133-python-console.log | Python 3.12.3 (System) console | no errors
- logs/46133-python-kernel.log | Python kernel | no errors
- logs/38751-renderer.log | Renderer process, the pyproject.toml instance | 7 errors, startup noise
- logs/38751-exthost.log | Extension host, same instance | 2 errors, GitHubLoginFailed and a message to the exited 3.14.6 kernel after Delete and Recreate
- logs/38751-code.log | Main process, same instance | no errors
- logs/38751-console.log | Browser console, same instance | 9 errors, startup noise
- logs/38751-python-language-pack.log | Python extension output, same instance | no errors, holds the two Python downloads in Finding 1
- logs/38751-python-548c09be-console.log | Python 3.12.3 (System) console | no errors
- logs/38751-python-9608d615-console.log | Python 3.14.6 (uv: ws-pyproj) console | no errors
- logs/38751-python-3592c666-console.log | Python 3.11.17 (uv: ws-pyproj) console | no errors
- logs/38751-python-kernel.log | Python kernel | 6 errors, asyncio client_connected_cb at each kernel start
- logs/36323-renderer.log | Renderer process, the pre-launched instance, not driven | 7 errors, startup noise
- logs/36323-exthost.log | Extension host, pre-launched instance | 1 error, GitHubLoginFailed
- logs/36323-code.log | Main process, pre-launched instance | no errors
- logs/36323-console.log | Browser console, pre-launched instance | 10 errors, startup noise
- logs/all/ | Full log trees of each instance, by CDP port | the errors above

## Files
- files/ws-req/requirements.txt | `requirements.txt` pinning requests 2.32.3, the workspace file | S01, S02, S03, S04, S05
- files/fakebin/curl | A `curl` stand-in that fails to resolve the uv installer host, put first on `PATH` | S02, S03
- files/seed-off/User/settings.json | Seed user settings with `python.allowUvPythonInstall` false | S05, S06
- files/ws-pyproj/pyproject.toml | `pyproject.toml` depending on requests 2.32.3, the workspace file | S11, S13; Finding 1

---

## S01 - Install uv from the create venv from requirements.txt notification
Status: pass
Result: Yes on the notification asked to install uv, installed it, then created `.venv` with requests and started a uv console.
Issue: #16192 fix held

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- `requirements.txt` workspace | | A workspace holding only `requirements.txt` (`files/ws-req/requirements.txt`), with no `.venv`

Steps:
1. Run `Notifications: Show Notifications`.
2. VERIFY the Python notification offers to use uv to create a `.venv` from `requirements.txt` -> PASS
   Evidence: shots/S01-01.png
3. Click `Yes` on that notification.
4. VERIFY a modal asks to install uv, with `Install uv` and `Cancel` -> PASS
   Evidence: shots/S01-02.png
5. Click `Install uv`.
6. VERIFY an `Installing uv` notification shows, then a Python 3.14.6 (uv: ws-req) console starts -> PASS
   Evidence: shots/S01-03.png, actions.log:9, actions.log:10
7. Run `import requests, sys; print(requests.__version__, sys.prefix)` in the Python 3.14.6 (uv: ws-req) console.
8. VERIFY it prints `2.32.3` and the workspace `.venv` -> PASS
   Evidence: shots/S01-05.png, actions.log:15

## S02 - Decline the uv install offered by the requirements.txt notification
Status: pass
Result: Cancel on the install uv modal closed it quietly, with no error, no `.venv` and no uv written.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- `requirements.txt` workspace | | A workspace holding only `requirements.txt` (`files/ws-req/requirements.txt`), with no `.venv`
- Failing curl | | A `curl` that fails to resolve the uv installer host first on `PATH` (`files/fakebin/curl`), standing in for a network failure

Steps:
1. Run `Notifications: Show Notifications`.
2. Click `Yes` on the Python notification that offers to use uv to create a `.venv` from `requirements.txt`.
3. VERIFY a modal asks to install uv -> PASS
   Evidence: shots/S02-01.png
4. Click `Cancel`.
5. VERIFY no error notification shows, no `.venv` is created and only the System Python console is open -> PASS
   Evidence: shots/S02-02.png, actions.log:22

## S03 - A failed uv install from Create Environment shows an error with logs
Status: pass
Result: With the download failing, picking uv and Install uv showed `Failed to install uv.` with Show logs, and created nothing.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- `requirements.txt` workspace | | A workspace holding only `requirements.txt` (`files/ws-req/requirements.txt`), with no `.venv`
- Failing curl | | A `curl` that fails to resolve the uv installer host first on `PATH` (`files/fakebin/curl`), standing in for a network failure

Steps:
1. Run `Python: Create Environment...`.
2. VERIFY the environment type list offers uv -> PASS
   Evidence: shots/S03-01.png
3. Pick `uv`.
4. VERIFY a modal asks to install uv -> PASS
   Evidence: shots/S03-02.png
5. Click `Install uv`.
6. VERIFY an error notification `Failed to install uv.` with a `Show logs` button shows, and no `.venv` is created -> PASS
   Evidence: shots/S03-03.png, actions.log:29
7. Click `Show logs` on that notification.
8. VERIFY the Python Language Pack output shows the curl error `Could not resolve host` -> PASS
   Evidence: shots/S03-04.png

## S04 - Retry Create Environment with uv right after the install failure
Status: pass
Result: With the fault removed, the same pick installed uv, offered Python versions and made a `.venv` with requests.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- `requirements.txt` workspace | | A workspace holding only `requirements.txt` (`files/ws-req/requirements.txt`), with no `.venv`
- Failed uv install | S03 | The failed uv install from Create Environment just before

Steps:
1. Remove the failing `curl` from `PATH`.
2. Run `Python: Create Environment...`.
3. Pick `uv`.
4. VERIFY a modal asks to install uv again -> PASS
   Evidence: shots/S04-01.png
5. Click `Install uv`.
6. VERIFY uv is installed and a Python version list opens, starting at Python 3.14 -> PASS
   Evidence: shots/S04-02.png
7. Press Enter on the highlighted `Python` `3.14` row.
8. VERIFY a Python 3.14.6 (uv: ws-req2) console starts -> PASS
   Evidence: shots/S04-05.png, actions.log:46
9. Run `import requests; print(requests.__version__)` in the Python 3.14.6 (uv: ws-req2) console.
10. VERIFY it prints `2.32.3` -> PASS
    Evidence: shots/S04-06.png, actions.log:47

## S05 - The requirements.txt notification offers venv when the setting is off
Status: pass
Result: With Allow Uv Python Install off and no uv, the notification said venv, and Yes opened a type list with Venv and Conda but no uv.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- `requirements.txt` workspace | | A workspace holding only `requirements.txt` (`files/ws-req/requirements.txt`), with no `.venv`
- Setting off | | `python.allowUvPythonInstall` set to `false` in user settings (`files/seed-off/User/settings.json`)

Steps:
1. Run `Notifications: Show Notifications`.
2. VERIFY the Python notification offers to use venv, not uv, to create a `.venv` from `requirements.txt` -> PASS
   Evidence: shots/S05-01.png
3. Click `Yes` on that notification.
4. VERIFY no install uv modal opens, and the environment type list shows Venv and Conda without uv -> PASS
   Evidence: shots/S05-02.png

## S06 - Install Python via uv is hidden from the Command Palette when the setting is off
Status: pass
Result: With Allow Uv Python Install off, the palette did not list `Python: Install Python via uv`.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- Setting off | | `python.allowUvPythonInstall` set to `false` in user settings (`files/seed-off/User/settings.json`)

Steps:
1. Open the Command Palette and type `Python: Install Python via uv`.
2. VERIFY the Command Palette does not list `Python: Install Python via uv` -> PASS
   Evidence: shots/S06-01.png, actions.log:54

## S07 - Turning the setting on brings uv back without a reload
Status: pass
Result: After setting Allow Uv Python Install to true, the palette listed Install Python via uv and Create Environment listed uv.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- Setting off | | `python.allowUvPythonInstall` set to `false` in user settings (`files/seed-off/User/settings.json`)

Steps:
1. Set `python.allowUvPythonInstall` to `true` in user settings.
2. VERIFY the Command Palette lists `Python: Install Python via uv` -> PASS
   Evidence: shots/S07-01.png
3. Run `Python: Create Environment...`.
4. VERIFY the environment type list offers Venv, Conda and uv -> PASS
   Evidence: shots/S07-02.png

## S08 - Picking uv after the setting is turned off shows an error that links to the setting
Status: pass
Result: Picking uv with the setting just turned off showed an error naming the setting, and its link opened Settings at Allow Uv Python Install.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- Create Environment open | S07 | The environment type list from `Python: Create Environment...`, offering uv

Steps:
1. Set `python.allowUvPythonInstall` to `false` in user settings.
2. Pick `uv`.
3. VERIFY no install uv modal opens, and an error says uv is not installed and installing it is turned off by the Allow Uv Python Install setting, with that name as a link -> PASS
   Evidence: shots/S08-01.png
4. Click the `Allow Uv Python Install` link in that error.
5. VERIFY Settings opens filtered to `python.allowUvPythonInstall`, showing it unchecked -> PASS
   Evidence: shots/S08-03.png

## S09 - Turning the setting back on from the error's link lets uv be picked again
Status: pass
Result: With the setting off uv was missing from Create Environment, and once checked from the error's link, picking uv offered to install it.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- Setting off with error | S08 | The uv setting off error notification from just before, still on screen

Steps:
1. Run `Python: Create Environment...`.
2. VERIFY the environment type list shows Venv and Conda without uv -> PASS
   Evidence: shots/S09-02.png, actions.log:71
3. Press Escape to close the environment type list.
4. Click the `Allow Uv Python Install` link in the error notification.
5. Check the `python.allowUvPythonInstall` checkbox in Settings.
6. VERIFY the setting shows as checked and Modified -> PASS
   Evidence: shots/S09-03.png, actions.log:75
7. Press Escape to close the Settings modal.
8. Run `Python: Create Environment...`.
9. Pick `uv`.
10. VERIFY a modal asks to install uv -> PASS
    Evidence: shots/S09-04.png

## S10 - New Folder from Template does not offer uv when the setting is off
Status: pass
Result: With the setting off and no uv, the Python Environment step offered only Venv and Conda.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- Setting off | | `python.allowUvPythonInstall` set to `false` in user settings

Steps:
1. Click `Cancel` on the install uv modal.
2. Set `python.allowUvPythonInstall` to `false` in user settings.
3. Click the `New` toolbar button.
4. Click `New Folder from Template...`.
5. Click the `Python Project` template.
6. Click `Next`.
7. Click `Next`.
8. VERIFY the Python Environment step shows Create a new virtual environment with Venv selected -> PASS
   Evidence: shots/S10-01.png
9. Click the `Venv` environment creation dropdown.
10. VERIFY the dropdown lists Venv and Conda but not uv -> PASS
    Evidence: shots/S10-02.png, actions.log:98

## S11 - Install uv from the pyproject.toml notification and sync
Status: pass
Result: Yes on the pyproject.toml notification installed uv after consent, ran `uv sync` and started a uv console with requests.

Preconditions:
- No uv | | uv not on `PATH` and not in `~/.local/bin` or `~/.cargo/bin`
- `pyproject.toml` workspace | | A workspace holding only `pyproject.toml` (`files/ws-pyproj/pyproject.toml`), with no `.venv` and no `uv.lock`

Steps:
1. Run `Notifications: Show Notifications`.
2. VERIFY the Python notification offers to use uv to create a `.venv` from `pyproject.toml` -> PASS
   Evidence: shots/S11-01.png
3. Click `Yes` on that notification.
4. VERIFY a modal asks to install uv -> PASS
   Evidence: shots/S11-02.png
5. Click `Install uv`.
6. Run `import requests, sys; print(requests.__version__, sys.prefix)` in the Python 3.14.6 (uv: ws-pyproj) console.
7. VERIFY it prints `2.32.3` and the workspace `.venv` -> PASS
   Evidence: shots/S11-03.png, actions.log:108

## S12 - uv installed by the notification is listed first in Create Environment
Status: pass
Result: After the notification installed uv, Create Environment listed uv first, then Venv and Conda.

Preconditions:
- uv installed by Positron | S11 | uv in `~/.local/bin`, not on `PATH`, installed by the notification

Steps:
1. Run `Python: Create Environment...`.
2. VERIFY the environment type list shows uv first -> PASS
   Evidence: shots/S12-01.png

## S13 - Create Environment with uv downloads a Python while the setting is off
Status: fail - Finding 1
Result: Fails 2/2

Preconditions:
- uv installed | S11 | uv 0.12.9 installed in `~/.local/bin`
- Pythons on the machine | | Python 3.12.3 and 3.14.6 installed, and no other version
- `pyproject.toml` workspace with `.venv` | S11 | The workspace from `files/ws-pyproj/pyproject.toml`, with the `.venv` the notification made

Steps:
1. Set `python.allowUvPythonInstall` to `false` in user settings.
2. Run `Python: Create Environment...`.
3. VERIFY the environment type list still offers uv, which is installed -> PASS
   Evidence: shots/S13-01.png
4. Press Escape to close the environment type list.
5. Run `Python: Create Environment...`.
6. Pick `uv`.
7. Pick `Delete and Recreate`.
8. VERIFY the Python version list offers only the Pythons on the machine, 3.14 and 3.12 -> FAIL - Finding 1
   Observed: The list offers Python `3.14`, `3.13`, `3.12`, `3.11`, `3.10` and `3.9`, though only 3.14 and 3.12 are installed
   Evidence: shots/S13-03.png
   Log: logs/38751-python-language-pack.log:448 | Extension host | 2x (after each version pick)
     Downloading cpython-3.11.17-linux-x86_64-gnu (download) (29.4MiB)
9. Pick the `Python` `3.11` row with the arrow keys and Enter.
10. VERIFY no Python is downloaded -> FAIL - Finding 1
    Observed: uv downloads CPython 3.11.17 and a Python 3.11.17 (uv: ws-pyproj) console starts
    Evidence: shots/S13-04.png, logs/38751-uv-python-dir.txt

---

## Noticed
- O01 - After Delete and Recreate rebuilt `.venv` with Python 3.10, the console list still showed only the Python 3.11.17 (uv: ws-pyproj) console and no 3.10 one - seen in the second try of the setting off download, outside this change, not checked
- O02 - Declining the uv install from the requirements.txt notification leaves no way to get a plain venv from it, since the notification now only offers uv while the setting is on - a design question, not a defect a check can settle
- O03 - The error notification's accessible name reads the raw markdown, `[Allow Uv Python Install](command:workbench.action.openSettings?...)`, so a screen reader announces the command URI - seen in the accessibility tree, likely shared by every notification with a link, not checked

## Not run
- N01 - Install uv from the uv.lock notification - the change does not touch that path
- N02 - Windows PowerShell uv installer - environment: Linux only
- N03 - Install uv from the New Folder flow's Install uv button - unchanged code, ran out of priority
- N04 - Learn more on the install uv modal - unchanged by the change
