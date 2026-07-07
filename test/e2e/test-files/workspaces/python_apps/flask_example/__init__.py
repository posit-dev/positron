import os

from flask import Flask, render_template

def create_app(test_config=None):

    # create and configure the app
    app = Flask(__name__, instance_relative_config=True)

    # When running in Posit Workbench, apply ProxyFix middleware
    # See: https://flask.palletsprojects.com/en/2.2.x/deploying/proxy_fix/
    if 'RS_SERVER_URL' in os.environ and os.environ['RS_SERVER_URL']:
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_prefix=1)

    app.config.from_mapping(
        SECRET_KEY='dev',
    )
    # ensure the instance folder exists
    try:
        os.makedirs(app.instance_path)
    except OSError:
        pass

    # landing page
    @app.route('/')
    def index():
        return render_template('blog/index.html')

    # special endpoint that implements internal redirect when trailing slash
    # is not included in url (i.e. navigated to as '<host-url>/projects')
    @app.route('/projects/')
    def projects():
        return 'The project page'

    # import and register auth blueprint
    from . import auth
    app.register_blueprint(auth.bp)

    return app

