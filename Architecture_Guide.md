# AI Chatbot Architecture & Implementation Guide

This document outlines the architecture, design choices, and production-ready concepts for building a serverless AI Chatbot. 

Since the goal is to use free alternatives while keeping the architecture production-ready and adhering to the prompt's AWS serverless constraints, we will outline the optimal tech stack, edge cases, and safety measures.

## 1. Architecture & Tech Stack (With Free Alternatives)

### Frontend (UI & Client Logic)
*   **Production Standard**: React (Next.js or Vite) with Tailwind CSS.
*   **Hosting**: Vercel or Netlify (Both offer **100% free** tiers for frontend hosting).
*   **Why**: React provides excellent state management for chat interfaces. Tailwind ensures a clean, responsive UI with minimal overhead. Next.js/Vite simplifies building and deployment.

### Backend / API (Serverless)
*   **Production Standard**: AWS API Gateway + AWS Lambda.
*   **Free Alternative / Tier**: 
    *   **AWS Free Tier**: You get 1 million free Lambda requests and 1M API Gateway calls per month, which is more than enough for this assessment.
    *   **Non-AWS Free Alternative**: Cloudflare Workers or Vercel Serverless Functions (completely free, edge-optimized).
*   **Language**: Node.js (TypeScript). Node has extremely fast cold starts in Lambda, which is critical for real-time chat responsiveness.

### Database (Persistent Memory)
*   **Production Standard**: AWS DynamoDB.
*   **Free Alternative / Tier**: 
    *   **AWS Free Tier**: 25 GB of storage and 200M read/write requests per month forever.
    *   **Non-AWS Free Alternatives**: Upstash (Serverless Redis, great for fast chat history) or Supabase (Serverless Postgres with a great free tier).
*   **Schema Design (DynamoDB)**:
    *   `SessionId` (Partition Key): Unique ID for the chat session.
    *   `Timestamp` (Sort Key): To order messages chronologically.
    *   `Role` (String): 'user' or 'assistant'.
    *   `Content` (String): The message text.

### LLM API (The "Brain")
*   **Standard**: OpenAI GPT-4o / GPT-3.5 (Requires adding a credit card).
*   **Free Alternatives**:
    *   **Google Gemini API**: Offers a generous free tier (up to 15 requests per minute for Gemini 1.5 Flash).
    *   **Groq API**: Offers free API access with incredibly fast inference speeds using open-source models like Llama 3.

---

## 2. Real-Time Message Exchange

True WebSockets (via AWS API Gateway WebSockets) can be complex and expensive. For modern AI chats (like ChatGPT), **Server-Sent Events (SSE) / HTTP Streaming** is the production standard.
*   **How it works**: The frontend sends an HTTP POST request to the Lambda function. The Lambda function calls the LLM, and as the LLM generates tokens, Lambda streams them back to the frontend in chunks.
*   **UX Benefit**: The user sees the AI typing in real-time, reducing perceived latency to almost zero.

---

## 3. Persistent Conversation Memory & Prompt Engineering

LLMs are stateless; they don't remember past messages. You must inject the history into every request.

**The Flow:**
1. User sends a message.
2. Lambda fetches the last $N$ messages for this `SessionId` from DynamoDB.
3. Lambda formats the Prompt:
    *   **System Prompt**: *"You are a helpful, concise AI assistant. Format your answers in Markdown..."*
    *   **Context/History**: `[ {role: 'user', content: 'Hi'}, {role: 'assistant', content: 'Hello!'} ]`
    *   **New Message**: `[ {role: 'user', content: 'What is 2+2?'} ]`
4. Send the payload to the LLM API.
5. Save both the user's message and the AI's response back to DynamoDB.

**Production Edge Case (Context Limit Overflow)**:
If the user chats for hours, the history will exceed the LLM's maximum token limit.
*   *Solution*: Implement a **Sliding Window**. Only fetch and send the last 10-20 messages, or summarize older messages into a single "Memory summary" block to save tokens.

---

## 4. Safety and Content Moderation Layer

A production chatbot must prevent abuse and harmful outputs.
1.  **Pre-processing (Input Guardrails)**: Check user input against a hardcoded blocklist of bad words or topics before hitting the LLM (saves API costs).
2.  **LLM Guardrails**: Inject strong safety instructions into the System Prompt: *"Do not provide medical advice. Do not generate hate speech."*
3.  **Free Moderation API**: OpenAI provides a **completely free** Moderation API (`/v1/moderations`) that scores text for violence, self-harm, etc. You can run user messages through this asynchronously.

---

## 5. Handling Edge Cases, Failures, and States

A senior engineer separates themselves by how they handle things breaking:

*   **LLM API Rate Limits / Timeouts**: LLM providers go down or rate limit you. 
    *   *Implementation*: Use **Exponential Backoff** on the backend. If the API fails, wait 1s, retry. If it fails, wait 2s, retry.
*   **Network Disconnections**: The user loses internet while waiting for a response.
    *   *Implementation*: Cache unsent messages in `localStorage` on the frontend. Show an "Offline" banner. When they reconnect, sync and retry.
*   **Cold Starts (AWS Lambda)**: The first request after inactivity might take 2-3 seconds.
    *   *Implementation*: Have the frontend send a lightweight "ping" or "warm-up" request to the backend as soon as the webpage loads, before the user even types a message.
*   **Basic Loading States**:
    *   Disable the "Send" button while generating.
    *   Show a bouncing typing indicator (like iMessage) while waiting for the first stream chunk.
    *   If an error occurs, render an inline error message: *"Failed to generate response. [Retry Button]"*.

---

## 6. Scalability, Maintainability, and Security

*   **Infrastructure as Code (IaC)**: Do not click around the AWS Console to create Lambdas. Use the **Serverless Framework (Free)** or **AWS SAM**. This allows you to define your Lambda and API Gateway in a `serverless.yml` file, making it version-controlled and reproducible.
*   **Security (CORS & Auth)**:
    *   Configure API Gateway CORS to **only** allow requests from your specific frontend domain (e.g., `https://my-chat.vercel.app`).
    *   Do NOT put LLM API keys in the frontend. Keep them in AWS Parameter Store or Lambda Environment Variables.
*   **Rate Limiting**: Prevent a malicious user from draining your free tier or running up bills by implementing usage plans and API keys in AWS API Gateway (e.g., max 10 requests per minute per IP).
