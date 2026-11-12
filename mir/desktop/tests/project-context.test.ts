import { describe, expect, it } from 'vitest';
import { composeRequest } from '../src/domain/attachments';
import {
  assembleProjectRequest,
  estimateProjectTokens,
  projectContextState,
  projectContextThresholds,
  projectConversationReserve,
  projectSystemPrefix,
  resolveProjectSystemPrompt,
} from '../src/domain/projectContext';
import type { Project } from '../src/domain/projects';
import { newConversation } from '../src/domain/types';
import type { Conversation, Message } from '../src/domain/types';
import { defaultSettings } from '../src/services/fixtures';

const settings = { ...defaultSettings, chat_system_prompt: 'Applied Settings instructions' };
const project: Project = {
  id: 'project',
  name: 'Research',
  description: '',
  instructions: 'Project instructions',
  starred: false,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  files: [
    {
      id: 'first',
      name: 'z "quoted".md',
      extension: 'md',
      size: 10,
      text: 'First included file',
      included: true,
    },
    {
      id: 'excluded',
      name: 'excluded.pdf',
      extension: 'pdf',
      size: 10,
      text: 'Excluded text',
      included: false,
    },
    {
      id: 'second',
      name: 'a.txt',
      extension: 'txt',
      size: 10,
      text: 'Second included file',
      included: true,
    },
  ],
};
const messages: Message[] = [
  { id: 'question', role: 'user', content: 'Question', reasoning: '', status: 'complete' },
  {
    id: 'answer',
    role: 'assistant',
    content: 'Partial answer',
    reasoning: 'Private reasoning',
    status: 'interrupted',
  },
];

function projectConversation(): Conversation {
  return {
    ...newConversation(),
    projectId: project.id,
    ownSystemPrompt: 'Stored own prompt',
    messages,
  };
}

describe('project request assembly', () => {
  it('falls back for whitespace-only instructions and preserves nonempty instruction text', () => {
    const empty = { ...project, instructions: ' \n\t' };
    expect(resolveProjectSystemPrompt(projectConversation(), settings, empty)).toBe(
      settings.chat_system_prompt,
    );
    expect(projectSystemPrefix(empty, settings)).toBe(
      projectSystemPrefix({ ...project, instructions: '' }, settings),
    );
    expect(
      resolveProjectSystemPrompt(projectConversation(), settings, {
        ...project,
        instructions: '  Keep my spacing.\n',
      }),
    ).toBe('  Keep my spacing.\n');
  });
  it('places included files in one stable system prefix, preserving persisted order and names', () => {
    const chat = projectConversation();
    const request = assembleProjectRequest(chat, messages, settings, project);
    expect(request).toEqual([
      {
        role: 'system',
        content:
          'Project instructions\n\n' +
          '--- BEGIN ATTACHMENT "z \\"quoted\\".md" ---\nFirst included file\n--- END ATTACHMENT "z \\"quoted\\".md" ---\n\n' +
          '--- BEGIN ATTACHMENT "a.txt" ---\nSecond included file\n--- END ATTACHMENT "a.txt" ---',
      },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Partial answer' },
    ]);
    expect(JSON.stringify(request)).not.toContain('excluded');
    expect(JSON.stringify(request)).not.toContain('Private reasoning');
    const nextTurn: Message = {
      id: 'next',
      role: 'user',
      content: 'Next question',
      reasoning: '',
      status: 'complete',
    };
    expect(assembleProjectRequest(chat, [...messages, nextTurn], settings, project)[0]).toEqual(
      request[0],
    );
    expect(chat.ownSystemPrompt).toBe('Stored own prompt');
  });

  it('uses applied Settings when project instructions are empty, never the own prompt', () => {
    const emptyInstructions = { ...project, instructions: '' };
    const chat = projectConversation();
    expect(resolveProjectSystemPrompt(chat, settings, emptyInstructions)).toBe(
      settings.chat_system_prompt,
    );
    expect(projectSystemPrefix(emptyInstructions, settings)).toMatch(
      /^Applied Settings instructions/,
    );
    expect(resolveProjectSystemPrompt(chat, undefined, emptyInstructions)).toBe('');
    expect(projectSystemPrefix({ ...emptyInstructions, files: [] })).toBe('');
  });

  it('preserves chat attachment placement independently from project files', () => {
    const chat = {
      ...projectConversation(),
      attachments: [
        {
          id: 'chat-file',
          name: 'chat.txt',
          extension: 'txt' as const,
          size: 4,
          text: 'Chat file',
        },
      ],
    };
    const request = assembleProjectRequest(chat, messages, settings, project);
    expect(request[0].content).not.toContain('chat.txt');
    expect(request[1]).toEqual({
      role: 'user',
      content:
        '--- BEGIN ATTACHMENT "chat.txt" ---\nChat file\n--- END ATTACHMENT "chat.txt" ---\n\nQuestion',
    });
    expect(messages[0].content).toBe('Question');
  });

  it('preserves ordinary chat assembly and explicit empty own prompts', () => {
    const chat = { ...newConversation(), messages };
    expect(assembleProjectRequest(chat, messages, settings)).toEqual(
      composeRequest(messages, settings.chat_system_prompt, []),
    );
    expect(
      assembleProjectRequest({ ...chat, ownSystemPrompt: '' }, messages, settings)[0].role,
    ).toBe('user');
    expect(
      resolveProjectSystemPrompt(
        { ...chat, options: { systemPrompt: 'Legacy own prompt', reasoning: null, effort: null } },
        settings,
      ),
    ).toBe('Legacy own prompt');
  });

  it('does not silently replace an unavailable project with the chat’s own prompt', () => {
    const chat = projectConversation();
    expect(() => assembleProjectRequest(chat, messages, settings)).toThrow(
      'project is unavailable',
    );
    expect(() =>
      assembleProjectRequest(chat, messages, settings, { ...project, id: 'other' }),
    ).toThrow('project is unavailable');
  });
});

