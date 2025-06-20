By default, the Positron Console uses the [IPython `%autoreload` magic](https://ipython.readthedocs.io/en/stable/config/extensions/autoreload.html#autoreload), which automatically reloads Python modules when you modify your code files.
This is especially useful for iterative development, as it lets you see changes immediately without restarting the console or re-running your script.

If you want to disable this feature, you can do so by changing the [`positron.autoReload` setting](command:python.walkthrough.autoreload) to `false`. 
This will prevent automatic reloading of modules, and you will need to manually reload by restarting the console.