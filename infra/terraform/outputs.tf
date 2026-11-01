output "public_ip" {
  description = "Elastic IP of the HQ box. Point your DNS A record here, then run enable_tls.sh."
  value       = aws_eip.hq.public_ip
}

output "instance_id" {
  description = "EC2 instance id (set as the EC2_INSTANCE_ID GitHub Actions variable for SSM deploys)."
  value       = aws_instance.hq.id
}

output "backup_bucket" {
  description = "S3 bucket that backup.sh uploads pg_dump archives to (BACKUP_BUCKET in infra/.env)."
  value       = aws_s3_bucket.backups.bucket
}

output "instance_role_arn" {
  description = "Instance role ARN. Client accounts trust the HQ *account*; this is for reference."
  value       = aws_iam_role.hq.arn
}

output "secrets" {
  description = "Secrets Manager names bootstrap.sh reads. Fill them in before (re)booting the instance."
  value = {
    env       = aws_secretsmanager_secret.env.name
    tailscale = aws_secretsmanager_secret.tailscale.name
  }
}

output "account_id" {
  description = "HQ AWS account id — the AzzyAccountId parameter of infra/cloudformation/azzy-agent-role.yaml."
  value       = data.aws_caller_identity.current.account_id
}
