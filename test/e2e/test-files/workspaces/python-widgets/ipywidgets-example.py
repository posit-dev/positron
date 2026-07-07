import ipywidgets as widgets
a = widgets.FloatSlider()
display(a)


############


# this works in the console:
import ipywidgets
with open('/Users/christophermead/Desktop/cmeadPhoto.jpg', 'rb') as f: image = f.read()  # you'll need an actual image file
display(ipywidgets.Image(value=image, format='png'))



#############

import ipywidgets as widgets

widgets.IntSlider(
    value=7,
    min=0,
    max=10,
    step=1,
    description='Test:',
    disabled=False,
    continuous_update=False,
    orientation='horizontal',
    readout=True,
    readout_format='d'
)

widgets.RadioButtons(
    options=['pepperoni', 'pineapple', 'anchovies'],
    layout={'width': 'max-content'}, # If the items' names are long
    description='Pizza topping:',
    disabled=False
)

widgets.Password(
    value='password',
    placeholder='Enter password',
    description='Password:',
    disabled=False
)

widgets.HTML(
    value="Hello <b>World</b>",
    placeholder='Some HTML',
    description='Some HTML',
)