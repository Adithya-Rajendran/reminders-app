# Kubernetes deployment

Example manifests for any conformant cluster — set your own StorageClass,
ingress/Gateway and hostname. `kubectl apply -f k8s/` after creating the
`reminders-app-env` secret (see the wiki → Deployment on Kubernetes). SQLite
needs **block** storage (`ReadWriteOnce`), so the Deployment uses `Recreate` —
`kubectl rollout status` may exceed its timeout while the volume detaches;
verify with `kubectl get pods` + `/healthz` instead.

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
