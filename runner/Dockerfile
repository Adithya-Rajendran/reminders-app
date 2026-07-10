# Custom image for the `reminders-ci` GitHub ARC runner scale set. These
# runners are pods living inside the cluster (namespace arc-runners) under
# PodSecurity `restricted`: no privileged containers, no docker daemon, and
# no job-level `container:` support (Actions can't just docker-run a tool
# image at job time here). So every tool the deploy/live-visual workflows
# need — kubectl, node, a browser for Playwright — has to already be on
# PATH when the job starts. That's what this image bakes in.
FROM ghcr.io/actions/actions-runner:latest

# The base image drops to an unprivileged `runner` user; installing system
# packages and writing under /usr/local needs root.
USER root

# --- kubectl ----------------------------------------------------------------
# Pinned to a minor release (not dl.k8s.io/release/stable.txt, which floats
# to whatever is newest) so a rebuild can't silently jump client versions
# out from under the cluster — bump KUBECTL_MINOR deliberately when the
# cluster's control plane minor moves. Patch releases within the minor still
# flow through automatically.
ARG KUBECTL_MINOR=1.30
RUN KUBECTL_VERSION=$(curl -fsSL "https://dl.k8s.io/release/stable-${KUBECTL_MINOR}.txt") \
    && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && chmod +x /usr/local/bin/kubectl \
    && kubectl version --client=true

# --- Node 22 ------------------------------------------------------------
# Tarball straight into /usr/local rather than nvm — nvm is a shell-profile
# hack for interactive use; a build layer just needs the binaries on PATH.
ARG NODE_VERSION=22.11.0
RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version && npm --version

# --- Playwright Chromium + system deps --------------------------------------
# Installed here (root, at build time) so `live-visual.yml` never has to run
# `playwright install` on the runner — the restricted PSA profile has no
# apt/root access at job time anyway. The pinned version must match (or be
# newer than, within Playwright's compat window) `@playwright/test` in
# test/e2e/package.json — bump both together.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright \
    && npx --yes playwright@1.61.0 install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*

USER runner
