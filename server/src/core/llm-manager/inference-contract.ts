// Shared category identifiers must remain usable without importing Core runtime types.
export enum LLMDuties {
  Inference = 'inference',
  SkillRouter = 'skill-router',
  ActionCalling = 'action-calling',
  SlotFilling = 'slot-filling',
  Paraphrase = 'paraphrase',
  ReAct = 'react'
}

export enum InferencePurpose {
  ProviderTool = 'provider-tool',
  SessionTitle = 'session-title',
  Memory = 'memory',
  OwnerProfile = 'owner-profile',
  SelfModel = 'self-model',
  Pulse = 'pulse',
  PulsePlanning = 'pulse-planning',
  PulseReaction = 'pulse-reaction',
  ContextCompaction = 'context-compaction',
  ImageInspection = 'image-inspection'
}
