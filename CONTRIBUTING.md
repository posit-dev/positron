<!-- Begin Positron -->

## Extensions

Positron is a highly extensible IDE. Its foundation is implemented in [`src`](src), but much of the core functionality is provided through [`extensions`](extensions).

Positron provides the following built-in extensions:

- [**R**](extensions/positron-r), the Positron extension for the R programming language powered by [ARK](https://github.com/posit-dev/ark/tree/main/crates/ark) (an R kernel -- our Rust-based kernel for R) which is built on top of our [Amalthea](https://github.com/posit-dev/ark/tree/main/crates/amalthea) Jupyter kernel framework and the open source [tower-lsp](https://github.com/ebkalderon/tower-lsp) LSP framework
- [**Python**](extensions/positron-python), the Positron extension for the Python programming language, a fork of [Microsoft's Python VSCode extension](https://github.com/microsoft/vscode-python) built on top of the open source Python-based kernel [IPyKernel](https://github.com/ipython/ipykernel) and [Jedi Language Server](https://github.com/pappasam/jedi-language-server)
- [**Zed**](extensions/positron-zed), the Positron extension for a test-bed language, intended for fast simulations primarily to aid UI development

<!-- End Positron -->
