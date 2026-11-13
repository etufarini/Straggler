import { describe, expect, it } from 'vitest';
import { exportFileName, serializeConversation } from '../src/domain/conversationExport';
import type { Conversation } from '../src/domain/types';
import { newConversation } from '../src/domain/types';
import { defaultSettings } from '../src/services/fixtures';
import { moveConversationToProject, removeConversationFromProject } from '../src/domain/projects';
import type { Project } from '../src/domain/projects';

function conversation(): Conversation {
  return {
    ...newConversation(),
    title: 'A local chat',
    createdAt: 1,
    model: '/example/model.gguf',
    messages: [
      {
        id: 'user',
        role: 'user' as const,
        content: 'Question ☕',
        reasoning: '',
        status: 'complete' as const,
      },
      {
        id: 'response',
        role: 'assistant' as const,
        content: '**Partial** answer',
        reasoning: 'Private reasoning',
        status: 'stopped' as const,
        metrics: { outputTokens: 12 },
      },
    ],
  };
}

describe('Mir conversation export version 1', () => {
  it('exports only the defined public fields without private reasoning or request options', () => {
    const chat = conversation();
    const result = JSON.parse(serializeConversation(chat, false, '2026-11-11T00:00:00Z'));
    expect(result).toEqual({
      format: 'mir.cpp/conversation',
      version: 1,
      exportedAt: '2026-11-11T00:00:00Z',
      includesReasoning: false,
      conversation: {
        title: chat.title,
        createdAt: '1970-01-01T00:00:00.001Z',
        model: chat.model,
        messages: [
          { role: 'user', content: 'Question ☕' },
          { role: 'assistant', content: '**Partial** answer', model: chat.model },
        ],
      },
    });
    expect(chat.messages[1].reasoning).toBe('Private reasoning');
  });
  it('includes reasoning only on assistant messages and only when requested', () => {
    const result = JSON.parse(serializeConversation(conversation(), true, 'now'));
    expect(result.includesReasoning).toBe(true);
    expect(result.conversation.messages[1].reasoning_content).toBe('Private reasoning');
    expect(result.conversation.messages[0].reasoning_content).toBeUndefined();
  });
  it('includes an effective system prompt, respecting explicit empty overrides', () => {
    const chat = conversation();
    const settings = { ...defaultSettings, chat_system_prompt: 'Default instructions' };
    expect(
      JSON.parse(serializeConversation(chat, false, 'now', settings)).conversation.messages[0],
    ).toEqual({ role: 'system', content: 'Default instructions' });
    chat.options = { systemPrompt: '', reasoning: 'off', effort: 'auto' };
    expect(
      JSON.parse(serializeConversation(chat, false, 'now', settings)).conversation.messages[0].role,
    ).toBe('user');
  });
  it('sanitizes filenames without losing Unicode or creating paths', () => {
    expect(exportFileName('../A/B\\C: café?')).toBe('A B C  café.json');
    expect(exportFileName('...')).toBe('conversation.json');
    expect(exportFileName('Saved.json')).toBe('Saved.json');
    expect(exportFileName('☕'.repeat(200))).toBe('☕'.repeat(66) + '.json');
    expect(new TextEncoder().encode(exportFileName('😀'.repeat(200))).length).toBeLessThanOrEqual(
      205,
    );
  });
});

it('excludes attachment text and preserves per-response model metadata', () => {
  const chat = {
    ...conversation(),
    attachments: [
      {
        id: 'attachment',
        name: 'notes.txt',
        extension: 'txt' as const,
        size: 12,
        text: 'Attachment-only text',
      },
    ],
  };
  chat.messages[1] = { ...chat.messages[1], model: 'earlier.gguf' };
  const output = serializeConversation(chat, false, 'now');
  expect(output).not.toContain('Attachment-only text');
  expect(output).not.toContain('notes.txt');
  expect(JSON.parse(output).conversation.messages[1].model).toBe('earlier.gguf');
});

describe('project conversation exports', () => {
  const project: Project = {
    id: 'project',
    name: 'Project name is not exported',
    description: 'Project description is not exported',
    instructions: 'Current project instructions',
    starred: true,
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    files: [
      {
        id: 'project-file',
        name: 'project-file.txt',
        extension: 'txt',
        size: 12,
        text: 'Project file text is not exported',
        included: true,
      },
    ],
  };

  it.each([false, true])(
    'keeps the version 1 format and restores the own prompt after removal (reasoning %s)',
    (includesReasoning) => {
      const original = {
        ...conversation(),
        options: { systemPrompt: 'Stored own instructions', reasoning: null, effort: null },
      };
      const member = moveConversationToProject(original, project, 3);
      const output = serializeConversation(
        member,
        includesReasoning,
        'now',
        defaultSettings,
        project,
      );
      const parsed = JSON.parse(output);
      expect(parsed.format).toBe('mir.cpp/conversation');
      expect(parsed.version).toBe(1);
      expect(parsed.includesReasoning).toBe(includesReasoning);
      expect(parsed.conversation.messages[0]).toEqual({
        role: 'system',
        content: project.instructions,
      });
      expect(Object.keys(parsed.conversation).sort()).toEqual([
        'createdAt',
        'messages',
        'model',
        'title',
      ]);
      expect(parsed.conversation.messages[2].reasoning_content).toBe(
        includesReasoning ? 'Private reasoning' : undefined,
      );
      for (const excluded of [
        project.name,
        project.description,
        project.files[0].name,
        project.files[0].text,
        original.options.systemPrompt,
        'projectId',
        'ownSystemPrompt',
      ])
        expect(output).not.toContain(excluded);

      const removed = removeConversationFromProject(member, 4);
      expect(
        JSON.parse(serializeConversation(removed, includesReasoning, 'now', defaultSettings))
          .conversation.messages[0],
      ).toEqual({ role: 'system', content: original.options.systemPrompt });
      expect(member.ownSystemPrompt).toBe(original.options.systemPrompt);
    },
  );

  it.each([false, true])(
    'exports current instructions after edits and applied Settings fallback (reasoning %s)',
    (includesReasoning) => {
      const chat = moveConversationToProject(conversation(), project, 3);
      const changed = {
        ...project,
        instructions: 'Instructions edited after the earlier response',
      };
      expect(
        JSON.parse(serializeConversation(chat, includesReasoning, 'now', defaultSettings, changed))
          .conversation.messages[0],
      ).toEqual({ role: 'system', content: changed.instructions });
      const settings = { ...defaultSettings, chat_system_prompt: 'Applied Settings prompt' };
      expect(
        JSON.parse(
          serializeConversation(chat, includesReasoning, 'now', settings, {
            ...changed,
            instructions: '',
          }),
        ).conversation.messages[0],
      ).toEqual({ role: 'system', content: settings.chat_system_prompt });
    },
  );
});
