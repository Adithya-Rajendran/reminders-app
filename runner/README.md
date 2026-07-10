# reminders-ci runner image

Custom image for the `reminders-ci` GitHub ARC runner scale set (in-cluster,
namespace `arc-runners`, PodSecurity `restricted` — no docker daemon, no
job-level `container:` support). Extends `ghcr.io/actions/actions-runner`
with the tools our workflows need already on PATH at job start: `kubectl`,
Node 22, and Playwright's Chromium + system deps
(`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`) — see `Dockerfile` for why each
is baked in rather than installed per-job.

Rebuild and push whenever a pinned tool version needs to move:

```bash
docker build -t ghcr.io/adithya-rajendran/reminders-app-runner:latest runner/
docker push ghcr.io/adithya-rajendran/reminders-app-runner:latest
```

The `reminders-ci` scale set config (not in this repo) references this image
by tag; recycle its runner pods (or bump the tag it points at) to pick up a
new build. `.github/workflows/deploy.yml` and `live-visual.yml` only refer to
it indirectly via `runs-on: reminders-ci`.
