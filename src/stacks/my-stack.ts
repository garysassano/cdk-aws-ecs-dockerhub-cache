import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Port, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  CfnPullThroughCacheRule,
  CfnRegistryPolicy,
  Repository,
} from "aws-cdk-lib/aws-ecr";
import {
  Cluster,
  Compatibility,
  ContainerImage,
  Protocol as EcsProtocol,
  FargateService,
  LogDriver,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  Protocol,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { validateEnv } from "../utils/validate-env";

/**
 * Prefix required for ECR pull-through cache secrets in AWS Secrets Manager.
 * @see https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache-creating-rule.html#cache-rule-prereq
 */
const ECR_PULL_THROUGH_CACHE_PREFIX = "ecr-pullthroughcache/";

const env = validateEnv(["DOCKERHUB_USERNAME", "DOCKERHUB_ACCESS_TOKEN"]);

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    //==============================================================================
    // SECRETS MANAGER
    //==============================================================================

    const dhCacheRuleSecret = new Secret(this, "DhCacheRuleSecret", {
      secretName: `${ECR_PULL_THROUGH_CACHE_PREFIX}dockerhub`,
      secretStringValue: SecretValue.unsafePlainText(
        JSON.stringify({
          username: env.DOCKERHUB_USERNAME,
          accessToken: env.DOCKERHUB_ACCESS_TOKEN,
        }),
      ),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    //==============================================================================
    // VPC
    //==============================================================================

    const defaultVpc = Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    //==============================================================================
    // ALB
    //==============================================================================

    const nginxAlb = new ApplicationLoadBalancer(this, "NginxAlb", {
      vpc: defaultVpc,
      internetFacing: true,
    });

    const nginxAlbHttpListener = nginxAlb.addListener("NginxAlbHttpListener", {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
    });

    //==============================================================================
    // IAM
    //==============================================================================

    // Role for pulling images from ECR
    const ecsTaskExecutionRole = new Role(this, "EcsTaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    //==============================================================================
    // ECR
    //==============================================================================

    const dhCacheRule = new CfnPullThroughCacheRule(this, "DhCacheRule", {
      ecrRepositoryPrefix: "dockerhub",
      upstreamRegistry: "docker-hub",
      upstreamRegistryUrl: "registry-1.docker.io",
      credentialArn: dhCacheRuleSecret.secretArn,
    });

    const dhCacheRegistryPolicy = new CfnRegistryPolicy(
      this,
      "DhCacheRegistryPolicy",
      {
        policyText: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AllowDockerhubCache",
              Effect: "Allow",
              Principal: { AWS: ecsTaskExecutionRole.roleArn },
              Action: ["ecr:CreateRepository", "ecr:BatchImportUpstreamImage"],
              Resource: `arn:aws:ecr:${this.region}:${this.account}:repository/${dhCacheRule.ecrRepositoryPrefix}/*`,
            },
          ],
        },
      },
    );

    const ecrNginxRepo = new Repository(this, "EcrNginxRepo", {
      repositoryName: `${dhCacheRule.ecrRepositoryPrefix}/library/nginx`,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    //==============================================================================
    // ECS
    //==============================================================================

    const ecsCluster = new Cluster(this, "EcsCluster", {
      vpc: defaultVpc,
    });

    const ecsTaskDefinition = new TaskDefinition(this, "EcsTaskDefinition", {
      compatibility: Compatibility.FARGATE,
      cpu: "512",
      memoryMiB: "1024",
      executionRole: ecsTaskExecutionRole,
    });

    ecsTaskDefinition.addContainer("nginx", {
      image: ContainerImage.fromEcrRepository(ecrNginxRepo),
      portMappings: [
        {
          containerPort: 80,
          hostPort: 80,
          protocol: EcsProtocol.TCP,
          name: "http",
        },
      ],
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
        startPeriod: Duration.seconds(10),
      },
      logging: LogDriver.awsLogs({
        streamPrefix: "/ecs/nginx",
        logRetention: RetentionDays.ONE_WEEK,
      }),
    });

    const nginxService = new FargateService(this, "NginxService", {
      cluster: ecsCluster,
      taskDefinition: ecsTaskDefinition,
      desiredCount: 2,
      assignPublicIp: true,
    });

    // Ensure the registry policy is created before the service tries to pull images.
    // Without this dependency, the ECS service might fail to start if it attempts
    // to pull images before the ECR registry policy is in place.
    nginxService.node.addDependency(dhCacheRegistryPolicy);

    //==============================================================================
    // ALB TARGET GROUP
    //==============================================================================

    const httpTarget = nginxService.loadBalancerTarget({
      containerName: "nginx",
      containerPort: 80,
      protocol: EcsProtocol.TCP,
    });

    nginxAlbHttpListener.addTargets("HttpTarget", {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      targets: [httpTarget],
      healthCheck: {
        path: "/",
        port: "80",
        protocol: Protocol.HTTP,
        healthyHttpCodes: "200",
      },
    });

    // Security Group Rules
    nginxService.connections.allowFrom(
      nginxAlb,
      Port.tcp(80),
      "Allow ALB to access Nginx HTTP endpoint",
    );
  }
}
