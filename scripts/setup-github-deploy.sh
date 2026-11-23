#!/usr/bin/env bash
# One-time Google Cloud setup so GitHub Actions can deploy without a key
# (Workload Identity Federation). Run it in Google Cloud Shell, signed in as
# the project owner:
#
#   1. Open https://shell.cloud.google.com
#   2. Upload this file (the three-dot menu > Upload), then run: bash setup-github-deploy.sh
#
# Run it as a file with bash. Don't type or copy its lines straight into the terminal: the
# strict error settings below would close your Cloud Shell session on the first error.
#
# Safe to re-run: anything that already exists is left alone.
# At the end it prints the two values to add as GitHub repository variables.
set -euo pipefail

PROJECT_ID=whiteicecreambets
REPO=lintemurion/white-ice-cream-bets
SA_NAME=github-deploy
POOL=github
PROVIDER=github-repo

SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "Project $PROJECT_ID ($PROJECT_NUMBER), repo $REPO"

echo "Enabling APIs..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firebaserules.googleapis.com \
  firestore.googleapis.com \
  serviceusage.googleapis.com

echo "Service account $SA_EMAIL..."
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deploy"
fi

echo "Granting deploy roles..."
for role in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$role" --condition=None >/dev/null
  echo "  $role"
done

echo "Workload identity pool $POOL..."
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
fi

echo "GitHub provider $PROVIDER (trusts only $REPO)..."
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global \
    --workload-identity-pool="$POOL" \
    --display-name="GitHub repo" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '$REPO'"
fi

echo "Letting $REPO act as the service account..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  >/dev/null

echo
echo "Done. Add these two as GitHub repository variables:"
echo "WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "WIF_SERVICE_ACCOUNT=$SA_EMAIL"