describe('project capacity policy', () => {
  it('reserves 25% rounded up, leaving the fixture’s available space', () => {
    expect(projectConversationReserve(16384)).toBe(4096);
    expect(projectConversationReserve(101)).toBe(26);
    expect(projectContextState(1000, 16384, false)).toEqual({
      used: 1000,
      available: 12288,
      reserve: 4096,
      capacity: 16384,
      ratio: 1000 / 12288,
      level: 'ok',
      shortfall: 0,
      approximate: false,
    });
  });

  it('compares exact ratios at 75% and strictly above 100%, including rounded display edges', () => {
    expect(projectContextThresholds).toEqual({ close: 0.75, over: 1 });
    expect(projectContextState(9215, 16384, true).level).toBe('ok');
    expect(projectContextState(9216, 16384, true).level).toBe('high');
    expect(projectContextState(12288, 16384, true).level).toBe('high');
    const over = projectContextState(12289, 16384, true);
    expect(over.level).toBe('over');
    expect(over.shortfall).toBe(1);
    expect(Math.round(over.ratio! * 100)).toBe(100);
  });

  it.each([undefined, null, 0, -1, NaN, Infinity])(
    'shows unknown capacity %j without inventing a denominator or blocking',
    (capacity) => {
      expect(projectContextState(30000, capacity, true)).toEqual({
        used: 30000,
        capacity: null,
        available: null,
        reserve: null,
        ratio: null,
        level: 'unknown',
        shortfall: 0,
        approximate: true,
      });
    },
  );

  it('marks approximate and counted values independently of capacity', () => {
    expect(projectContextState(100, 16384, true).approximate).toBe(true);
    expect(projectContextState(100, 16384, false).approximate).toBe(false);
    expect(projectContextState(1, 1, false).level).toBe('over');
    expect(projectContextState(0, 1, false).level).toBe('ok');
  });

  it('estimates four Unicode characters per token including delimiters and Settings fallback', () => {
    expect(estimateProjectTokens('')).toBe(0);
    expect(estimateProjectTokens('😀☕éa')).toBe(1);
    expect(estimateProjectTokens('😀☕éab')).toBe(2);
    const prefix = projectSystemPrefix({ ...project, instructions: '' }, settings);
    expect(estimateProjectTokens(prefix)).toBe(Math.ceil(Array.from(prefix).length / 4));
    expect(estimateProjectTokens(prefix)).toBeGreaterThan(
      estimateProjectTokens(
        project.files
          .filter((file) => file.included)
          .map((file) => file.text)
          .join(''),
      ),
    );
  });
});
