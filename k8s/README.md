# Kubernetes deployment

> Prefer Helm? `charts/reminders-app/` in this repo is the equivalent
> packaged install (same securityContexts, Recreate strategy, optional
> Valkey, HTTPRoute) — see its README. These raw manifests remain the
> documented default.

Example manifests for any conformant cluster — set your own StorageClass,
ingress/Gateway and hostname. `kubectl apply -f k8s/` after creating the
`reminders-app-env` secret (see the wiki → Deployment on Kubernetes). SQLite
needs **block** storage (`ReadWriteOnce`), so the Deployment uses `Recreate` —
`kubectl rollout status` may exceed its timeout while the volume detaches;
verify with `kubectl get pods` + `/healthz` instead.

## DAV backend (Radicale + wsgidav)

`26-dav.yaml` is the app's upstream: Radicale (CalDAV — tasks/reminders/events)
and wsgidav (WebDAV — notes) behind one nginx router, one Service (`dav`), one
RWO PVC. One app account (server URL `http://dav.reminders-app.svc.cluster.local`)
serves both protocols, mirroring the Nextcloud URL shape (`/files/<user>/…` for
notes). ClusterIP only — never expose it without adding TLS + a route. The
`dav-credentials` Secret (bcrypt htpasswd + wsgidav.yaml with the same
passwords) is created out-of-band; see the header of `26-dav.yaml`.

## Optional: Valkey read cache

`server/cache.js` backs the CalDAV/VEVENT read cache (server/readcache.js,
tasks_caldav.js, caldav.js) with either an in-process Map (the default — no
extra infra, what CI/dev use) or [Valkey](https://valkey.io) when `VALKEY_URL`
is set (`k8s/25-valkey.yaml` + the env var in `30-app.yaml`). Point of Valkey:
the in-process cache is empty on every pod restart, so the first dashboard
load after a deploy pays a full CalDAV REPORT fan-out for every list (~9s cold
vs ~0.6s warm against a typical home CalDAV server); with Valkey, that
survives the restart — the first post-restart read hydrates the cached
payload and only pays a cheap ctag PROPFIND (or a full re-fetch if the data
actually changed while the pod was down).

- `VALKEY_URL` — e.g. `redis://reminders-valkey.reminders-app.svc.cluster.local:6379`.
  Unset (default) → in-process cache only, identical behavior to before this
  feature existed.
- A Valkey outage never takes the app down: connection/command errors are
  logged once and the adapter falls back to its in-process path for the
  duration (see server/cache.js).
- **Keep Valkey cluster-internal.** Cached values are task/event payloads in
  plaintext (titles, descriptions, due dates — the CalDAV *credentials* that
  produced them stay encrypted in SQLite, but the cached content itself is
  not separately encrypted). `25-valkey.yaml`'s Service is ClusterIP with no
  HTTPRoute, and it's deployed in the app's own namespace — don't add a route
  to it, and don't point a shared/multi-tenant Valkey at this app.
- This app runs single-replica (`Recreate` strategy, RWO SQLite volume), so
  cross-replica cache invalidation (pub/sub, etc.) is explicitly out of
  scope — there's only ever one writer. The ctag-revalidation-on-hydrate
  design (server/readcache.js's `asRehydrated`) bounds staleness to one cheap
  PROPFIND regardless, so this holds even if that assumption ever changes.
- No persistence on the Valkey pod (no PVC, `--save ""`, `--appendonly no`):
  it's a cache, not a store — losing it just means the next read is cold.

## Continuous deployment

CI already builds and pushes `ghcr.io/<owner>/reminders-app:latest` on every
merge to `main` (`.github/workflows/docker.yml`). The `deploy` workflow
(`.github/workflows/deploy.yml`) runs after each successful image push and
rolls the cluster onto it — from an **in-cluster runner**, not a credential
shipped to GitHub:

- A GitHub ARC (Actions Runner Controller) runner scale set named
  `reminders-ci` (min 0 / max 3) runs its pods *inside* this cluster, in
  namespace `arc-runners`, under PodSecurity `restricted` (no docker daemon,
  no job-level `container:` support — see `runner/` in the repo root for the
  custom image that bakes in kubectl/node/Playwright ahead of time).
- Those pods run as ServiceAccount `reminders-ci-runner`, RoleBound
  **namespace-scoped** in `reminders-app` (and in `reminders-dev`, for the
  `live-visual` workflow) to exactly:
  - `deployments`: `get`, `list`, `patch`
  - `deployments/scale`: `get`, `patch`, `update`
  - `pods`: `get`, `list`, `watch`
- `kubectl` inside a job auto-authenticates via that pod's mounted
  ServiceAccount token (in-cluster config) — **no kubeconfig, no
  `KUBE_CONFIG_DATA` secret, and no cluster credential ever touches GitHub**.
  Fork PRs already can't reach this runner set; on top of that, a leaked
  Actions log or a compromised workflow run can at worst restart/scale two
  namespaces' Deployments — nothing else in the cluster.

**Paused-by-default:** this homelab habitually scales `reminders-app` (and
the `reminders-dev` fixture stack) to 0 replicas as its steady state to save
resources. `deploy.yml` reads the Deployment's current replica count before
doing anything — if it's 0, it prints a notice and exits 0 without attempting
a rollout, rather than fighting an intentional pause. Scale it back up to
re-enable CD:

```bash
kubectl scale deployment/reminders-app -n reminders-app --replicas=1
```

`reminders-dev` (used by `live-visual.yml`) intentionally has **no public
route** at all — it runs with `ALLOW_DEV_BYPASS=1`, so any request carrying
an `x-dev-user` header authenticates as that user. It's reachable only
in-cluster, via its ClusterIP Service, which is exactly what the in-cluster
runner uses; it must never get an HTTPRoute/Ingress.

Pull-based alternative: run [Keel](https://keel.sh) (or Flux/Argo) in-cluster
watching the GHCR tag instead of a runner-driven rollout — the trade-off is
another controller to operate.
