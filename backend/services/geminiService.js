import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

if (GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('[AI] Google Gemini client initialized with API key.');
  } catch (err) {
    console.warn('[AI] Failed to initialize Google Gemini client:', err.message);
  }
} else {
  console.warn('[AI] GEMINI_API_KEY is not set. Offline rule-based heuristic suggestions will be used as fallback for local testing.');
}

/**
 * Generate AI dependency suggestions for a specific task.
 * 
 * Grounding & Anti-Hallucination Measures:
 * 1. Strict Task ID Whitelist: Only real task IDs are accepted. Any hallucinated ID returned by LLM is discarded.
 * 2. Self-loop prevention: Discard any suggestion where depends_on_task_id === targetTaskId.
 * 3. Structured JSON Schema enforcement: Prompt requires JSON-only output with strict format.
 * 4. Deterministic fallback: In offline demo mode or when API key is unset, uses semantic heuristic matching.
 */
export async function generateDependencySuggestions({ targetTask, allTasks, existingDependencies = [] }) {
  if (!targetTask || !allTasks || allTasks.length === 0) {
    return [];
  }

  // Filter out the target task and tasks already configured as dependencies
  const existingPrereqIds = new Set(
    existingDependencies
      .filter(d => d.task_id === targetTask.id)
      .map(d => d.depends_on_task_id)
  );

  const candidateTasks = allTasks.filter(
    t => t.id !== targetTask.id && !existingPrereqIds.has(t.id)
  );

  if (candidateTasks.length === 0) {
    return [];
  }

  // Valid ID set for grounding validation
  const validTaskIds = new Set(candidateTasks.map(t => t.id));

  // If Gemini API is available, invoke it
  if (genAI && GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      });

      const prompt = `
You are assisting a project-planning DAG workflow tool called TaskFlow Pro.
Given a TARGET task and a list of EXISTING candidate tasks, identify which existing tasks are logically prerequisites that the TARGET task depends on — based strictly on the semantic content of the titles and descriptions.

TARGET TASK:
- ID: "${targetTask.id}"
- Title: "${targetTask.title}"
- Description: "${targetTask.description || 'No description'}"

CANDIDATE EXISTING TASKS:
${candidateTasks.map(t => `- ID: "${t.id}" | Title: "${t.title}" | Description: "${t.description || ''}"`).join('\n')}

Rules:
1. Return ONLY valid JSON matching the format below.
2. Only select an existing task if it must realistically happen BEFORE the target task can begin.
3. If no dependencies are likely, respond with an empty list [].
4. Do NOT hallucinate task IDs. You must only use IDs present in the candidate list.

Expected JSON output format:
[
  {
    "depends_on_task_id": "<exact candidate task id>",
    "confidence": "high" | "medium" | "low",
    "rationale": "<one concise sentence explaining why this prerequisite is needed>"
  }
]
`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Clean & parse JSON
      let cleanedJson = responseText.trim();
      if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanedJson);

      if (!Array.isArray(parsed)) {
        return [];
      }

      // Grounding validation: ensure task ID is valid and not self-referential
      const validatedSuggestions = parsed
        .filter(item => {
          return (
            item &&
            item.depends_on_task_id &&
            validTaskIds.has(item.depends_on_task_id) &&
            item.depends_on_task_id !== targetTask.id
          );
        })
        .map(item => ({
          task_id: targetTask.id,
          suggested_depends_on_task_id: item.depends_on_task_id,
          confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium',
          rationale: item.rationale || 'Suggested logical prerequisite based on task semantics.',
          status: 'pending'
        }));

      return validatedSuggestions;
    } catch (err) {
      console.warn('[AI] Error calling Gemini API, falling back to semantic heuristic:', err.message);
      // Fall through to heuristic fallback
    }
  }

  // Intelligent semantic heuristic fallback (Offline / No API Key demo support)
  return generateHeuristicSuggestions(targetTask, candidateTasks);
}

/**
 * Intelligent keyword and workflow semantic heuristic generator
 * Used when GEMINI_API_KEY is not configured or in offline demo mode.
 */
function generateHeuristicSuggestions(targetTask, candidateTasks) {
  const targetText = `${targetTask.title} ${targetTask.description || ''}`.toLowerCase();
  const suggestions = [];

  const workflowPatterns = [
    { targetKeyword: 'test', prereqKeyword: ['build', 'api', 'backend', 'develop', 'implement', 'feature'], rationale: 'Testing requires implementation/backend to be ready.', confidence: 'high' },
    { targetKeyword: 'deploy', prereqKeyword: ['test', 'integration', 'build', 'review', 'e2e'], rationale: 'Deployment requires testing and builds to complete.', confidence: 'high' },
    { targetKeyword: 'frontend', prereqKeyword: ['design', 'wireframe', 'mockup', 'schema'], rationale: 'Frontend implementation depends on design specifications.', confidence: 'high' },
    { targetKeyword: 'ui', prereqKeyword: ['design', 'mockup', 'schema'], rationale: 'UI work depends on design assets.', confidence: 'high' },
    { targetKeyword: 'api', prereqKeyword: ['schema', 'database', 'model', 'architecture'], rationale: 'API implementation depends on database schema design.', confidence: 'high' },
    { targetKeyword: 'backend', prereqKeyword: ['schema', 'database', 'architecture'], rationale: 'Backend development depends on database design.', confidence: 'high' },
    { targetKeyword: 'integration', prereqKeyword: ['api', 'frontend', 'backend', 'auth'], rationale: 'Integration requires both API and interface components.', confidence: 'high' },
    { targetKeyword: 'auth', prereqKeyword: ['schema', 'database', 'user model'], rationale: 'Authentication depends on user/database schema.', confidence: 'medium' },
    { targetKeyword: 'e2e', prereqKeyword: ['api', 'frontend', 'ui', 'integration'], rationale: 'End-to-end verification requires integrated functional components.', confidence: 'high' }
  ];

  for (const candidate of candidateTasks) {
    const candidateText = `${candidate.title} ${candidate.description || ''}`.toLowerCase();

    for (const pattern of workflowPatterns) {
      if (targetText.includes(pattern.targetKeyword)) {
        const matchesPrereq = pattern.prereqKeyword.some(k => candidateText.includes(k));
        if (matchesPrereq) {
          suggestions.push({
            task_id: targetTask.id,
            suggested_depends_on_task_id: candidate.id,
            confidence: pattern.confidence,
            rationale: pattern.rationale,
            status: 'pending'
          });
          break;
        }
      }
    }
  }

  return suggestions;
}

export default {
  generateDependencySuggestions
};
