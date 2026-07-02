# Kubernetes deployment

Example manifests for any conformant cluster — set your own StorageClass,
ingress/Gateway and hostname. `kubectl apply -f k8s/` after creating the
`reminders-app-env` secret (see the wiki → Deployment on Kubernetes). SQLite
needs **block** storage (`ReadWriteOnce`), so the Deployment uses `Recreate` —
`kubectl rollout status` may exceed its timeout while the volume detaches;
verify with `kubectl get pods` + `/healthz` instead.

## Continuous deployment (optional)

CI already builds and pushes `ghcr.io/<owner>/reminders-app:latest` on every
merge to `main` (`.github/workflows/docker.yml`). To also **roll the cluster
automatically**, the `deploy` workflow (`.github/workflows/deploy.yml`) runs
after each successful image push — it is a no-op until you add one repo secret:

- **`KUBE_CONFIG_DATA`** — a base64-encoded kubeconfig that can restart the
  Deployment: `base64 -w0 kubeconfig.yaml` → repo → Settings → Secrets →
  Actions.

Two ways to mint that kubeconfig, most-restricted first:

1. **Namespace-scoped ServiceAccount** (recommended): create a ServiceAccount
   in the app namespace bound to a Role allowing only
   `get/list/patch deployments` + `get/list pods`, mint a long-lived token
   (`kubectl create token --duration=…` or a service-account token Secret),
   and build a kubeconfig around it pointing at your cluster's API endpoint.
   A leak can bounce this one app — nothing else.
2. **Rancher API token**: Rancher → Account & API Keys → create a token with a
   long/no TTL scoped to the cluster, download the kubeconfig, replace the
   token. Simpler, but cluster-wide — prefer (1) for a public repo.

Fork PRs never see repo secrets, and the workflow only triggers from `main`
or a manual dispatch. Without the secret, CI stays green and deployment stays
manual (`kubectl rollout restart deployment/reminders-app -n reminders-app`).

Pull-based alternative: run [Keel](https://keel.sh) (or Flux/Argo) in-cluster
watching the GHCR tag instead — no cluster credentials ever leave the cluster;
the trade-off is another controller to operate.
