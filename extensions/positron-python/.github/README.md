# Positron Python Extension

The Python Extension to the [Positron IDE](https://github.com/rstudio/positron).

You can read more about Positron IDE development on the [Positron Wiki](https://connect.rstudioservices.com/positron-wiki).

## About

The extension is a fork of [Microsoft's Python VSCode extension](https://github.com/microsoft/vscode-python). The main TypeScript functionality (mostly UI) is implemented in [`src`](../src) and calls out to Python scripts in [`pythonFiles`](../pythonFiles).

We provide a custom Positron Python Kernel based on the following open source Python projects:

- [**IPyKernel**](https://github.com/ipython/ipykernel), a Jupyter kernel for the Python programming language written in Python
- [**Jedi Language Server**](https://github.com/pappasam/jedi-language-server), a language server built on the [pygls](https://github.com/openlawlibrary/pygls) (Python Generic Language Server Framework) using the [Jedi](https://github.com/davidhalter/jedi) library for autocompletion, static analysis, and refactoring

The entrypoint to our kernel is the [`positron_language_server.py`](../pythonFiles/positron_language_server.py) script. The core functionality of the kernel can be found in the [`positron`](../pythonFiles/positron/) package, which consists of these services:

- [`positron_ipkernel`](../pythonFiles/positron/positron_ipkernel.py), the Positron Python Kernel
- [`positron_jedilsp`](../pythonFiles/positron/positron_jedilsp.py), the Positron Python Language Server
- [`environment`](../pythonFiles/positron/environment.py), manages Positron's Environment pane
- [`frontend`](../pythonFiles/positron/frontend.py), manages Positron's Frontend comm channel (a global channel for communication unscoped to any particular view)
- [`help`](../pythonFiles/positron/help.py), manages Positron's Help pane
- [`lsp`](../pythonFiles/positron/lsp.py), manages the language server
- [`plots`](../pythonFiles/positron/plots.py), a custom [IPython display publisher](https://github.com/ipython/ipython/blob/main/IPython/core/displaypub.py) that displays to Positron's Plots pane
- [`dataviewer`](../pythonFiles/positron/dataviewer.py), manages Positron's Data Viewer

The various Positron services communicate with the front end via Jupyter's [comms](https://connect.rstudioservices.com/content/59a1f153-dcd8-44ac-849b-3371829b7002/positron-architecture.html#comms-and-ui-bindings) messaging protocol.

## Python development

When editing the Python source, it's recommended to open a new workspace at the [`pythonFiles`](../pythonFiles) folder, since that will configure your editor as well as the various tools (linters, testers, etc) to match that of the CI workflows.

From the `pythonFiles` folder, you can run the following commands.

Format source files with [Black](https://github.com/psf/black):

```sh
black .
```

Type-check with [pyright](https://github.com/microsoft/pyright):

```sh
pyright
```

Install test requirements:

```sh
pip install -r ../build/test-requirements.txt
```

Run tests:

```sh
python tests/run_all.py
```
