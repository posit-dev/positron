# Python Extension

The Python Extension to the [Positron IDE](https://github.com/posit-dev/positron).

You can read more about Positron IDE development on the [Positron Wiki](https://connect.rstudioservices.com/positron-wiki).

## About

The extension is a fork of [Microsoft's Python VSCode extension](https://github.com/microsoft/vscode-python). The main TypeScript functionality (mostly UI) is implemented in [`src`](src) and calls out to Python scripts in [`python_files`](python_files).

We provide a custom Python Kernel based on the following open-source Python projects:

- [**IPyKernel**](https://github.com/ipython/ipykernel), a Jupyter kernel for the Python programming language written in Python
- [**Jedi Language Server**](https://github.com/pappasam/jedi-language-server), a language server built on the [pygls](https://github.com/openlawlibrary/pygls) (Python Generic Language Server Framework) using the [Jedi](https://github.com/davidhalter/jedi) library for autocompletion, static analysis, and refactoring

The entrypoint to our kernel is the [`positron_language_server.py`](python_files/posit/positron_language_server.py) script. The core functionality of the kernel can be found in the [`positron`](python_files/posit/positron/) package, which consists of these services:

- [`positron_ipkernel`](python_files/posit/positron/positron_ipkernel.py), the Python Kernel
- [`positron_jedilsp`](python_files/posit/positron/positron_jedilsp.py), the Python Language Server
- [`variables`](python_files/posit/positron/variables.py), manages Positron's Variables pane
- [`ui`](python_files/posit/positron/ui.py), manages Positron's Frontend comm channel (a global channel for communication unscoped to any particular view)
- [`help`](python_files/posit/positron/help.py), manages Positron's Help pane
- [`lsp`](python_files/posit/positron/lsp.py), manages the language server
- [`plots`](python_files/posit/positron/plots.py), a custom [IPython display publisher](https://github.com/ipython/ipython/blob/main/IPython/core/displaypub.py) that displays to Positron's Plots pane
- [`data_explorer`](python_files/posit/positron/data_explorer.py), manages Positron's Data Viewer

The various Positron services communicate with the front end via Jupyter's [comms](https://connect.rstudioservices.com/content/59a1f153-dcd8-44ac-849b-3371829b7002/positron-architecture.html#comms-and-ui-bindings) messaging protocol.

## Python development

When editing the Python source, **open a new workspace at the root `positron-python` folder** to use the settings for the various tools (linters, testers, etc) to match the CI workflows.

From the `positron-python/python_files` folder, you can run the following commands.

Format source files with [Black](https://github.com/psf/black):

```sh
black .
```

Type-check with [pyright](https://github.com/microsoft/pyright):

```sh
pyright
```

Install the test requirements that are used in CI:

```sh
pip install -r python_files/posit/pinned-test-requirements.txt
```

Run Positron's unit tests with [pytest](https://docs.pytest.org/en/8.0.x/):

```sh
python -m pytest python_files/posit/
```
