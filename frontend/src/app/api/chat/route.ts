import { google } from '@ai-sdk/google';
import { streamText, Message } from 'ai';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // 1. Safety & Context Layer (System Prompt)
    const systemPrompt: Message = {
      role: 'system',
      content: "You are a helpful, secure, and concise AI assistant. Do not provide illegal advice, hate speech, or harmful instructions. Respond clearly and accurately.",
      id: "system-1"
    };

    // 2. Fetch from Gemini using Vercel AI SDK (HTTP Streaming)
    const result = streamText({
      model: google('models/gemini-1.5-flash'),
      messages: [systemPrompt, ...messages] as Message[],
      temperature: 0.7,
    });

    // 3. Stream the response directly to the client (Server-Sent Events)
    return result.toDataStreamResponse();
  } catch (error) {
    console.error("API Route Error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate response" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
