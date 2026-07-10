# reminders-app Helm chart

Packaged equivalent of the raw manifests in [`k8s/`](../../k8s/), which remain
the documented default install. Everything security-relevant from those
manifests (PSA `restricted` securityContexts, `Recreate` on the RWO SQLite
volume, ClusterIP-only Valkey with no persistence, Gateway API HTTPRoute) is
preserved as chart defaults — the rendered output passes a PodSecurity
`restricted` namespace as-is.

## Install / upgrade

The chart does **not** create the env secret. Create it first (the
`reminders-app-env` contract — `SESSION_SECRET` etc., see the wiki →
Deployment on Kubernetes):

```bash
kubectl create namespace reminders-app
kubectl create secret generic reminders-app-env -n reminders-app \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)"
```

Then:

```bash
helm install reminders-app charts/reminders-app -n reminders-app

# with a public route (Gateway API — this chart deliberately has no Ingress):
helm install reminders-app charts/reminders-app -n reminders-app \
  --set route.enabled=true \
  --set route.hostname=tasks.example.com \
  --set route.parentRef.name=shared-gateway \
  --set route.parentRef.namespace=gateway

# upgrade in place:
helm upgrade reminders-app charts/reminders-app -n reminders-app --reuse-values
```

Rollout note: the SQLite volume is `ReadWriteOnce`, so the Deployment uses
`Recreate` — `helm upgrade --wait` / `kubectl rollout status` may exceed
their timeout while the volume detaches. Verify with `kubectl get pods` and
`GET /healthz` instead.

## Paused-by-default

`replicas: 0` is a **supported steady state**, not a broken install: this
project habitually scales the app to 0 to save resources, and its CD
pipeline reads the replica count first and skips the rollout when it's 0
(see `k8s/README.md`). Resume with:

```bash
kubectl scale deployment/reminders-app -n reminders-app --replicas=1
```

Never set replicas above 1 — RWO SQLite volume, exactly one writer.

## Values

| Key | Default | Description |
| --- | --- | --- |
| `image.repository` | `ghcr.io/adithya-rajendran/reminders-app` | App image repository. |
| `image.tag` | `latest` | Tag used when no digest is set; empty falls back to the chart `appVersion`. |
| `image.digest` | `""` | When set (`sha256:<64 hex>`), **wins over the tag** and renders `repo@digest` — how CD pins images. |
| `image.pullPolicy` | `Always` | Matches the raw manifests' `:latest` flow. |
| `replicas` | `1` | `0` = paused (supported steady state). Never > 1 (RWO SQLite). |
| `existingSecret` | `reminders-app-env` | Pre-existing Secret consumed via `envFrom` (not created by the chart). |
| `env` | `{}` | Extra plain env vars (name → value) appended after the chart-set ones. |
| `service.port` | `80` | ClusterIP Service port (container listens on 8080). |
| `resources` | 50m/96Mi req, 256Mi limit | App container resources. |
| `podSecurityContext` | uid/gid/fsGroup 1000, `runAsNonRoot`, `RuntimeDefault` seccomp | PSA `restricted` defaults from `k8s/30-app.yaml`. |
| `containerSecurityContext` | no privilege escalation, drop ALL | App container securityContext. |
| `readinessProbe` / `livenessProbe` | delays 5/30s, periods 10/20s | Timing knobs for the `/healthz` probes. |
| `persistence.size` | `1Gi` | SQLite volume size. |
| `persistence.storageClass` | `""` | Empty = cluster default. Must be RWO **block** storage (never NFS/CephFS). |
| `persistence.existingClaim` | `""` | Use an existing PVC (e.g. the raw install's `reminders-data`) instead of creating one. |
| `route.enabled` | `false` | Render a Gateway API HTTPRoute. |
| `route.hostname` | `""` | Public hostname (required when the route is enabled). |
| `route.parentRef.name` | `shared-gateway` | Gateway name. |
| `route.parentRef.namespace` | `gateway` | Gateway namespace. |
| `route.parentRef.sectionName` | `""` | Optional Gateway listener; empty = omitted. |
| `valkey.enabled` | `true` | Deploy the read-cache Valkey and auto-inject `VALKEY_URL` into the app. Disabling it = in-process cache only (cold after each restart), no other change. |
| `valkey.image.repository` / `tag` / `pullPolicy` | `valkey/valkey` / `8` / `IfNotPresent` | Valkey image. |
| `valkey.maxmemory` | `128mb` | Cache ceiling (`allkeys-lru`); keep the memory limit above it. |
| `valkey.resources` | 20m/32Mi req, 160Mi limit | Headroom over `maxmemory` for client buffers/overhead. |
| `valkey.podSecurityContext` / `containerSecurityContext` | uid/gid 999, seccomp; drop ALL, read-only rootfs | PSA `restricted` defaults from `k8s/25-valkey.yaml`. |
| `commonLabels` | `{}` | Extra labels merged into every object. |
| `nameOverride` / `fullnameOverride` | `""` | Standard Helm naming overrides. |

## Valkey plaintext-cache caveat

From `k8s/25-valkey.yaml`'s header — it applies unchanged here:

> SECURITY: cached values are parsed task/event payloads in PLAINTEXT (no
> separate encryption — the CalDAV credentials that produced them are
> encrypted at rest in SQLite, but the task titles/descriptions/etc. cached
> here are not). This Service has NO route (ClusterIP only, no HTTPRoute) and
> should live in the app's own namespace so nothing outside the cluster, and
> nothing outside this namespace by default NetworkPolicy (if you run one),
> can reach it. Do not reuse a shared/multi-tenant Valkey for this.

The Valkey pod also has **no persistence** (no PVC, `--save ""`,
`--appendonly no`): it's a cache, not a store — losing it just means the
next read is cold.
