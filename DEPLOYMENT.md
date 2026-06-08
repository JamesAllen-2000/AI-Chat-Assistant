# AI Chat Assistant - Deployment & Testing Guide

This project is divided into two distinct parts:
1. **Frontend**: A Next.js web application with a sleek, responsive chat interface.
2. **Backend**: An AWS CDK infrastructure defining a Serverless backend (API Gateway, Lambda, DynamoDB, Cognito).

To satisfy the constraints of using **100% free** services, we substituted AWS Bedrock with **Google Gemini**. All AWS services utilized are well within the generous AWS Free Tier.

---

## 1. Local Testing (Frontend & Local API Route)

You can run the entire chat interface locally without needing to deploy the AWS backend immediately. We built a Next.js local API Route that connects directly to Gemini for testing purposes.

### Prerequisites
* Node.js v18+
* A Google Gemini API Key (Get one for free at [Google AI Studio](https://aistudio.google.com/))

### Steps
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Open the `.env.local` file and add your Gemini API Key:
   ```env
   GOOGLE_GENERATIVE_AI_API_KEY=your_actual_api_key_here
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:3000`. You can now chat with the AI!

---

## 2. Production AWS Backend Deployment (AWS CDK)

This section covers deploying the production-grade, persistent, serverless backend to AWS.

### Architecture Deployed
* **Amazon Cognito**: User Authentication (User Pool).
* **Amazon API Gateway**: HTTP endpoints with CORS and Cognito Authorizers.
* **AWS Lambda**: Node.js compute handling logic, prompt engineering, and LLM calls.
* **Amazon DynamoDB**: NoSQL table for persistent conversation memory.

### Prerequisites
* An active AWS Account.
* AWS CLI installed and configured (`aws configure`).
* AWS CDK installed globally (`npm install -g aws-cdk`).

### Steps
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install the backend dependencies:
   ```bash
   npm install
   ```
3. Bootstrap your AWS environment (if you've never used CDK in this region before):
   ```bash
   npx cdk bootstrap
   ```
4. Provide your Gemini API Key to the Lambda via environment variable or at synth time:
   *(On Windows PowerShell)*
   ```powershell
   $env:GEMINI_API_KEY="AQ.Ab8RN6Ld_DWzS-xbv5tlJBjo8H08vOWvTo1QVc7XrgXFtrNvqA"
   npx cdk deploy
   ```
   *(On Mac/Linux)*
   ```bash
   GEMINI_API_KEY="your_api_key_here" npx cdk deploy
   ```
5. Approve the IAM security changes by typing `y` when prompted.

### Connecting Frontend to AWS
Once the CDK deployment finishes, it will output three values in your terminal:
* `ApiEndpoint`
* `UserPoolId`
* `UserPoolClientId`

You would update your Next.js application to point its API calls to the new `ApiEndpoint` and integrate AWS Amplify on the frontend using the User Pool IDs for authentication.

---

## 3. Rationale & Edge Cases Handled

* **Real-time UX**: The local Next.js API uses **Server-Sent Events (Streaming)** via Vercel AI SDK to stream tokens to the screen instantly, preventing 5-10 second timeouts.
* **Cold Starts**: We chose `Node.js` for the Lambda runtime because it has significantly faster cold-start times than Python or Java. We also use CDK's `NodejsFunction` which uses `esbuild` to aggressively bundle and minify the Lambda code.
* **Cost Efficiency**: Using `PAY_PER_REQUEST` for DynamoDB ensures you are only billed for exact usage (which easily fits into the 200M free requests/month).
* **Context Overflow Safety**: The AWS Lambda handler queries DynamoDB but sets `Limit: 10`. This implements a "Sliding Window" memory strategy. It only feeds the last 10 messages into the LLM context, ensuring we never exceed the token limit, no matter how long the conversation gets.
* **Security**: API Gateway is configured with a Cognito Authorizer, meaning the Lambda will instantly reject any request that doesn't contain a valid user token.
