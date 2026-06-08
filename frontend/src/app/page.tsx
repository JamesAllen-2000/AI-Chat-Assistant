'use client';

import { useChat } from '@ai-sdk/react';
import { Bot, Send, User, Loader2, LogOut, Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar } from '@/components/ui/avatar';
import { useEffect, useRef, useState } from 'react';

// AWS Amplify Imports
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import '@aws-amplify/ui-react/styles.css';

// Configure Amplify with the values from your CDK deployment
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || '',
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '',
    }
  }
});

export default function ChatPage() {
  return (
    <Authenticator 
      hideSignUp={false}
      components={{
        Header() {
          return (
            <div className="text-center pb-4 pt-10">
              <h2 className="text-2xl font-bold text-emerald-400">AI Chat Assistant</h2>
              <p className="text-neutral-400 text-sm">Please log in to continue</p>
            </div>
          );
        }
      }}
    >
      {({ signOut }) => (
        <ChatInterface onSignOut={signOut} />
      )}
    </Authenticator>
  );
}

function ChatInterface({ onSignOut }: { onSignOut: (() => void) | undefined }) {
  const [messages, setMessages] = useState<Array<{id: string, role: string, content: string}>>([]);
  const [sessions, setSessions] = useState<Array<{sessionId: string, timestamp: string, preview: string}>>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Auto-scroll to bottom as new messages arrive
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load Sessions List on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Load Messages when activeSessionId changes
  useEffect(() => {
    if (activeSessionId) {
      loadMessagesForSession(activeSessionId);
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  const loadSessions = async () => {
    try {
      const auth = await fetchAuthSession();
      const token = auth.tokens?.idToken?.toString();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}chat`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.sessions) setSessions(data.sessions);
      }
    } catch (e) { console.error("Failed to load sessions", e); }
  };

  const loadMessagesForSession = async (sessionId: string) => {
    setIsLoading(true);
    setMessages([]);
    try {
      const auth = await fetchAuthSession();
      const token = auth.tokens?.idToken?.toString();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}chat?sessionId=${sessionId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages.map((m: any) => ({
            id: m.messageId, role: m.role, content: m.content
          })));
        }
      }
    } catch (e) { console.error("Failed to load messages", e); }
    setIsLoading(false);
  };

  const handleNewChat = () => {
    setActiveSessionId('');
    setMessages([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    const sessionId = activeSessionId || crypto.randomUUID();
    if (!activeSessionId) {
      setActiveSessionId(sessionId);
    }

    const newMessages = [...messages, { id: Date.now().toString(), role: 'user', content: userMessage }];
    setMessages(newMessages);

    try {
      const auth = await fetchAuthSession();
      const currentToken = auth.tokens?.idToken?.toString() || '';

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({ message: userMessage, sessionId }),
      });
      
      const data = await res.json();
      setMessages([...newMessages, { id: Date.now().toString(), role: 'assistant', content: data.response || "No response received." }]);
      
      // Refresh sidebar sessions to show the new chat or updated timestamp
      loadSessions();
    } catch (error) {
      console.error(error);
      setMessages([...newMessages, { id: Date.now().toString(), role: 'assistant', content: "Sorry, I encountered an error connecting to AWS." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-neutral-950 font-sans text-neutral-100 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col hidden md:flex">
        <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900/50 backdrop-blur-sm z-10">
          <Button onClick={handleNewChat} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/20 justify-start gap-2">
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-3 flex flex-col gap-1">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 mt-2 px-2">Recent Chats</div>
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => setActiveSessionId(session.sessionId)}
                className={`w-full text-left px-3 py-3 rounded-lg text-sm truncate flex items-center gap-3 transition-colors ${
                  activeSessionId === session.sessionId 
                    ? 'bg-neutral-800 text-emerald-400' 
                    : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
                }`}
              >
                <MessageSquare className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{session.preview}</span>
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-neutral-600">No recent chats</div>
            )}
          </div>
        </ScrollArea>
        
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/50">
          <Button variant="ghost" onClick={onSignOut} className="w-full text-neutral-400 hover:text-white hover:bg-neutral-800 justify-start gap-2">
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-neutral-950 relative overflow-hidden min-w-0">
        {/* Header */}
        <div className="h-16 shrink-0 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md flex items-center px-6 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Bot className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">AI Assistant</h1>
              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                Connected to AWS
              </div>
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        <ScrollArea className="flex-1 p-6 min-h-0">
          <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-6">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center text-neutral-500 gap-4 mt-32">
                <div className="p-4 bg-neutral-800/50 rounded-full shadow-lg shadow-neutral-900/50">
                  <Bot className="w-12 h-12 text-neutral-400" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-neutral-300">How can I help you today?</h3>
                  <p className="text-sm mt-1">Start a new conversation securely via AWS.</p>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <Avatar className="w-8 h-8 bg-emerald-500/10 text-emerald-400 flex items-center justify-center mt-1 border border-emerald-500/20 shadow-sm">
                    <Bot className="w-4 h-4" />
                  </Avatar>
                )}
                
                <div className={`rounded-2xl px-5 py-3.5 max-w-[85%] leading-relaxed shadow-sm ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-neutral-900 text-neutral-200 rounded-bl-sm border border-neutral-800/80 shadow-lg'
                }`}>
                  <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                </div>

                {m.role === 'user' && (
                  <Avatar className="w-8 h-8 bg-blue-600 flex items-center justify-center text-white mt-1 shadow-sm">
                    <User className="w-4 h-4" />
                  </Avatar>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-4 justify-start">
                <Avatar className="w-8 h-8 bg-emerald-500/10 text-emerald-400 flex items-center justify-center mt-1 border border-emerald-500/20 shadow-sm">
                  <Bot className="w-4 h-4" />
                </Avatar>
                <div className="bg-neutral-900 text-neutral-200 rounded-2xl rounded-bl-sm px-6 py-4 flex items-center gap-3 border border-neutral-800/80 shadow-lg">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span className="text-sm text-neutral-400 font-medium tracking-wide">Generating...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-px w-full" />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="shrink-0 p-4 bg-neutral-950 border-t border-neutral-800 z-10">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-3 relative">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              className="flex-1 bg-neutral-900 border-neutral-800 text-neutral-100 placeholder:text-neutral-500 focus-visible:ring-1 focus-visible:ring-emerald-500 h-14 px-5 rounded-2xl shadow-xl"
              disabled={isLoading}
            />
            <Button 
              type="submit" 
              disabled={isLoading || !input?.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white h-14 w-14 rounded-2xl transition-all shadow-lg shadow-emerald-900/20"
              size="icon"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
