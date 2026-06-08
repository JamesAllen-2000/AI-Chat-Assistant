import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as aws_lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Authentication: Cognito User Pool
    const userPool = new cognito.UserPool(this, 'ChatbotUserPool', {
      userPoolName: 'AiChatbotUsers',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
      },
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'ChatbotUserPoolClient', {
      userPool,
      generateSecret: false, // For web client (Next.js)
    });

    // Database: DynamoDB for Chat History (Free Tier Eligible)
    const chatTable = new dynamodb.Table(this, 'ChatSessionsTable2', {
      tableName: 'ChatSessions2',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI to query all sessions by a user
    chatTable.addGlobalSecondaryIndex({
      indexName: 'UserSessionsIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Compute: AWS Lambda (Node.js)
    const chatLambda = new aws_lambda_nodejs.NodejsFunction(this, 'ChatHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/chat.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30), // LLM calls can take a bit
      environment: {
        TABLE_NAME: chatTable.tableName,
        GROQ_API_KEY: process.env.GROQ_API_KEY || 'MISSING_API_KEY',
      },
    });

    // Grant Lambda permissions to read/write to the DynamoDB table
    chatTable.grantReadWriteData(chatLambda);

    // API Layer: API Gateway
    const api = new apigateway.RestApi(this, 'ChatbotApi', {
      restApiName: 'AI Chatbot API',
      description: 'API for AI Chat interactions',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Add Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ChatAuthorizer', {
      cognitoUserPools: [userPool],
    });

    const chatIntegration = new apigateway.LambdaIntegration(chatLambda);
    const chatResource = api.root.addResource('chat');

    chatResource.addMethod('POST', chatIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    chatResource.addMethod('GET', chatIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Output variables for the frontend to use
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }
}
