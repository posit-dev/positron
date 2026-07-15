# works in console

library(DiagrammeR)


example_graph <-
  create_graph() %>%
  add_pa_graph(
    n = 50, m = 1,
    set_seed = 23
  ) %>%
  add_gnp_graph(
    n = 50, p = 1/100,
    set_seed = 23
  ) %>%
  join_node_attrs(df = get_betweenness(.)) %>%
  join_node_attrs(df = get_degree_total(.)) %>%
  colorize_node_attrs(
    node_attr_from = total_degree,
    node_attr_to = fillcolor,
    palette = "Greens",
    alpha = 90
  ) %>%
  rescale_node_attrs(
    node_attr_from = betweenness,
    to_lower_bound = 0.5,
    to_upper_bound = 1.0,
    node_attr_to = height
  ) %>%
  select_nodes_by_id(nodes = get_articulation_points(.)) %>%
  set_node_attrs_ws(node_attr = peripheries, value = 2) %>%
  set_node_attrs_ws(node_attr = penwidth, value = 3) %>%
  clear_selection() %>%
  set_node_attr_to_display(attr = NULL)

render_graph(example_graph, layout = "nicely")