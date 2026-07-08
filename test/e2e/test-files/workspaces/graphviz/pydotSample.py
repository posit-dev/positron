import pydot
import os
from IPython.display import Image, display

def view_pydot(pdot):
    plt = Image(pdot.create_png())
    display(plt)

data_file_path = os.path.join(os.getcwd(), 'workspaces', 'graphviz', 'example.dot')
graphs = pydot.graph_from_dot_file(data_file_path)
graph = graphs[0]

view_pydot(graph)