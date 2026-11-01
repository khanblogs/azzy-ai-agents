# HQ instance, Elastic IP, backups bucket and the two Secrets Manager secrets.

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# ---- Backups bucket ----------------------------------------------------------

resource "aws_s3_bucket" "backups" {
  bucket        = "${var.name}-backups-${data.aws_caller_identity.current.account_id}-${random_id.bucket_suffix.hex}"
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-dumps"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.backup_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

# ---- Secrets (placeholders; real values are set out-of-band and never tracked) ----

resource "aws_secretsmanager_secret" "env" {
  name                    = "azzy/env"
  description             = "AZZY AI AGENTS v2.0: full contents of infra/.env as one string."
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "env" {
  secret_id     = aws_secretsmanager_secret.env.id
  secret_string = "DEMO=1\n# Replace this placeholder with the full contents of infra/.env (see README).\n"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "tailscale" {
  name                    = "azzy/tailscale"
  description             = "AZZY AI AGENTS v2.0: {\"authkey\": \"tskey-auth-...\"} (reusable, pre-authorized, tag:azzy)."
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "tailscale" {
  secret_id     = aws_secretsmanager_secret.tailscale.id
  secret_string = jsonencode({ authkey = "REPLACE_ME" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---- Instance ----------------------------------------------------------------

resource "aws_instance" "hq" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.hq.id]
  iam_instance_profile        = aws_iam_instance_profile.hq.name
  associate_public_ip_address = true
  ebs_optimized               = true

  user_data = templatefile("${path.module}/../scripts/bootstrap.sh", {
    repo_url   = var.repo_url
    branch     = var.repo_branch
    aws_region = var.aws_region
  })
  user_data_replace_on_change = false

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    iops                  = 3000
    throughput            = 125
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2          # containers reach the instance role
  }

  monitoring = true

  tags = merge(var.tags, {
    Name           = "${var.name}-hq"
    "azzy:managed" = "true"
  })

  depends_on = [
    aws_secretsmanager_secret_version.env,
    aws_secretsmanager_secret_version.tailscale,
    aws_iam_role_policy_attachment.hq,
    aws_iam_role_policy_attachment.ssm_core,
  ]
}

resource "aws_eip" "hq" {
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.name}-hq" })
}

resource "aws_eip_association" "hq" {
  instance_id   = aws_instance.hq.id
  allocation_id = aws_eip.hq.id
}
