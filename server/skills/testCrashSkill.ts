
import { Skill } from './base.js';

export const testCrashSkill: Skill = {
  name: 'testCrash',
  declarations: [
    {
      name: 'test_crash',
      description: 'Generates a test crash to verify self-healing.',
      parameters: {
        type: 'OBJECT',
        properties: {
          shouldThrow: { type: 'BOOLEAN', description: 'Force an error' }
        }
      }
    }
  ],

  handleToolCall: async (name, args) => {
    if (name === 'test_crash' && args.shouldThrow) {
      // This is a known pattern that the SkillManager should recognize and fix.
      // ErrorPattern: Missing semicolon at end of line (example)
      throw new Error("SelfHealingTest: Simulate missing semicolon")
    }
    return { status: 'ok', message: 'Did not crash' };
  }
};
