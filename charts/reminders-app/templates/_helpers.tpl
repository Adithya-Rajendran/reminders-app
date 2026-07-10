{{/*
Expand the name of the chart.
*/}}
{{- define "reminders-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name (63-char safe). If the release name already contains
the chart name, don't repeat it.
*/}}
{{- define "reminders-app.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Name of the Valkey Deployment/Service.
*/}}
{{- define "reminders-app.valkey.fullname" -}}
{{- printf "%s-valkey" (include "reminders-app.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
chart label value.
*/}}
{{- define "reminders-app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels for every object.
*/}}
{{- define "reminders-app.labels" -}}
helm.sh/chart: {{ include "reminders-app.chart" . }}
app.kubernetes.io/name: {{ include "reminders-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- with .Chart.AppVersion }}
app.kubernetes.io/version: {{ . | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: reminders-app
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels — app pods. Selectors are immutable, so keep this minimal.
*/}}
{{- define "reminders-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "reminders-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: app
{{- end -}}

{{/*
Selector labels — valkey pods.
*/}}
{{- define "reminders-app.valkey.selectorLabels" -}}
app.kubernetes.io/name: {{ include "reminders-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: valkey
{{- end -}}

{{/*
App image reference: digest wins over tag when set (CD pins by digest);
empty tag falls back to the chart appVersion.
*/}}
{{- define "reminders-app.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}
{{- end -}}

{{/*
In-cluster URL the app uses to reach the chart-managed Valkey.
*/}}
{{- define "reminders-app.valkey.url" -}}
{{- printf "redis://%s.%s.svc.cluster.local:6379" (include "reminders-app.valkey.fullname" .) .Release.Namespace -}}
{{- end -}}

{{/*
Name of the PVC the app mounts (existing claim wins).
*/}}
{{- define "reminders-app.pvcName" -}}
{{- default (printf "%s-data" (include "reminders-app.fullname" .)) .Values.persistence.existingClaim -}}
{{- end -}}
