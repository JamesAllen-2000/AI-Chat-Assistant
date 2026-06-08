import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Get User ID from Cognito Authorizer Context
    // Fallback to a default for local/unauthenticated testing if authorizer is bypassed
    const userId = event.requestContext?.authorizer?.claims?.sub || 'anonymous-user';
    const tableName = process.env.TABLE_NAME!;
    
    // Handle GET Request: Return chat history or session list
    if (event.httpMethod === 'GET') {
      const sessionId = event.queryStringParameters?.sessionId;

      if (sessionId) {
        // Get messages for a specific session
        const historyParams = {
          TableName: tableName,
          KeyConditionExpression: 'sessionId = :sessionId',
          ExpressionAttributeValues: { ':sessionId': sessionId },
          ScanIndexForward: true, // chronological order
        };
        const historyResult = await docClient.send(new QueryCommand(historyParams));
        const pastMessages = historyResult.Items || []; 
        
        // Security check
        if (pastMessages.length > 0 && pastMessages[0].userId !== userId) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ messages: pastMessages }),
        };
      } else {
        // Get list of all sessions for this user using GSI
        const sessionsParams = {
          TableName: tableName,
          IndexName: 'UserSessionsIndex',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
          ScanIndexForward: false, // latest first
        };
        
        const sessionsResult = await docClient.send(new QueryCommand(sessionsParams));
        const allItems = sessionsResult.Items || [];
        
        // Deduplicate by sessionId to get a list of unique sessions
        const sessionsMap = new Map<string, any>();
        for (const item of allItems) {
          if (!sessionsMap.has(item.sessionId)) {
            // Keep the first user message as the title (since we sort by timestamp descending, this is the latest message, so let's find the first instead or just use it)
            // Wait, we want the *first* message in the session to be the title. 
            // We can just keep track of it, or return all grouped.
            sessionsMap.set(item.sessionId, {
              sessionId: item.sessionId,
              timestamp: item.timestamp,
              preview: item.content.substring(0, 40) + '...'
            });
          }
        }
        
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ sessions: Array.from(sessionsMap.values()) }),
        };
      }
    }

    // Handle POST Request: Process new message
    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
    }

    const { message, sessionId } = JSON.parse(event.body);

    if (!message || !sessionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Message and sessionId are required' }) };
    }

    // 2. Fetch recent conversation history from DynamoDB
    const historyParams = {
      TableName: tableName,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
      },
      ScanIndexForward: false, // get latest first
      Limit: 10, // sliding window memory
    };

    const historyResult = await docClient.send(new QueryCommand(historyParams));
    // Sort chronologically
    const pastMessages = (historyResult.Items || []).reverse(); 

    // Inject Safety System Instruction
    const systemInstruction = "You are a helpful, concise AI assistant. Do not provide medical, legal, or harmful advice.";

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
      systemInstruction,
    });
    
    // Format history for Gemini SDK
    const formattedHistory = pastMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    // Start a chat session with history
    const chatSession = model.startChat({
      history: formattedHistory,
    });

    // 4. Generate Response
    const result = await chatSession.sendMessage(message);
    const aiResponseText = result.response.text();

    // 5. Save the new messages to DynamoDB
    const timestamp = new Date().toISOString();
    const userMessageId = uuidv4();
    const aiMessageId = uuidv4();

    // Save User Message
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        sessionId,
        timestamp,
        userId,
        messageId: userMessageId,
        role: 'user',
        content: message,
      }
    }));

    // Save AI Response
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        sessionId,
        timestamp: new Date().toISOString(), // slightly later to preserve order
        userId,
        messageId: aiMessageId,
        role: 'assistant',
        content: aiResponseText,
      }
    }));

    // 6. Return response to client
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // Configured for CORS
      },
      body: JSON.stringify({
        response: aiResponseText,
      }),
    };

  } catch (error) {
    console.error('Error generating AI response:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
