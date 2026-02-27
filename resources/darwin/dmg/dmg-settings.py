# dmgbuild settings for Positron macOS installer
# Variables passed via dmgbuild -D flag: app_path, app_name, background, icon

format = 'UDZO'
size = None
icon = defines.get('icon')
background = defines.get('background')

files = [defines['app_path']]
symlinks = {'Applications': '/Applications'}

show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
sidebar_width = 180

window_rect = ((200, 120), (660, 400))

default_view = 'icon-view'
icon_locations = {
    defines['app_name']: (190, 170),
    'Applications': (470, 167),
}
text_size = 12
icon_size = 80
