import { create } from 'zustand'
import { RENDERER_LIMITS } from '../shared/constants'
import type { AgentState } from '../shared/agentState'
import type { Activity, Approval, Artifact, ChangedFile, Conversation, Message, PlanStep, Suggestion } from './types'

interface AppState {
  conversations: Conversation[]; activeId: string | null; messages: Message[]
  executionId: string | null
  status: AgentState; finalizing: boolean; streaming: string; diff: string; activities: Activity[]; approvals: Approval[]; files: ChangedFile[]; artifacts: Artifact[]; suggestions: Suggestion[]; plan: PlanStep[]; planExplanation: string; error: string | null
  setConversations(value: Conversation[]): void; setActive(id: string | null): void; setMessages(value: Message[]): void
  setExecutionId(value: string | null): void
  addMessage(value: Message): void; setStatus(value: AgentState): void; setFinalizing(value: boolean): void; appendStream(value: string): void; clearRun(): void
  setDiff(value: string): void; upsertActivity(value: Activity): void; addApproval(value: Approval): void
  resolveApproval(key: string, status: 'accepted' | 'declined'): void; setError(value: string | null): void
  setFiles(value: ChangedFile[]): void; addFiles(value: ChangedFile[]): void
  setArtifacts(value: Artifact[]): void; setSuggestions(value: Suggestion[]): void; setPlan(value: PlanStep[], explanation?: string): void
}

const {
  activities: MAX_ACTIVITIES,
  activityDetailCharacters: MAX_ACTIVITY_DETAIL,
  chatMessages: MAX_CHAT_MESSAGES,
  streamCharacters: MAX_STREAM_SIZE,
} = RENDERER_LIMITS
const MAX_CHANGED_FILES = 300

export const useAppStore = create<AppState>((set) => ({
  conversations: [], activeId: null, messages: [], executionId: null, status: 'disconnected', finalizing: false, streaming: '', diff: '', activities: [], approvals: [], files: [], artifacts: [], suggestions: [], plan: [], planExplanation: '', error: null,
  setConversations: (conversations) => set({ conversations }), setActive: (activeId) => set({ activeId }), setExecutionId: (executionId) => set({ executionId }),
  setMessages: (messages) => set({ messages: messages.slice(-MAX_CHAT_MESSAGES) }), addMessage: (message) => set((state) => ({ messages: [...state.messages, message].slice(-MAX_CHAT_MESSAGES) })),
  setStatus: (status) => set({ status }), setFinalizing: (finalizing) => set({ finalizing }), appendStream: (value) => set((state) => ({ streaming: `${state.streaming}${value}`.slice(0, MAX_STREAM_SIZE) })),
  clearRun: () => set({ executionId: null, streaming: '', diff: '', activities: [], approvals: [], files: [], plan: [], planExplanation: '', error: null }), setDiff: (diff) => set({ diff }),
  upsertActivity: (activity) => set((state) => ({ activities: [...state.activities.filter((item) => item.id !== activity.id), { ...activity, detail: activity.detail?.slice(-MAX_ACTIVITY_DETAIL) }].slice(-MAX_ACTIVITIES) })),
  addApproval: (approval) => set((state) => ({ approvals: [...state.approvals.filter((item) => item.key !== approval.key), approval] })),
  resolveApproval: (key, status) => set((state) => ({ approvals: state.approvals.map((item) => item.key === key ? { ...item, status } : item) })),
  setFiles: (files) => set({ files: files.slice(-MAX_CHANGED_FILES) }), addFiles: (files) => set((state) => ({ files: [...state.files.filter((old) => !files.some((item) => item.path === old.path)), ...files].slice(-MAX_CHANGED_FILES) })),
  setArtifacts: (artifacts) => set({ artifacts }), setSuggestions: (suggestions) => set({ suggestions }), setPlan: (plan, planExplanation = '') => set({ plan, planExplanation }),
  setError: (error) => set({ error }),
}))

export const selectPendingApprovalCount = (state: AppState) => (
  state.approvals.reduce((count, approval) => count + (approval.status === 'pending' ? 1 : 0), 0)
)
