import ipywidgets as widgets
from ipyleaflet import Map, Marker, display
from pythreejs import CircleGeometry
import numpy as np
import matplotlib.pyplot as plt

# base widgets
x = widgets.IntSlider(
    value=7,
    min=1,
    max=10,
    step=1,
    description='Test:',
    disabled=False,
    continuous_update=False,
    orientation='horizontal',
    readout=True,
    readout_format='d'
)
display(x)

# ipyleaflet
center = (52.204793, 360.121558)
map = Map(center=center, zoom=12)
marker = Marker(location=center, draggable=True)
map.add_control(marker)
display(map)


# pythreejs
display(CircleGeometry(
    radius=10,
    segments=10,
    thetaStart=0.25,
    thetaLength=5.0)
)

# plt in widget mode
%matplotlib ipympl
v = np.array([1,2])
w = np.array([4,-6])

fig, ax = plt.subplots()
plt.xlim(-6,6)
plt.ylim(-6,6)

plt.plot(v)
plt.plot(w)

plt.show()
