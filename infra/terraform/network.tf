# VPC / subnet selection (default VPC unless overridden) and the security group.

data "aws_vpc" "default" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

locals {
  vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default[0].id
}

data "aws_subnets" "public" {
  count = var.subnet_id == "" ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

locals {
  subnet_id = var.subnet_id != "" ? var.subnet_id : sort(data.aws_subnets.public[0].ids)[0]
}

resource "aws_security_group" "hq" {
  name        = "${var.name}-hq"
  description = "AZZY AI AGENTS HQ: HTTP/HTTPS from anywhere; SSH only via Tailscale (or admin_cidr)."
  vpc_id      = local.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-hq" })
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.hq.id
  description       = "HTTP (ACME challenge + redirect)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.hq.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# Tailscale works through NAT with outbound UDP only; this rule speeds up direct connections.
resource "aws_vpc_security_group_ingress_rule" "tailscale_udp" {
  security_group_id = aws_security_group.hq.id
  description       = "Tailscale WireGuard (optional direct path)"
  ip_protocol       = "udp"
  from_port         = 41641
  to_port           = 41641
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "ssh_admin" {
  count             = var.admin_cidr != "" ? 1 : 0
  security_group_id = aws_security_group.hq.id
  description       = "Break-glass SSH from admin_cidr"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.admin_cidr
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.hq.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
