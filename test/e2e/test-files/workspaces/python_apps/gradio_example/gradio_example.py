import gradio as gr
def image_classifier(inp):
    return {'cat': 0.3, 'dog': 0.7}
demo = gr.Interface(fn=image_classifier, inputs="image", outputs="label")
demo.launch()