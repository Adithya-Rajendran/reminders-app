# Backends image for the screenshot harness: the SAME two Python servers
# test/e2e/setup-backends.sh uses (Radicale for CalDAV VTODO/VEVENT, wsgidav
# for WebDAV notes) baked in at build time instead of a per-run venv install.
# One image, two containers (shots-radicale / shots-wsgidav) selected by the
# `docker run ... radicale|wsgidav ...` CMD args at run time — see
# setup-backends.sh.
FROM python:3-slim
RUN pip install --no-cache-dir 'radicale==3.*' wsgidav cheroot
# No HOME for the (possibly arbitrary, --user UID:GID) runtime user — point
# anything that wants to write a cache/dotfile somewhere writable.
ENV HOME=/tmp
WORKDIR /state
