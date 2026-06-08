import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Groq from 'groq-sdk';
import { v4 as uuidv4 } from 'uuid';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext?.authorizer?.claims?.sub || 'anonymous-user';
    const tableName = process.env.TABLE_NAME!;
    
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
        
        const sessionsMap = new Map<string, any>();
        for (const item of allItems) {
          if (!sessionsMap.has(item.sessionId)) {
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

    // Format history for Groq SDK
    const formattedHistory = pastMessages.map(msg => ({
      role: msg.role, // 'assistant' or 'user'
      content: msg.content,
    }));

    // Inject Safety System Instruction
    formattedHistory.unshift({
      role: "system",
      content: "You are a helpful, concise AI assistant. Do not provide medical, legal, or harmful advice."
    });
    
    // Add new user message
    formattedHistory.push({
      role: "user",
      content: message
    });

    const chatCompletion = await groq.chat.completions.create({
      messages: formattedHistory as any,
      model: "llama-3.1-8b-instant",
      temperature: 0.7,
    });
    const aiResponseText = chatCompletion.choices[0]?.message?.content || "";

    const timestamp = new Date().toISOString();
    const userMessageId = uuidv4();
    const aiMessageId = uuidv4();

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

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        sessionId,
        timestamp: new Date().toISOString(),
        userId,
        messageId: aiMessageId,
        role: 'assistant',
        content: aiResponseText,
      }
    }));

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
