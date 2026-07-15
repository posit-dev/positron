library(highcharter)

data("mpg", "diamonds", "economics_long", package = "ggplot2")

hchart(mpg, "point", hcaes(x = displ, y = cty, group = year))