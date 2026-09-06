# syntax=docker/dockerfile:1
#
# Builds the React client and the Flask server into one image that serves
# both from a single process/port - see README.md#production-build. Railway
# (and most Docker-based hosts) auto-detect a root-level Dockerfile with no
# extra config needed.

# ---- Stage 1: build the React client (client/dist) ----
FROM node:22-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: the Flask server, serving the built client ----
FROM python:3.12-slim
WORKDIR /app/server
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ ./
# app.py expects the built client at ../client/dist relative to server/ - see
# CLIENT_DIST in app.py.
COPY --from=client-build /build/client/dist /app/client/dist

# Most hosts (Railway included) inject PORT at runtime; 4000 is only the
# fallback used for a plain local `docker run` with nothing else set.
ENV PORT=4000
EXPOSE 4000

# Shell form (not exec-array form) so $PORT is actually expanded at container
# start, since a variable's true value isn't known until Railway injects it.
CMD gunicorn --worker-class gthread --threads 8 -w 1 -b 0.0.0.0:$PORT app:app
