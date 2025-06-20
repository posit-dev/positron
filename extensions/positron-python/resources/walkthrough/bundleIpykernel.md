The Positron Console is powered by the [IPython kernel](https://ipython.org/), which provides an interactive Python environment with advanced features like syntax highlighting, tab completion, and rich output rendering.
You can run Python code interactively, execute scripts, and explore variables in your current session.

Positron comes with the `ipykernel` package bundled, so you don't need to install anything to get started using the Console.
However, there are instances where you might want to use a different version of the `ipykernel` package, such as when you have specific dependencies or configurations in your project.
To use a different `ipykernel` version, you can follow these steps:

1. **Tell Positron to not use the bundled `ipykernel`***: [Open your settings and set the `positron.useBundledIpykernel` setting](command:python.walkthrough.bundledIpykernel) to `false`. This tells Positron not to use the bundled version of `ipykernel` and allows you to use a different version.
2. **Install the desired `ipykernel` version**: Use your preferred package manager to install the specific version of `ipykernel` you want to use in your project.
3. **Select the interpreter with `ipykernel` installed**: After installing the desired version, [select the Python interpreter](command:workbench.action.language.runtime.selectSession) that has the `ipykernel` package installed. This ensures that Positron uses the correct kernel for your Console. If you select an interpreter that does not have `ipykernel` installed, Positron will prompt you to install it into that environment.

If you want to revert to using the bundled `ipykernel`, simply set the `positron.useBundledIpykernel` setting back to `true`. This will restore the default behavior of using the bundled version of `ipykernel` that comes with Positron.
