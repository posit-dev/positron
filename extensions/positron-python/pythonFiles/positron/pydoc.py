#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import inspect
import io
import logging
import pydoc
import os
import sys
import warnings
from typing import Any

from docstring_to_markdown.rst import rst_to_markdown
from markdown_it import MarkdownIt
from traceback import format_exception_only


logger = logging.getLogger(__name__)


def _remove_tt(text):
    return text.replace("<tt>", "").replace("</tt>", "")


class _PositronHTMLDoc(pydoc.HTMLDoc):
    def docmodule(self, *args, **kwargs):
        return _remove_tt(super().docmodule(*args, **kwargs))

    def docclass(self, *args, **kwargs):
        return _remove_tt(super().docclass(*args, **kwargs))

    def docroutine(self, *args, **kwargs):
        return _remove_tt(super().docroutine(*args, **kwargs))

    def docother(self, *args, **kwargs):
        return _remove_tt(super().docother(*args, **kwargs))

    def docproperty(self, *args, **kwargs):
        return _remove_tt(super().docproperty(*args, **kwargs))

    def docdata(self, *args, **kwargs):
        return _remove_tt(super().docdata(*args, **kwargs))

    def markup(self, text, escape=None, funcs={}, classes={}, methods={}):
        # Don't do any marking up, let the rst parser handle it.
        return text

    # moved from pydoc._url_handler to method
    def page(self, title, contents):
        """Format an HTML page."""
        # --- Start Positron ---
        # moved from _HTMLDoc class in pydoc._url_handler
        # update path for positron file system
        css_path = "_pydoc.css"

        css_link = '<link rel="stylesheet" type="text/css" href="%s">' % css_path

        # removed html_navbar() for aesthetics
        return """\
<!DOCTYPE>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pydoc: %s</title>
%s</head><body>%s</div>
</body></html>""" % (
            title,
            css_link,
            contents,
        )
        # --- End Positron ---

    # moved from pydoc._url_handler to method
    def html_index(self):
        """Module Index page."""

        def bltinlink(name):
            return '<a href="%s.html">%s</a>' % (name, name)

        heading = self.heading(
            "<big><big><strong>Index of Modules</strong></big></big>",
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-foreground)",
            "var(--vscode-background)",  # type: ignore
        )  # type: ignore
        # --- End Positron ---

        names = [name for name in sys.builtin_module_names if name != "__main__"]
        contents = self.multicolumn(names, bltinlink)
        contents = [
            heading,
            "<p>"
            + self.bigsection(
                # --- Start Positron ---
                # update colors to vscode css variables
                "Built-in Modules",
                "var(--vscode-foreground)",
                "var(--vscode-background)",
                # --- End Positron ---
                contents,
            ),
        ]

        seen = {}
        for dir in sys.path:
            contents.append(self.index(dir, seen))

        contents.append(
            '<p align=right><font color="#909090" face="helvetica,'
            'arial"><strong>pydoc</strong> by Ka-Ping Yee'
            "&lt;ping@lfw.org&gt;</font>"
        )
        return "Index of Modules", "".join(contents)

    # moved from pydoc._url_handler to method
    def html_search(self, key):
        """Search results page."""
        # scan for modules
        search_result = []

        def callback(path, modname, desc):
            if modname[-9:] == ".__init__":
                modname = modname[:-9] + " (package)"
            search_result.append((modname, desc and "- " + desc))

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore")  # ignore problems during import

            def onerror(modname):
                pass

            pydoc.ModuleScanner().run(callback, key, onerror=onerror)

        # format page
        def bltinlink(name):
            return '<a href="%s.html">%s</a>' % (name, name)

        results = []
        heading = self.heading(
            "<big><big><strong>Search Results</strong></big></big>",
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-foreground)",
            "var(--vscode-background)",  # type: ignore
        )  # type: ignore
        # --- End Positron ---
        for name, desc in search_result:
            results.append(bltinlink(name) + desc)
        contents = heading + self.bigsection(
            "key = %s" % key,
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-foreground)",
            "var(--vscode-background)",
            # --- End Positron ---
            "<br>".join(results),
        )
        return "Search Results", contents

    # moved from pydoc._url_handler to method
    def html_getobj(self, url):
        obj = pydoc.locate(url, forceload=1)  # type: ignore
        if obj is None and url != "None":
            raise ValueError("could not find object")
        title = pydoc.describe(obj)
        content = super().document(obj, url)
        return title, content

    # moved from pydoc._url_handler to method
    def html_topics(self):
        """Index of topic texts available."""

        def bltinlink(name):
            return '<a href="topic?key=%s">%s</a>' % (name, name)

        heading = self.heading(
            '<strong class="title">INDEX</strong>',
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-foreground)",
            "var(--vscode-background)",  # type: ignore
        )  # type: ignore
        # --- End Positron ---

        names = sorted(pydoc.Helper.topics.keys())

        contents = self.multicolumn(names, bltinlink)
        contents = heading + self.bigsection("Topics", "index", contents)
        return "Topics", contents

    # moved from pydoc._url_handler to method
    def html_keywords(self):
        """Index of keywords."""
        heading = self.heading(
            '<strong class="title">INDEX</strong>',
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-foreground)",
            "var(--vscode-background)",  # type: ignore
        )  # type: ignore
        # --- End Positron ---

        names = sorted(pydoc.Helper.keywords.keys())

        def bltinlink(name):
            return '<a href="topic?key=%s">%s</a>' % (name, name)

        contents = self.multicolumn(names, bltinlink)
        contents = heading + self.bigsection("Keywords", "index", contents)
        return "Keywords", contents

    # moved from pydoc._url_handler to method
    def html_topicpage(self, topic):
        """Topic or keyword help page."""
        buf = io.StringIO()
        htmlhelp = pydoc.Helper(buf, buf)

        # TODO: pyright has error: Cannot access member "_gettopic" for type "Helper"
        # but "_gettopic" exists and is usable here
        contents, xrefs = htmlhelp._gettopic(topic)  # type: ignore
        if topic in htmlhelp.keywords:
            title = "KEYWORD"
        else:
            title = "TOPIC"

        # --- Start Positron ---
        # python > 3.9 does not have fgcol or bgcol parameters
        # if it has these parameters, use them. else, use new heading params
        if inspect.signature(pydoc.HTMLDoc.heading).parameters.get("fgcol"):
            heading = self.heading(
                '<strong class="title">%s</strong>' % title,
                # update colors to vscode css variables
                fgcol="var(--vscode-foreground)",  # type: ignore
                bgcol="var(--vscode-background)",  # type: ignore
            )  # type: ignore
        else:
            heading = self.heading(
                '<strong class="title">%s</strong>' % title,  # type: ignore
            )
        # --- End Positron ---
        contents = "<pre>%s</pre>" % self.markup(contents)

        # --- Start Positron ---
        # update colors to css variables
        contents = self.bigsection(
            topic, "var(--vscode-foreground)", "var(--vscode-background)", contents
        )
        # --- End Positron ---

        if xrefs:
            xrefs = sorted(xrefs.split())

            def bltinlink(name):
                return '<a href="topic?key=%s">%s</a>' % (name, name)

            xrefs = self.multicolumn(xrefs, bltinlink)
            # --- Start Positron ---
            # python > 3.9 does not have fgcol or bgcol parameters
            # if it has these parameters, use them. else, use new heading params
            if inspect.signature(pydoc.HTMLDoc.section).parameters.get("fgcol"):
                xrefs = self.section(
                    "Related help topics: ",
                    # update colors to vscode css variables
                    fgcol="var(--vscode-foreground)",  # type: ignore
                    bgcol="var(--vscode-background)",  # type: ignore
                    contents=xrefs,
                )  # type: ignore
            else:
                xrefs = self.section("Related help topics: ", "index", xrefs)  # type: ignore
            # --- End Positron ---
        return ("%s %s" % (title, topic), "".join((heading, contents, xrefs)))

    # moved from pydoc._url_handler to method
    def html_error(self, url, exc):
        heading = self.heading(
            "<big><big><strong>Error</strong></big></big>",
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-editor-foreground)",
            "var(--vscode-background)",  # type: ignore
        )  # type: ignore
        # --- End Positron ---
        contents = "<br>".join(self.escape(line) for line in format_exception_only(type(exc), exc))
        contents = heading + self.bigsection(
            url,
            # --- Start Positron ---
            # update colors to vscode css variables
            "var(--vscode-editor-foreground)",
            "var(--vscode-background)",
            contents,
        )
        # --- End Positron ---
        return "Error - %s" % url, contents

    # moved from pydoc._url_handler to method
    def get_html_page(self, url):
        """Generate an HTML page for url."""
        complete_url = url
        if url.endswith(".html"):
            url = url[:-5]

        # --- Start Positron ---
        # for typechecking
        title, content = None, None
        # --- End Positron ---

        try:
            if url in ("", "index"):
                title, content = self.html_index()
            elif url == "topics":
                title, content = self.html_topics()
            elif url == "keywords":
                title, content = self.html_keywords()
            elif "=" in url:
                op, _, url = url.partition("=")
                if op == "search?key":
                    title, content = self.html_search(url)
                elif op == "topic?key":
                    # try topics first, then objects.
                    try:
                        title, content = self.html_topicpage(url)
                    except ValueError:
                        title, content = self.html_getobj(url)
                elif op == "get?key":
                    # try objects first, then topics.
                    if url in ("", "index"):
                        title, content = self.html_index()
                    else:
                        try:
                            title, content = self.html_getobj(url)
                        except ValueError:
                            title, content = self.html_topicpage(url)
                else:
                    raise ValueError("bad pydoc url")
            else:
                title, content = self.html_getobj(url)
        except Exception as exc:
            # Catch any errors and display them in an error page.
            title, content = self.html_error(complete_url, exc)

        # --- Start Positron ---
        # for typechecking
        assert title is not None
        assert content is not None
        # --- End Positron ---

        return self.page(title, content)


