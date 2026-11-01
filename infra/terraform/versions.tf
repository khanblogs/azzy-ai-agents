terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Uncomment for remote state once you have a bucket:
  # backend "s3" {
  #   bucket = "my-tfstate-bucket"
  #   key    = "azzy-ai-agents/terraform.tfstate"
  #   region = "ap-south-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "azzy-ai-agents"
      ManagedBy = "terraform"
    }
  }
}
