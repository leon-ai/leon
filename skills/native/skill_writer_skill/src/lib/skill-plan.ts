export interface SkillPlanAction {
  name: string
  description: string
  code?: string
  is_loop?: boolean
  parameters?: Record<
    string,
    {
      type: string
      description: string
      enum?: string[]
    }
  >
  optional_parameters?: string[]
}

export interface SkillPlanTools {
  existing_tools?: string[]
  new_tools?: string[]
}

export interface SkillPlan {
  name: string
  display_name?: string
  description: string
  bridge: 'nodejs' | 'python'
  workflow?: string[]
  action_notes?: string[]
  actions: SkillPlanAction[]
  tools?: SkillPlanTools
  locale_answers?: Record<string, Record<string, string[]>>
  missing_param_follow_ups?: Record<string, Record<string, string[]>>
}
