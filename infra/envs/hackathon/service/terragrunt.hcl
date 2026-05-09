include "root" {
  path = find_in_parent_folders("terragrunt.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "../../../modules/service"
}

dependency "networking" {
  config_path = "../networking"
  mock_outputs = {
    vpc_id            = "vpc-mock"
    public_subnet_ids = ["subnet-mock-a", "subnet-mock-b"]
  }
}

dependency "ecr" {
  config_path = "../ecr"
  mock_outputs = {
    repository_url = "000000000000.dkr.ecr.us-east-1.amazonaws.com/music-video-studio-api"
  }
}

dependency "alb" {
  config_path = "../alb"
  mock_outputs = {
    target_group_arn = "arn:aws:elasticloadbalancing:us-east-1:000000000000:targetgroup/mock/mock"
    alb_sg_id        = "sg-mock"
    alb_dns_name     = "mock.us-east-1.elb.amazonaws.com"
  }
}

dependency "cluster" {
  config_path = "../cluster"
  mock_outputs = {
    cluster_id   = "arn:aws:ecs:us-east-1:000000000000:cluster/mock"
    cluster_name = "mock"
  }
}

dependency "storage" {
  config_path = "../storage"
  mock_outputs = {
    bucket_name     = "mock-bucket"
    bucket_arn      = "arn:aws:s3:::mock-bucket"
    public_url_base = "https://mock-bucket.s3.us-east-1.amazonaws.com"
  }
}

inputs = {
  environment       = local.env.environment
  api_port          = local.env.api_port
  image_tag         = local.env.image_tag
  vpc_id            = dependency.networking.outputs.vpc_id
  public_subnet_ids = dependency.networking.outputs.public_subnet_ids
  repository_url    = dependency.ecr.outputs.repository_url
  target_group_arn  = dependency.alb.outputs.target_group_arn
  alb_sg_id         = dependency.alb.outputs.alb_sg_id
  alb_dns_name      = dependency.alb.outputs.alb_dns_name
  cluster_name      = dependency.cluster.outputs.cluster_name
  cluster_id        = dependency.cluster.outputs.cluster_id
  s3_bucket_name    = dependency.storage.outputs.bucket_name
  s3_bucket_arn     = dependency.storage.outputs.bucket_arn
  s3_public_url     = dependency.storage.outputs.public_url_base
}
