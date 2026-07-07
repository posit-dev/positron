import functools

from flask import (
    Blueprint, flash, redirect, render_template, request, url_for
)

bp = Blueprint('auth', __name__, url_prefix='/auth')

@bp.route('/register', methods=('GET', 'POST'))
def register():
    if request.method == 'POST':
        # pretend to register user; redirect to login
        return redirect(url_for("auth.login"))

    return render_template('auth/register.html')

@bp.route('/login', methods=('GET', 'POST'))
def login():
    if request.method == 'POST':
        # pretend to login user; redirect to home
        username = request.form['username']
        flash("Hello " + username)
        return redirect(url_for('index'))

    return render_template('auth/login.html')