def _getdoc(object: Any) -> str:
    """Override `pydoc.getdoc` to parse reStructuredText docstrings."""
    docstring = _pydoc_getdoc(object)

    markdown = rst_to_markdown(docstring)

    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    html = md.render(markdown)

    return html


# adapted from pydoc._url_handler
def _url_handler(url, content_type="text/html"):
    """The pydoc url handler for use with the pydoc server.

    If the content_type is 'text/css', the _pydoc.css style
    sheet is read and returned if it exits.

    If the content_type is 'text/html', then the result of
    get_html_page(url) is returned.
    """
    # --- Start Positron ---
    # moved subclass _HTMLDoc and functions to _PositronHTMLDoc

    html = _PositronHTMLDoc()

    # --- End Positron ---

    if url.startswith("/"):
        url = url[1:]
    if content_type == "text/css":
        path_here = os.path.dirname(os.path.realpath(__file__))
        css_path = os.path.join(path_here, url)
        with open(css_path) as fp:
            return "".join(fp.readlines())
    elif content_type == "text/html":
        return html.get_html_page(url)
    # Errors outside the url handler are caught by the server.
    raise TypeError("unknown content type %r for url %s" % (content_type, url))


# Keep a reference to the original/unpatched `pydoc.getdoc`.
_pydoc_getdoc = pydoc.getdoc


def start_server(port: int = 0):
    """Adapted from pydoc.browser."""
    # Monkey patch pydoc for our custom functionality
    pydoc.HTMLDoc = _PositronHTMLDoc
    pydoc.getdoc = _getdoc

    # Setting port to 0 will use an arbitrary port
    thread = pydoc._start_server(_url_handler, hostname="localhost", port=port)  # type: ignore

    if thread.error:
        logger.error(f"Could not start the pydoc help server. Error: {thread.error}")
        return
    elif thread.serving:
        logger.info(f"Pydoc server ready at: {thread.url}")

    return thread


if __name__ == "__main__":
    # Run Positron's pydoc server on a custom port, useful for development.
    #
    # Example:
    #
    #   python -m positron.pydoc

    logging.basicConfig(level=logging.INFO)
    start_server(port=65216)
