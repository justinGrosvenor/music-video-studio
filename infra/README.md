# Infrastructure

Terragrunt + Terraform for the Fargate stack.

## Layout

```
infra/
  terragrunt.hcl                 # root: provider + state backend
  envs/hackathon/
    env.hcl                      # env-level inputs (project name, image tag, port)
    networking/                  # default VPC + public subnets (data sources only)
    ecr/                         # music-video-studio-api repo
    alb/                         # ALB + target group + HTTP listener
    cluster/                     # ECS Fargate cluster
    storage/                     # S3 bucket for uploads + renders (public-read)
    service/                     # task definition, service, IAM, logs, SG
  modules/                       # the actual Terraform
  scripts/
    bootstrap-ecr.sh             # build + push first image (no service redeploy)
    deploy-image.sh              # build + push + force redeploy
```

## Prereqs

- AWS CLI configured (`aws sts get-caller-identity` returns an account)
- `terragrunt` and `terraform` on PATH
- Docker for image builds

## Bootstrap

One-time secrets in SSM Parameter Store. The task definition reads from these.

```bash
aws ssm put-parameter --name /music-video-studio/hackathon/RUNWAYML_API_SECRET \
  --value 'key_...' --type SecureString --region us-east-1

aws ssm put-parameter --name /music-video-studio/hackathon/MODAL_AUDIO_URL \
  --value 'https://...modal.run' --type String --region us-east-1
```

## Apply (first time)

The `service` stack will fail to start a task if no image exists at `<ecr>:latest` yet. Bootstrap in three steps:

```bash
cd infra/envs/hackathon

# 1. Bring up everything except the service (which needs the image).
terragrunt -working-dir networking apply
terragrunt -working-dir ecr apply
terragrunt -working-dir alb apply
terragrunt -working-dir cluster apply
terragrunt -working-dir storage apply

# 2. Build + push the first image to ECR. (No service redeploy — the service
#    doesn't exist yet.)
../../scripts/bootstrap-ecr.sh

# 3. Bring up the service. With the image present, the task starts cleanly.
terragrunt -working-dir service apply
```

After this, `terragrunt run-all apply` from `infra/envs/hackathon` is a clean re-apply of everything.

## Push and deploy (subsequent updates)

```bash
infra/scripts/deploy-image.sh           # builds, pushes :latest, force-redeploys
infra/scripts/deploy-image.sh v0.0.2    # arbitrary tag
```

`deploy-image.sh` reuses `bootstrap-ecr.sh` for the build + push half, then calls `aws ecs update-service --force-new-deployment` to roll the running tasks.

Builds target `linux/amd64` (Fargate is x86_64 by default), so it works from an Apple Silicon laptop without surprise architecture mismatches.

## State

Local state under `infra/.tfstate/<stack>/terraform.tfstate` for now. Bootstrap an S3 bucket + DynamoDB lock table and uncomment the `s3` backend block in `infra/terragrunt.hcl` when you want shared/remote state.

## What it costs (rough)

- ALB: ~$22/mo (this is the main fixed cost)
- ECS Fargate task (1 vCPU / 2 GB, on-demand): ~$0.05/hr
- ECR storage: cents
- CloudWatch logs (7-day retention): cents

For a hackathon weekend, expect ~$5–10 total. Tear down with `terragrunt run-all destroy` when done.

## Tear down

```bash
cd infra/envs/hackathon
terragrunt run-all destroy
```

ECR has `force_delete = true` so untagged images don't block destroy.
