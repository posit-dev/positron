Your notebook needs a Python interpreter to execute code. Positron provides fluent tooling to discover, select, and manage interpreters.

- **Select an interpreter**: Use the command ["Select Interpreter Session"](command:workbench.action.language.runtime.selectSession) to choose which Python environment to use for your notebook. You can also click on the interpreter picker on the top right.
- **Discover new interpreters**: If you create a new virtual environment that Positron doesn't detect automatically, use ["Discover All Interpreters"](command:workbench.action.language.runtime.discoverAllRuntimes) to refresh the list.

Positron supports interpreters from virtual environments created via `venv`, `uv`, `pyenv`, `conda`, and other Python installations. Your selected interpreter will be used for running notebook cells and providing code completions.
