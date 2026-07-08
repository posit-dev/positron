library(leaflet)
m = leaflet() %>% addTiles()
m = m %>% setView(-93.65, 42.0285, zoom = 17)
m %>% addPopups(-93.65, 42.0285, 'Here is the <b>Department of Statistics</b>, ISU')