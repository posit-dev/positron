import anywidget
import traitlets


class CounterWidget(anywidget.AnyWidget):
    _esm = """    
    function render({ model, el }) {
      let count = () => model.get("value");
      let btn = document.createElement("button");
      btn.classList.add("counter-button");
      btn.innerHTML = `count is ${count()}`;
      btn.addEventListener("click", () => {

        model.set("value", count() + 1);
        model.save_changes();

let bytes = new TextEncoder().encode("Hello, world");
model.send({message: "Hello"}, undefined, [new DataView(bytes.buffer)]);

      });
      model.on("change:value", () => {
        btn.innerHTML = `count is ${count()}`;
      });
      el.appendChild(btn);
    }
    export default { render };
    """
    _css = """
    .counter-button {
      background-image: linear-gradient(to right, #a1c4fd, #c2e9fb);
      border: 0;
      border-radius: 10px;
      padding: 10px 50px;
      color: white;
    }
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_msg(self._handle_custom_msg)

    def _handle_custom_msg(self, msg: dict, buffers: list):
        with open("msgs", "a") as file:
          file.write(f"Number of buffers: {len(buffers)}\n")

    value = traitlets.Int(0).tag(sync=True)

w = CounterWidget()
w
