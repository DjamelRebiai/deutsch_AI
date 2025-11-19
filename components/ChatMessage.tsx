import React from 'react';
import { ChatMessage as IChatMessage, Sender } from '../types';

interface Props {
  message: IChatMessage;
}

export const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.sender === Sender.USER;
  const isSystem = message.sender === Sender.SYSTEM;

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <span className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
          {message.text}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`
          max-w-[80%] px-4 py-3 rounded-2xl shadow-sm
          ${isUser 
            ? 'bg-blue-600 text-white rounded-br-sm' 
            : 'bg-slate-700 text-slate-100 rounded-bl-sm border border-slate-600'
          }
          ${message.isCorrection ? 'border-l-4 border-l-yellow-400' : ''}
        `}
      >
        {message.isCorrection && !isUser && (
          <div className="text-xs font-bold text-yellow-400 mb-1 uppercase tracking-wider">Correction / Suggestion</div>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
};