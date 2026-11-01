# Instance role for the HQ box. Everything the agents need from AWS flows through
# this role: Bedrock, the two Secrets Manager secrets, the backups bucket,
# AssumeRole into client accounts, SSM (for CI deploys) and CloudWatch Logs.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "hq" {
  name               = "${var.name}-hq-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "hq" {
  statement {
    sid = "BedrockInvoke"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:Converse",
      "bedrock:ConverseStream",
    ]
    resources = var.bedrock_model_arns
  }

  statement {
    sid       = "BedrockDiscover"
    actions   = ["bedrock:ListFoundationModels", "bedrock:GetFoundationModel", "bedrock:ListInferenceProfiles"]
    resources = ["*"]
  }

  statement {
    sid     = "SecretsRead"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [
      "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:azzy/*",
    ]
  }

  statement {
    sid       = "BackupBucketList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.backups.arn]
  }

  statement {
    sid       = "BackupBucketObjects"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }

  statement {
    sid       = "AssumeClientRoles"
    actions   = ["sts:AssumeRole", "sts:TagSession"]
    resources = [
      "arn:aws:iam::*:role/AzzyReadOnlyRole",
      "arn:aws:iam::*:role/AzzyAuditRole",
      "arn:aws:iam::*:role/AzzyDeploymentRole",
    ]
  }

  statement {
    sid       = "OwnCostExplorer"
    actions   = ["ce:GetCostAndUsage", "ce:GetCostForecast"]
    resources = ["*"]
  }

  statement {
    sid = "CloudWatchLogsWrite"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/azzy/*",
    ]
  }
}

resource "aws_iam_policy" "hq" {
  name   = "${var.name}-hq-instance"
  policy = data.aws_iam_policy_document.hq.json
  tags   = var.tags
}

resource "aws_iam_role_policy_attachment" "hq" {
  role       = aws_iam_role.hq.name
  policy_arn = aws_iam_policy.hq.arn
}

# Lets GitHub Actions run `aws ssm send-command` against the box (infra/scripts/deploy.sh).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.hq.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "hq" {
  name = "${var.name}-hq-instance"
  role = aws_iam_role.hq.name
  tags = var.tags
}
