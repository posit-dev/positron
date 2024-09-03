def _positron_no_access(filename: str):
    return True


def bokeh_no_access():
    try:
        import bokeh

        # bokeh.plotting import needed to use bokeh.io
        from bokeh.plotting import show

        bokeh.io.util._no_access = _positron_no_access
    except ImportError:
        pass
