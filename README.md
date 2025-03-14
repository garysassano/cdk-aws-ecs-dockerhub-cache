# cdk-aws-ecs-dockerhub-cache

CDK app that deploys the NGINX image from Docker Hub to Amazon ECS using ECR pull-through cache.

### Related Apps

- [cdk-aws-apprunner-dockerhub-cache](https://github.com/garysassano/cdk-aws-apprunner-dockerhub-cache) - Uses App Runner instead of ECS.

## Prerequisites

- **_AWS:_**
  - Must have authenticated with [Default Credentials](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli_auth) in your local environment.
  - Must have completed the [CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) for the target AWS environment.
- **_Docker Hub:_**
  - Must have set the `DOCKERHUB_USERNAME` and `DOCKERHUB_ACCESS_TOKEN` variables in your local environment.
- **_Node.js + npm:_**
  - Must be [installed](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) in your system.

## Installation

```sh
npx projen install
```

## Deployment

```sh
npx projen deploy
```

## Cleanup

```sh
npx projen destroy
```

## Architecture Diagram

![Architecture Diagram](./src/assets/arch-diagram.svg)
