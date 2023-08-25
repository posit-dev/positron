# The Positron IDE

This repository hosts the source code for the Positron IDE, a fork of [Visual Studio Code](https://github.com/microsoft/vscode) that provides a batteries-included, opinionated environment for data science and scientific authoring.

You can read more about Positron IDE development on the [Positron Wiki](https://connect.rstudioservices.com/positron-wiki).

## Extensions

Positron is a highly extensible IDE. Its foundation is implemented in [`src`](../src), however, much of the core functionality is provided through [`extensions`](../extensions).

Positron provides the following built-in extensions:

- [**Jupyter Adapter**](../extensions/jupyter-adapter), the interface between the front end and language extensions described below
- [**Positron R**](../extensions/positron-r), the Positron extension for the R programming language powered by [ARK](https://github.com/posit-dev/amalthea/tree/main/crates/ark) (the Amalthea R kernel -- our Rust-based kernel for R) which is built on top of our [Amalthea](https://github.com/posit-dev/amalthea) Jupyter kernel framework and the open source [tower-lsp](https://github.com/ebkalderon/tower-lsp) LSP framework
- [**Positron Python**](https://github.com/posit-dev/positron-python), the Positron extension for the Python programming language, a fork of [Microsoft's Python VSCode extension](https://github.com/microsoft/vscode-python) built on top of the open source Python-based kernel [IPyKernel](https://github.com/ipython/ipykernel) and [Jedi Language Server](https://github.com/pappasam/jedi-language-server)
- [**Positron Zed**](https://github.com/posit-dev/positron/tree/main/extensions/positron-zed), the Positron extension for a test-bed language, intended for fast simulations primarily to aid UI development
- [**Positron Data Viewer**](https://github.com/posit-dev/positron/tree/main/extensions/positron-data-viewer)

## Related Repositories

- [VSCode - OSS](https://github.com/microsoft/vscode), the upstream VS Code OSS repository
- [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server), another fork of VS Code focused on running in the browser
- [Positron Codicons](https://github.com/posit-dev/positron-codicons), a fork of the MS Codicons repository
- [Positron Wiki](https://github.com/posit-dev/positron-wiki), the Quarto-based source for Positron's development wiki
