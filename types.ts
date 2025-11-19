export enum Sender {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: Sender;
  timestamp: number;
  isCorrection?: boolean;
}

export interface AnalysisResult {
  markdown: string;
}

export interface NewsTopic {
  title: string;
  summary: string;
  url: string;
}

export type ProficiencyLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';