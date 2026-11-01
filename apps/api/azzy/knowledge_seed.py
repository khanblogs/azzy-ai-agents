"""Six seeded runbooks for the knowledge base (CONTRACT-v2 §8). Pure data."""

from __future__ import annotations

SEED_RUNBOOKS: list[dict[str, object]] = [
    {
        "title": "Runbook: ECS rollback",
        "tags": ["ecs", "deploy"],
        "content": (
            "# ECS rollback\n\n"
            "When a deployment causes elevated 5xx or failing health checks, roll back before investigating further.\n\n"
            "1. Describe the service (aws.describe service=ecs) and note the PRIMARY deployment's task definition.\n"
            "2. List task definition revisions for the family; the previous revision is the rollback target.\n"
            "3. Update the service to the previous task definition with forceNewDeployment (aws.rollback).\n"
            "4. Wait for services_stable; confirm runningCount == desiredCount and the target group reports all healthy.\n"
            "5. Confirm the 5xx rate returned to baseline in CloudWatch (cloudwatch.logs filter ERROR, last 15 min).\n\n"
            "Production rollbacks are high risk and require owner approval. Record the deployment row as rolled_back and attach the evidence."
        ),
    },
    {
        "title": "Runbook: incident communication",
        "tags": ["incident", "comms"],
        "content": (
            "# Incident communication\n\n"
            "Sara owns client-facing communication during an incident.\n\n"
            "- Within 15 minutes: draft the first client update (what we see, impact, what we are doing). Draft only; sending needs approval.\n"
            "- Every 30 minutes while open: short status update in the incident timeline.\n"
            "- On resolution: one-minute executive summary (what happened, root cause, fix, prevention) as a PDF.\n\n"
            "Template: 'We detected elevated errors on <service> at <time>. Impact: <scope>. We have <action> and the service is <state>. Next update by <time>.'\n"
            "Never speculate on root cause in client comms until Emir or Cyber has confirmed it."
        ),
    },
    {
        "title": "Runbook: IAM review",
        "tags": ["iam", "security"],
        "content": (
            "# IAM review\n\n"
            "Cyber runs an IAM review on every verified AWS account with scope audit or deploy.\n\n"
            "Checks: root account has no access keys and MFA enabled; no user access keys older than 90 days; no policies with Action '*' on Resource '*' "
            "attached to roles agents can assume; AzzyReadOnlyRole / AzzyAuditRole / AzzyDeploymentRole trust the orchestrator account only and require the ExternalId; "
            "password policy >= 14 chars with MFA enforced; CloudTrail enabled in all regions.\n\n"
            "Findings are reported with severity, evidence (ARN + observed value) and a concrete fix. High findings block the release gate."
        ),
    },
    {
        "title": "Runbook: release gate",
        "tags": ["release", "security", "qa"],
        "content": (
            "# Release gate\n\n"
            "A release is cleared when: SAST (semgrep p/owasp-top-ten) has no critical or high findings; gitleaks finds no secrets in the diff; "
            "trivy reports no critical CVEs with a fix available; the smoke E2E suite passes against staging; and the staging deployment has been healthy for 10 minutes.\n\n"
            "Medium findings need a tracked ticket before go-live. Any critical finding blocks the release and Cyber states exactly what must be fixed.\n"
            "Production deployments additionally require an explicit owner approval recorded against the deployment."
        ),
    },
    {
        "title": "Runbook: Tailscale onboarding",
        "tags": ["tailscale", "ssh", "onboarding"],
        "content": (
            "# Tailscale onboarding for a client VPS\n\n"
            "1. Install Tailscale on the host and join it with an auth key tagged tag:servers.\n"
            "2. Create the azzy-deploy user with the limited sudoers file from infra/scripts (only /usr/local/bin/azzy-action).\n"
            "3. Install azzy-action; it accepts only: status, restart, logs, deploy <version>, rollback <version>, disk, top.\n"
            "4. Add the environment in AZZY with method tailscale_ssh and the host's 100.x address or MagicDNS name.\n"
            "5. Run a status check from the Environments page; health should turn green within one probe interval (60 s).\n\n"
            "No public SSH port is required; the ACL allows tag:azzy -> tag:servers:22 only."
        ),
    },
    {
        "title": "Runbook: cost review",
        "tags": ["cost", "finops"],
        "content": (
            "# Weekly cost review\n\n"
            "Jimmy pulls Cost Explorer grouped by service for the last 7 days per verified account (aws.cost).\n\n"
            "Flag: any service up more than 20% week over week; NAT gateway data transfer spikes; idle EC2 (CPU < 5% for 7 days); unattached EBS volumes; "
            "RDS instances without reserved pricing after 90 days.\n\n"
            "Report the total, the delta versus the previous week, the top three risers with a one-line cause, and one concrete saving. Post to #ops and attach to the Friday operations review."
        ),
    },
]
