# Root Terragrunt config — applies to every leaf stack via `include "root"`.
#
# State backend: local for now. Swap to S3 by:
#   1. Bootstrap an S3 bucket + DynamoDB table out-of-band (one-shot).
#   2. Replace the `local` block below with the commented `s3` block.

locals {
  project = "music-video-studio"
  region  = "us-east-1"
}

generate "provider" {
  path      = "_provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = "${local.region}"
  default_tags {
    tags = {
      Project     = "${local.project}"
      ManagedBy   = "terragrunt"
    }
  }
}
EOF
}

remote_state {
  backend = "local"
  generate = {
    path      = "_backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    path = "${get_parent_terragrunt_dir()}/.tfstate/${path_relative_to_include()}/terraform.tfstate"
  }
}

# Use this once an S3 bucket exists:
#
# remote_state {
#   backend = "s3"
#   generate = {
#     path      = "_backend.tf"
#     if_exists = "overwrite_terragrunt"
#   }
#   config = {
#     bucket         = "music-video-studio-tfstate"
#     key            = "${path_relative_to_include()}/terraform.tfstate"
#     region         = local.region
#     encrypt        = true
#     dynamodb_table = "music-video-studio-tflock"
#   }
# }

inputs = {
  project = local.project
  region  = local.region
}
