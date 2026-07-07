# this only works in the console

from ipyleaflet import Map, Marker
center = (52.204793, 360.121558)

m = Map(center=center, zoom=15)

marker = Marker(location=center, draggable=False)
m.add(marker);

m


#############


from ipyleaflet import Map, Marker, display
center = (52.204793, 360.121558)
map = Map(center=center, zoom=12)

# Add a draggable marker to the map
# Dragging the marker updates the marker.location value in Python
marker = Marker(location=center, draggable=True)
map.add_control(marker)

display(map)
