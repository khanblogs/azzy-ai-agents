variable "aws_region" {
  description = "Region for the HQ instance, backups bucket and Bedrock calls."
  type        = string
  default     = "ap-south-1"
}

variable "name" {
  description = "Name prefix for all resources."
  type        = string
  default     = "azzy-ai-agents"
}

variable "instance_type" {
  description = "EC2 instance type for the HQ box. Recommended m7i.xlarge (4 vCPU / 16 GB) for real mode; r7i.large (2 vCPU / 16 GB) or m7i.large (2 vCPU / 8 GB, DEMO only) are cheaper alternatives."
  type        = string
  default     = "m7i.xlarge"
}

variable "root_volume_gb" {
  description = "Root gp3 volume size in GiB (recommended 120)."
  type        = number
  default     = 120
}

variable "repo_url" {
  description = "Git URL bootstrap.sh clones into /opt/azzy-ai-agents (https; use a deploy token for private repos)."
  type        = string
}

variable "repo_branch" {
  description = "Branch bootstrap.sh checks out."
  type        = string
  default     = "main"
}

variable "vpc_id" {
  description = "VPC to launch in. Empty = the account's default VPC."
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Public subnet to launch in. Empty = first subnet of the chosen VPC."
  type        = string
  default     = ""
}

variable "admin_cidr" {
  description = "Optional CIDR allowed to reach port 22 directly. Leave empty: SSH goes through Tailscale."
  type        = string
  default     = ""

  validation {
    condition     = var.admin_cidr == "" || can(cidrnetmask(var.admin_cidr))
    error_message = "admin_cidr must be empty or a valid IPv4 CIDR like 203.0.113.4/32."
  }
}

variable "backup_retention_days" {
  description = "Days to keep Postgres dumps in the backups bucket."
  type        = number
  default     = 30
}

variable "bedrock_model_arns" {
  description = "Bedrock model/inference-profile ARNs the instance may invoke. Default: any Anthropic foundation model in any region."
  type        = list(string)
  default = [
    "arn:aws:bedrock:*::foundation-model/anthropic.*",
    "arn:aws:bedrock:*:*:inference-profile/*anthropic.*",
  ]
}

variable "tags" {
  description = "Extra tags merged onto every resource."
  type        = map(string)
  default     = {}
}
